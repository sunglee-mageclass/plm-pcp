/* eslint-disable @typescript-eslint/no-explicit-any -- `codigo`/`ncm`/`variantes_aviamento` fora do types.ts (regen pendente): `as any` no builder, como a tela de Aviamentos de hoje */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buscarTodas } from "@/lib/buscar-todas";
import { empresaTemCategoria, AVIAMENTO_TOKENS } from "@/lib/fornecedor-categoria";
import { agruparVariantes, type GradeVarianteCompleta } from "./agruparAviamentoGrade";

export type { GradeVarianteCompleta } from "./agruparAviamentoGrade";

/**
 * Hook de DADOS da grade editável (visão "Lista" de Cadastro > Aviamentos). SÓ LEITURA.
 * Espelha `useTecidosGrade`, adaptado ao aviamento.
 *
 * Diferente das queries de card da tela (`["aviamentos"]`/`["aviamentos-variantes"]`, enxutas e com embed de nome da cor), a grade
 * edita e cria — então precisa dos campos de cabeçalho editáveis, das variantes COMPLETAS (com foto) e das opções dos selects.
 * Aviamento NÃO tem `rev` (sem trava otimista por versão) nem categorias N:N: categoria/subcategoria/material são FK única do cabeçalho.
 * NÃO usa RPC de exportação (leitura mascarada, sem ids): SELECT direto; a loja vem da RLS.
 *
 * Regra C3 (erro honesto): todo `queryFn` faz `if (error) throw error` — nunca `data ?? []` de uma consulta que falhou.
 * `isError` reflete falha real; quem renderiza decide o aviso ("Tentar de novo"). `buscarTodas` pagina (PostgREST corta em
 * 1.000 linhas) e também lança o erro. queryKeys únicas com prefixo "aviamentos-grade" (não colidem com as da tela nem do card).
 */

/** Aviamento com os campos de cabeçalho editáveis na grade. */
export type GradeAviamentoCompleto = {
  id: string;
  codigo: string | null;
  /** Nome do aviamento (NÃO é `nome`). */
  codigo_nome: string;
  empresa_id: string | null;
  representante_id: string | null;
  categoria_aviamento_id: string | null;
  subcategoria_aviamento_id: string | null;
  material_aviamento_id: string | null;
  composicao: string | null;
  preco: number | null;
  ncm: string | null;
  observacoes: string | null;
  intervalo_largura_id: string | null;
  largura_exata: number | null;
  intervalo_vazado_id: string | null;
  largura_exata_vazado: number | null;
  foto_url: string | null;
  created_at: string;
};

export type GradeOpcaoNome = { id: string; nome: string };
/** Subcategoria cascateia pela categoria (`categoria_aviamento_id`). */
export type GradeOpcaoSubcategoria = { id: string; nome: string; categoria_aviamento_id: string };
/**
 * Fornecedor de material com seus representantes (o `FornecedorSelect` grava `(empresa_id, representante_id)`).
 * `ehAviamento` = a empresa tem categoria de fornecedor de aviamento (TOKEN flexível, como o card da tela): a célula oferece só
 * essas, mais o fornecedor já salvo no aviamento (mesmo que a categoria dele tenha mudado depois).
 */
export type GradeOpcaoEmpresa = {
  id: string;
  nome_fantasia: string;
  representantes: { id: string; nome: string | null }[];
  ehAviamento: boolean;
};
/** `cores_apelido.cor_base_id` = a cor base a que o apelido pertence. */
export type GradeOpcaoApelido = { id: string; nome: string; cor_base_id: string | null };

export type GradeOpcoes = {
  categorias: GradeOpcaoNome[];
  subcategorias: GradeOpcaoSubcategoria[];
  materiais: GradeOpcaoNome[];
  cores: GradeOpcaoNome[];
  coresApelido: GradeOpcaoApelido[];
  empresas: GradeOpcaoEmpresa[];
  /** `intervalos_largura.intervalo` já normalizado para `nome` (como o select da tela de hoje faz). */
  intervalos: GradeOpcaoNome[];
};

const VAZIO_AVIAMENTOS: GradeAviamentoCompleto[] = [];
const VAZIO_VARIANTES: GradeVarianteCompleta[] = [];
const VAZIO_NOMES: GradeOpcaoNome[] = [];
const VAZIO_SUBS: GradeOpcaoSubcategoria[] = [];
const VAZIO_EMPRESAS: GradeOpcaoEmpresa[] = [];
const VAZIO_APELIDOS: GradeOpcaoApelido[] = [];

