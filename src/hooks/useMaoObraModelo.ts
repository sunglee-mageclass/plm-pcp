import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { moLinhasEqual } from "@/lib/mao-obra";
import type { MaoObraEditorLinha, CategoriaServicoOpt } from "@/components/planejamento/MaoObraEditor";

/**
 * Hook de Mão de Obra POR SERVIÇO ligado a um `modelo_id` — fonte única `modelo_servico_mo`.
 * Usado pelos CARDS de Produto Acabado / Importado (mesmo dado do card do Planejamento): editar a MO
 * aqui reflete lá e vice-versa. Multi-instância: aprovar/reprovar é POR INSTÂNCIA (id).
 *
 * Encapsula: query do resumo (semeia as linhas + baseline), query das categorias de serviço,
 * o rascunho local (`linhas`), o "dirty", o SAVE (estado completo via `salvar_modelo_servico_mo`,
 * inclui `id` p/ preservar aprovações) e o aprovar/reprovar imediato (`aprovar_servico_mo`).
 * `modeloId` null (card ainda não criado) → tudo inerte (a seção não deve aparecer nesse caso).
 */
export function useMaoObraModelo(modeloId: string | null | undefined, podeVerCustos: boolean) {
  const qc = useQueryClient();
  const [linhas, setLinhas] = useState<MaoObraEditorLinha[]>([]);
  const [linhasBase, setLinhasBase] = useState<MaoObraEditorLinha[]>([]);
  const linhasRef = useRef(linhas); linhasRef.current = linhas;
  const baseRef = useRef(linhasBase); baseRef.current = linhasBase;

  const { data: catsServico = [] } = useQuery({
    queryKey: ["cats-servico-mo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categorias_terceirizado")
        .select("id, nome, ativo, valor_padrao").order("ordem").order("nome");
      if (error) throw error;
      return (data ?? []) as CategoriaServicoOpt[];
    },
  });

  const { data: resumo } = useQuery({
    queryKey: ["mo-resumo-card", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data as any)?.[modeloId] ?? null) as
        { estado: string; total: number | null; total_aprovado: number | null; linhas: any[] } | null;
    },
  });

  // Semeia as linhas do resumo — guarda edições locais não salvas (mesmo padrão do PlanejamentoDetail).
  useEffect(() => {
    if (!resumo) return;
    const seed = (resumo.linhas ?? []).map((l) => ({
      id: l.id ?? null,
      categoria_terceirizado_id: l.categoria_terceirizado_id ?? null,
      nome: l.nome, valor: l.valor ?? null, aprovado: l.aprovado ?? null, motivo_reprovacao: l.motivo_reprovacao ?? null,
    })) as MaoObraEditorLinha[];
    if (!moLinhasEqual(linhasRef.current, baseRef.current)) return; // preserva edições não salvas
    setLinhas(seed); setLinhasBase(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumo]);

  const linhasPersistidas = useMemo(
    () => new Set(linhasBase.map((l) => l.id).filter((x): x is string => !!x)),
    [linhasBase],
  );
  const dirty = !moLinhasEqual(linhas, linhasBase);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!modeloId) return;
      const { error } = await supabase.rpc("salvar_modelo_servico_mo" as any, {
        _modelo_id: modeloId,
        _linhas: linhasRef.current.map((l) => ({
          id: l.id ?? null,
          categoria_terceirizado_id: l.categoria_terceirizado_id,
          valor: Number(l.valor) || 0,
          observacoes: null,
        })),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setLinhasBase(linhasRef.current);
      qc.invalidateQueries({ queryKey: ["mo-resumo-card", modeloId] });
      qc.invalidateQueries({ queryKey: ["plan-custo-unit"] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["produtos-acabados"] });
      qc.invalidateQueries({ queryKey: ["produtos-importados"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Não foi possível salvar a mão de obra.")),
  });

  const aprovar = useMutation({
    mutationFn: async ({ linhaId, aprovado, motivo }: { linhaId: string; aprovado: boolean; motivo?: string }) => {
      const { error } = await supabase.rpc("aprovar_servico_mo" as any, {
        _modelo_id: modeloId, _linha_id: linhaId, _aprovado: aprovado, _motivo: motivo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.aprovado ? "Mão de obra aprovada." : "Mão de obra reprovada.");
      const patch = (ls: MaoObraEditorLinha[]) => ls.map((l) =>
        l.id === vars.linhaId ? { ...l, aprovado: vars.aprovado, motivo_reprovacao: vars.aprovado ? null : (vars.motivo ?? null) } : l);
      setLinhas(patch); setLinhasBase(patch);
      qc.invalidateQueries({ queryKey: ["mo-resumo-card", modeloId] });
      qc.invalidateQueries({ queryKey: ["plan-custo-unit"] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Não foi possível atualizar a mão de obra.")),
  });

  return {
    linhas, setLinhas, catsServico, linhasPersistidas, dirty,
    salvar, aprovar,
    total: linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0),
    podeVerCustos,
  };
}
