/* eslint-disable @typescript-eslint/no-explicit-any -- `rev`/`subcategoria_tecido_id` fora do types.ts (regen pendente): `as any` no builder, padrão do $artigoId */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buscarTodas } from "@/lib/buscar-todas";
import {
  agruparCategorias,
  agruparVariantes,
  type GradeArtigoCategoria,
  type GradeCatPar,
  type GradeVarianteCompleta,
} from "./agruparGrade";

export type { GradeArtigoCategoria, GradeCatPar, GradeVarianteCompleta } from "./agruparGrade";

/**
 * Hook de DADOS da grade editável (aba "Lista tipo Excel" de Cadastro > Tecidos). SÓ LEITURA.
 *
 * Diferente das queries de card da tela (`["artigos"]`/`["variantes-thumb"]`, que são enxutas), a
 * grade edita e cria — então precisa de `rev` (trava otimista), dos campos de cabeçalho editáveis,
 * das variantes COMPLETAS, das categorias N:N (com subcategoria) e das opções dos selects.
 * NÃO usa a RPC `exportar_tecidos` (leitura mascarada, sem ids/rev): SELECT direto; a loja vem da RLS.
 *
 * Regra C3 (erro honesto): todo `queryFn` faz `if (error) throw error` — nunca `data ?? []` de uma
 * consulta que falhou. `isError` reflete falha real; quem renderiza decide o aviso ("Tentar de novo").
 * `buscarTodas` pagina (PostgREST corta em 1.000 linhas) e também lança o erro.
 * queryKeys únicas com prefixo "tecidos-grade" (não colidem com as da tela nem do card).
 */

/** Artigo com os campos de cabeçalho editáveis na grade + `rev`. */
export type GradeArtigoCompleto = {
  id: string;
  nome: string;
  empresa_id: string | null;
  representante_id: string | null;
  categoria_tecido_id: string | null;
  composicao: string | null;
  ncm: string | null;
  largura_estimada: number | null;
  preco: number | null;
  unidade_medida: string;
  rendimento: number | null;
  mes_id: string | null;
  ano_id: string | null;
  /** Derivada no banco (preço ÷ rendimento em kg); só leitura. */
  preco_por_metro: number | null;
  rev: number;
  created_at: string;
};

export type GradeOpcaoNome = { id: string; nome: string };
export type GradeOpcaoSubcategoria = { id: string; nome: string; categoria_tecido_id: string };
export type GradeOpcaoEmpresa = { id: string; nome_fantasia: string };
/** `cores_apelido.cor_base_id` = a cor base a que o apelido pertence. */
export type GradeOpcaoApelido = { id: string; nome: string; cor_base_id: string | null };

export type GradeOpcaoMes = { id: string; mes: string };
export type GradeOpcaoAno = { id: string; ano: string };

export type GradeOpcoes = {
  categorias: GradeOpcaoNome[];
  subcategorias: GradeOpcaoSubcategoria[];
  empresas: GradeOpcaoEmpresa[];
  cores: GradeOpcaoNome[];
  coresApelido: GradeOpcaoApelido[];
  meses: GradeOpcaoMes[];
  anos: GradeOpcaoAno[];
};

const VAZIO_ARTIGOS: GradeArtigoCompleto[] = [];
const VAZIO_VARIANTES: GradeVarianteCompleta[] = [];
const VAZIO_CATS: GradeArtigoCategoria[] = [];
const VAZIO_CATEGORIAS: GradeOpcaoNome[] = [];
const VAZIO_SUBS: GradeOpcaoSubcategoria[] = [];
const VAZIO_EMPRESAS: GradeOpcaoEmpresa[] = [];
const VAZIO_APELIDOS: GradeOpcaoApelido[] = [];
const VAZIO_MESES: GradeOpcaoMes[] = [];
const VAZIO_ANOS: GradeOpcaoAno[] = [];