export function useAviamentosGrade() {
  // `codigo`/`ncm` não estão no types.ts gerado (regen pendente) → `as any` no builder, como a tela de hoje.
  const aviamentosQ = useQuery({
    queryKey: ["aviamentos-grade", "aviamentos"],
    queryFn: () =>
      buscarTodas<GradeAviamentoCompleto>((de, ate) =>
        (supabase.from("aviamentos") as any)
          .select(
            "id,codigo,codigo_nome,empresa_id,representante_id,categoria_aviamento_id,subcategoria_aviamento_id,material_aviamento_id,composicao,preco,ncm,observacoes,intervalo_largura_id,largura_exata,intervalo_vazado_id,largura_exata_vazado,foto_url,created_at",
          )
          .order("codigo_nome")
          .order("id")
          .range(de, ate),
      ),
  });

  const variantesQ = useQuery({
    queryKey: ["aviamentos-grade", "variantes"],
    queryFn: () =>
      buscarTodas<GradeVarianteCompleta>((de, ate) =>
        (supabase.from("variantes_aviamento" as any) as any)
          .select(
            "id,aviamento_id,cor_id,cor_apelido_id,nome_variante,codigo_variante,preco,foto_url,created_at",
          )
          .order("created_at")
          .order("id")
          .range(de, ate),
      ),
  });

  const categoriasQ = useQuery({
    queryKey: ["aviamentos-grade", "opcoes", "categorias"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_aviamento")
        .select("id,nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoNome[];
    },
  });

  const subcategoriasQ = useQuery({
    queryKey: ["aviamentos-grade", "opcoes", "subcategorias"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subcategorias_aviamento")
        .select("id,nome,categoria_aviamento_id")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoSubcategoria[];
    },
  });

  const materiaisQ = useQuery({
    queryKey: ["aviamentos-grade", "opcoes", "materiais"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materiais_aviamento")
        .select("id,nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoNome[];
    },
  });

  const coresQ = useQuery({
    queryKey: ["aviamentos-grade", "opcoes", "cores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cores").select("id,nome").order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoNome[];
    },
  });

  const coresApelidoQ = useQuery({
    queryKey: ["aviamentos-grade", "opcoes", "cores-apelido"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cores_apelido")
        .select("id,nome,cor_base_id")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoApelido[];
    },
  });

  const empresasQ = useQuery({
    // Fornecedores de material + representantes + categorias (a categoria casa por TOKEN no cliente: o nome varia por loja —
    // ver `@/lib/fornecedor-categoria`). A célula de fornecedor filtra por `ehAviamento`, como o card da tela de Aviamentos.
    queryKey: ["aviamentos-grade", "opcoes", "empresas-material"],
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
        ehAviamento: empresaTemCategoria(e, AVIAMENTO_TOKENS),
      })) as GradeOpcaoEmpresa[];
    },
  });

  const intervalosQ = useQuery({
    queryKey: ["aviamentos-grade", "opcoes", "intervalos-largura"],
    queryFn: async () => {
      // ⚠️ a coluna de rótulo é `intervalo` (não `nome`) → normaliza para `nome`.
      const { data, error } = await supabase
        .from("intervalos_largura")
        .select("id,intervalo")
        .order("intervalo");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, nome: r.intervalo })) as GradeOpcaoNome[];
    },
  });

  const queries = [
    aviamentosQ,
    variantesQ,
    categoriasQ,
    subcategoriasQ,
    materiaisQ,
    coresQ,
    coresApelidoQ,
    empresasQ,
    intervalosQ,
  ];

  // Referências estáveis enquanto `data` não muda (o Map só se refaz quando a query muda).
  const aviamentos = aviamentosQ.data ?? VAZIO_AVIAMENTOS;
  const variantesPorAviamento = useMemo(
    () => agruparVariantes(variantesQ.data ?? VAZIO_VARIANTES),
    [variantesQ.data],
  );

  const opcoes = useMemo<GradeOpcoes>(
    () => ({
      categorias: categoriasQ.data ?? VAZIO_NOMES,
      subcategorias: subcategoriasQ.data ?? VAZIO_SUBS,
      materiais: materiaisQ.data ?? VAZIO_NOMES,
      cores: coresQ.data ?? VAZIO_NOMES,
      coresApelido: coresApelidoQ.data ?? VAZIO_APELIDOS,
      empresas: empresasQ.data ?? VAZIO_EMPRESAS,
      intervalos: intervalosQ.data ?? VAZIO_NOMES,
    }),
    [
      categoriasQ.data,
      subcategoriasQ.data,
      materiaisQ.data,
      coresQ.data,
      coresApelidoQ.data,
      empresasQ.data,
      intervalosQ.data,
    ],
  );

  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  const erro = (queries.find((q) => q.isError)?.error ?? null) as Error | null;

  // "Tentar de novo" do aviso de erro: refaz SÓ as que falharam. `recarregando` liga o "Tentando…" do botão.
  const recarregar = () => Promise.all(queries.filter((q) => q.isError).map((q) => q.refetch()));
  const recarregando = queries.some((q) => q.isError && q.isFetching);

  return {
    aviamentos,
    variantesPorAviamento,
    opcoes,
    isLoading,
    isError,
    erro,
    recarregar,
    recarregando,
  };
}

export type AviamentosGradeDados = ReturnType<typeof useAviamentosGrade>;
