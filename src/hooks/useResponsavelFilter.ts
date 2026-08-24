import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFilterState } from "@/hooks/useFilterState";
import type { FilterConfig } from "@/components/shared/filters";

// Filtro em cascata do Responsável das OCs: 1º o TIPO de colaborador (Estilista, Modelista,
// Piloteiro + tipos customizados) e, opcional, a PESSOA daquele tipo. Devolve os descritores
// prontos p/ o FilterButton + as listas (ids/nomes) para aplicar na query da OC — quem guarda
// id usa `idsFiltro` (OC Tecido), quem guarda nome usa `nomesFiltro` (OC Aviamento/Insumo).
// `null` = sem filtro; `[]` = tipo sem colaboradores (não casa nada).
// Multi-select (ago/2026): `tipo`/`pessoaId` são arrays — pessoas = união dos colaboradores
// dos tipos marcados; a poda remove da seleção de pessoa quem saiu da união ao mudar o tipo.

const BUILTIN_TIPOS: { value: string; label: string }[] = [
  { value: "estilista", label: "Estilista" },
  { value: "modelista", label: "Modelista" },
  { value: "piloteiro", label: "Piloteiro" },
];

export function useResponsavelFilter(screen: string) {
  // Persistem por tela+usuário (igual aos demais filtros). `screen` vem da OC que consome
  // (ex. "oc-tecido"), p/ não misturar a seleção entre as 3 OCs.
  const [tipo, setTipo] = useFilterState(screen, "Colaborador", []);
  const [pessoaId, setPessoaId] = useFilterState(screen, "Responsável", []);

  const { data: colaboradores = [] } = useQuery({
    queryKey: ["colaboradores-todos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome, tipo").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; tipo: string | null }[];
    },
  });
  const { data: tiposCustom = [] } = useQuery({
    queryKey: ["tipos-colaborador-nomes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tipos_colaborador" as any).select("nome").order("nome");
      if (error) throw error;
      return ((data ?? []) as any[]).map((t) => t.nome as string);
    },
  });

  const tipos = useMemo(() => {
    const m = new Map<string, string>();
    BUILTIN_TIPOS.forEach((b) => m.set(b.value, b.label));
    tiposCustom.forEach((t) => { if (t && !m.has(t)) m.set(t, t); });
    colaboradores.forEach((c) => { if (c.tipo && !m.has(c.tipo)) m.set(c.tipo, c.tipo); });
    return [...m].map(([value, label]) => ({ value, label }));
  }, [tiposCustom, colaboradores]);

  const pessoas = useMemo(
    () => (tipo.length === 0 ? colaboradores : colaboradores.filter((c) => c.tipo && tipo.includes(c.tipo))),
    [tipo, colaboradores],
  );

  // Poda: ao mudar os tipos marcados, remove da seleção de pessoa quem saiu da união
  // (idempotente — só remove, não loopa).
  useEffect(() => {
    const validos = new Set(pessoas.map((p) => p.id));
    const next = pessoaId.filter((id) => validos.has(id));
    if (next.length !== pessoaId.length) setPessoaId(next); // guarda: só grava se podou algo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoas]);

  const idsFiltro = useMemo<string[] | null>(() => {
    if (pessoaId.length > 0) return pessoaId;
    if (tipo.length > 0) return colaboradores.filter((c) => c.tipo && tipo.includes(c.tipo)).map((c) => c.id);
    return null;
  }, [tipo, pessoaId, colaboradores]);
  const nomesFiltro = useMemo<string[] | null>(() => {
    if (pessoaId.length > 0) {
      const nomes = colaboradores.filter((c) => pessoaId.includes(c.id)).map((c) => c.nome);
      return nomes;
    }
    if (tipo.length > 0) return colaboradores.filter((c) => c.tipo && tipo.includes(c.tipo)).map((c) => c.nome);
    return null;
  }, [tipo, pessoaId, colaboradores]);

  const filters: FilterConfig[] = [
    { label: "Colaborador", value: tipo, onChange: setTipo, options: tipos.map((t) => ({ id: t.value, nome: t.label })) },
    { label: "Responsável", value: pessoaId, onChange: setPessoaId, options: pessoas.map((c) => ({ id: c.id, nome: c.nome })) },
  ];

  return { filters, tipo, pessoaId, idsFiltro, nomesFiltro };
}

// Sentinelas p/ .in() vazio (tipo sem colaboradores) casar nada em vez de tudo.
export const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
export const SENTINEL_NOME = " __sem__";
