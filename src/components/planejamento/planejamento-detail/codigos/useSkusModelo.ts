// Leitura e ações dos SKUs do card (F3.6 — seção "4. Códigos", F3.5b do SKU). Tudo pelas RPCs da F3.5a (o wrapper confere
// módulo `criacao`, loja e `criacao_planejamento` ver/editar — `_sku_guarda`). SKU à mão e Regerar são RPC IMEDIATA (fora do
// Salvar da página, como aprovar MO); a 1ª geração roda depois do Salvar (spec SKU §4.2; Ruling R12).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import {
  deveGerarPrimeiraVez, lerMatriz, resumoGeracao, type ApelidoSigla, type CorSigla, type MatrizSkus,
} from "./sku-card";

export const chaveSkus = (modeloId: string | null) => ["plan-skus", modeloId] as const;

async function lerSkus(modeloId: string): Promise<MatrizSkus> {
  const { data, error } = await supabase.rpc("skus_modelo" as any, { _modelo_id: modeloId });
  if (error) throw error;
  return lerMatriz(data);
}

export type SalvarSkuVars = { id: string | null; sku: string; rev: number | null; varianteKey: string; tamanhoKey: string };

/** `ativo` = card existente e o usuário vê o Planejamento; `podeEditar` = edita o Planejamento (Regerar/SKU à mão/1ª geração). */
export function useSkusModelo(modeloId: string | null, ativo: boolean, podeEditar: boolean) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: chaveSkus(modeloId),
    enabled: ativo && !!modeloId,
    queryFn: () => lerSkus(modeloId as string),
  });
  const invalidar = () => qc.invalidateQueries({ queryKey: chaveSkus(modeloId) });
  const regerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("gerar_skus_modelo" as any, { _modelo_id: modeloId, _regerar: true });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const r = resumoGeracao(data);
      if (r.erro) toast.error(r.texto);
      else toast.success(r.texto);
      invalidar();
    },
    onError: (e) => { toast.error(mensagemErro(e, "Não foi possível regerar os SKUs.")); invalidar(); },
  });
  const salvar = useMutation({
    mutationFn: async (v: SalvarSkuVars) => {
      const { error } = await supabase.rpc("salvar_sku_manual" as any, {
        _id: v.id, _sku: v.sku, _rev_base: v.rev, _modelo_id: modeloId, _variante_key: v.varianteKey, _tamanho_key: v.tamanhoKey,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("SKU salvo — marcado como editado à mão."); invalidar(); },
    onError: (e) => { toast.error(mensagemErro(e, "Não foi possível salvar o SKU.")); invalidar(); },
  });
  /** Depois do Salvar: matriz FRESCA; card com REF e SEM SKU gravado ⇒ gera (`_regerar=false` só cria o que falta). */
  const gerarSeFaltar = async () => {
    if (!ativo || !modeloId || !podeEditar) return;
    try {
      if (!deveGerarPrimeiraVez(await lerSkus(modeloId))) return;
      const { data, error } = await supabase.rpc("gerar_skus_modelo" as any, { _modelo_id: modeloId, _regerar: false });
      if (error) throw error;
      const r = resumoGeracao(data);
      if (r.erro) toast.error(r.texto);
    } catch (e) {
      toast.error(mensagemErro(e, "O card foi salvo, mas os SKUs não foram gerados — abra a seção Códigos e use “Regerar SKUs”."));
    } finally {
      invalidar();
    }
  };
  return {
    matriz: q.data,
    carregando: q.isLoading,
    erro: q.isError,
    regerar: () => regerar.mutate(),
    regerando: regerar.isPending,
    salvarManual: (v: SalvarSkuVars) => salvar.mutate(v),
    salvandoChave: salvar.isPending && salvar.variables ? `${salvar.variables.varianteKey}|${salvar.variables.tamanhoKey}` : null,
    gerarSeFaltar,
  };
}
export type SkusModelo = ReturnType<typeof useSkusModelo>;

const SEM_SIGLAS: { cores: CorSigla[]; apelidos: ApelidoSigla[] } = { cores: [], apelidos: [] };
/** R11 — siglas das cores/apelidos DA LOJA p/ o rótulo da variante (a matriz não traz os ids — `variante_key` é md5 de
 *  cor+apelido). Consulta própria, cacheada por loja (`.eq("tenant_id")` explícito: o super admin enxerga outras lojas);
 *  erro/carregando = sem siglas (só os nomes). `select("*")` como o card "Formato do SKU" (`sigla_sku` fora do types.ts). */
export function useSiglasCores(ativo: boolean): { cores: CorSigla[]; apelidos: ApelidoSigla[] } {
  const tenantId = useActiveTenantId();
  const q = useQuery({
    queryKey: ["plan-skus-siglas", tenantId],
    enabled: ativo && !!tenantId,
    queryFn: async () => {
      const [c, a] = await Promise.all([
        supabase.from("cores").select("*").eq("tenant_id", tenantId as string),
        supabase.from("cores_apelido").select("*").eq("tenant_id", tenantId as string),
      ]);
      if (c.error) throw c.error;
      if (a.error) throw a.error;
      return {
        cores: ((c.data ?? []) as any[]).map((x): CorSigla => ({ id: x.id, nome: x.nome, sigla: x.sigla_sku ?? null })),
        apelidos: ((a.data ?? []) as any[]).map((x): ApelidoSigla => ({ cor_base_id: x.cor_base_id ?? null, nome: x.nome, sigla: x.sigla_sku ?? null })),
      };
    },
  });
  return q.data ?? SEM_SIGLAS;
}