export function useTecidosGrade() {
  // `rev` não está no types.ts gerado (regen pendente) → `as any` no builder, como o $artigoId.
  const artigosQ = useQuery({
    queryKey: ["tecidos-grade", "artigos"],
    queryFn: () =>
      buscarTodas<GradeArtigoCompleto>((de, ate) =>
        (supabase.from("artigos") as any)
          .select(
            "id,nome,empresa_id,representante_id,categoria_tecido_id,composicao,ncm,largura_estimada,preco,unidade_medida,rendimento,mes_id,ano_id,preco_por_metro,rev,created_at",
          )
          .order("nome")
          .order("id")
          .range(de, ate),
      ),
  });

  const variantesQ = useQuery({
    queryKey: ["tecidos-grade", "variantes"],
    queryFn: () =>
      buscarTodas<GradeVarianteCompleta>((de, ate) =>
        (supabase.from("variantes_tecido") as any)
          .select(
            "id,artigo_id,cor_id,cor_apelido_id,nome_variante,codigo_variante,preco,foto_url,created_at",
          )
          .order("created_at")
          .order("id")
          .range(de, ate),
      ),
  });

  const catLinksQ = useQuery({
    queryKey: ["tecidos-grade", "artigo-categorias"],
    queryFn: () =>
      // `subcategoria_tecido_id` não está no types.ts → `as any` (mesmo padrão do $artigoId).
      buscarTodas<GradeArtigoCategoria>((de, ate) =>
        (supabase.from("artigo_categorias_tecido") as any)
          .select("id,artigo_id,categoria_tecido_id,subcategoria_tecido_id")
          .order("id")
          .range(de, ate),
      ),
  });

  const categoriasQ = useQuery({
    queryKey: ["tecidos-grade", "opcoes", "categorias"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_tecido")
        .select("id,nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoNome[];
    },
  });

  const subcategoriasQ = useQuery({
    queryKey: ["tecidos-grade", "opcoes", "subcategorias"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("subcategorias_tecido" as any) as any)
        .select("id, nome, categoria_tecido_id")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoSubcategoria[];
    },
  });

  const empresasQ = useQuery({
    // Mesmo filtro da index: só fornecedor de material.
    queryKey: ["tecidos-grade", "opcoes", "empresas-material"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id,nome_fantasia")
        .eq("tipo", "material")
        .order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoEmpresa[];
    },
  });

  const coresQ = useQuery({
    queryKey: ["tecidos-grade", "opcoes", "cores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cores").select("id,nome").order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoNome[];
    },
  });

  const coresApelidoQ = useQuery({
    queryKey: ["tecidos-grade", "opcoes", "cores-apelido"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cores_apelido")
        .select("id,nome,cor_base_id")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoApelido[];
    },
  });

  const mesesQ = useQuery({
    queryKey: ["tecidos-grade", "opcoes", "meses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("meses").select("id,mes").order("ordem");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoMes[];
    },
  });

  const anosQ = useQuery({
    queryKey: ["tecidos-grade", "opcoes", "anos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("anos").select("id,ano").order("ano");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoAno[];
    },
  });

  const queries = [
    artigosQ,
    variantesQ,
    catLinksQ,
    categoriasQ,
    subcategoriasQ,
    empresasQ,
    coresQ,
    coresApelidoQ,
    mesesQ,
    anosQ,
  ];

  // Referências estáveis enquanto `data` não muda (os Maps só se refazem quando a query muda).
  const artigos = artigosQ.data ?? VAZIO_ARTIGOS;
  const variantesPorArtigo = useMemo(
    () => agruparVariantes(variantesQ.data ?? VAZIO_VARIANTES),
    [variantesQ.data],
  );
  const catsPorArtigo = useMemo(
    () => agruparCategorias(catLinksQ.data ?? VAZIO_CATS),
    [catLinksQ.data],
  );

  const cores = coresQ.data;
  const opcoes = useMemo<GradeOpcoes>(
    () => ({
      categorias: categoriasQ.data ?? VAZIO_CATEGORIAS,
      subcategorias: subcategoriasQ.data ?? VAZIO_SUBS,
      empresas: empresasQ.data ?? VAZIO_EMPRESAS,
      cores: cores ?? VAZIO_CATEGORIAS,
      coresApelido: coresApelidoQ.data ?? VAZIO_APELIDOS,
      meses: mesesQ.data ?? VAZIO_MESES,
      anos: anosQ.data ?? VAZIO_ANOS,
    }),
    [categoriasQ.data, subcategoriasQ.data, empresasQ.data, cores, coresApelidoQ.data, mesesQ.data, anosQ.data],
  );

  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  const erro = (queries.find((q) => q.isError)?.error ?? null) as Error | null;

  // "Tentar de novo" do aviso de erro: refaz SÓ as que falharam. `recarregando` liga o "Tentando…" do botão.
  const recarregar = () => Promise.all(queries.filter((q) => q.isError).map((q) => q.refetch()));
  const recarregando = queries.some((q) => q.isError && q.isFetching);

  return { artigos, variantesPorArtigo, catsPorArtigo, opcoes, isLoading, isError, erro, recarregar, recarregando };
}

export type TecidosGradeDados = ReturnType<typeof useTecidosGrade>;
