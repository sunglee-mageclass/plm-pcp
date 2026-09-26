// Leitura e ações dos SKUs do card (F3.6 — seção "4. Códigos", F3.5b do SKU). SKU em PRÉVIA (spec
// 2026-09-25-sku-previa-regerar §4.2 — P-46 do dono): o Regerar e o SKU à mão NÃO gravam na hora. Ficam "a gravar"
// (useSkusAGravar — estado FORA do Draft, como as linhas de MO: R5); a prévia vem do SERVIDOR (RPC skus_previa — o MESMO
// plano da gravação, STABLE/só leitura) e o Salvar do card grava (aplicarAGravar → RPC aplicar_skus_modelo com a
// assinatura da prévia vista) DEPOIS do UPDATE do modelo. A 1ª geração segue automática pós-Salvar (gerarSeFaltar — spec
// SKU §4.2, R12; P-50 A da spec da prévia). Os wrappers conferem módulo, loja e EDITAR o Planejamento (_sku_guarda).
import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import {
  deveGerarPrimeiraVez, lerMatriz, resumoGeracao, type ApelidoSigla, type CorSigla, type LinhaSku, type MatrizSkus,
} from "./sku-card";
import {
  MSG_PREVIA_CALCULANDO, SKUS_A_GRAVAR_VAZIO, chaveEntradaPrevia, comRegerar, digitarSku, entradaDaChave, lerPrevia,
  manterMeu, manuaisParaRpc, mensagemAplicarSkus, mensagemErroPrevia, modoPrevia, nadaAGravar, resumoAplicacao, semManual,
  type LinhaPrevia, type PreviaSkus, type SkusAGravar,
} from "./sku-previa";

export const chaveSkus = (modeloId: string | null) => ["plan-skus", modeloId] as const;
export const prefixoPrevia = (modeloId: string | null) => ["plan-skus-previa", modeloId] as const;

async function lerSkus(modeloId: string): Promise<MatrizSkus> {
  const { data, error } = await supabase.rpc("skus_modelo" as any, { _modelo_id: modeloId });
  if (error) throw error;
  return lerMatriz(data);
}

/** O "a gravar" da seção Códigos. Declarado no orquestrador ANTES do `dirty` (o "não salvo" depende dele — R5). */
export function useSkusAGravar() {
  const [aGravar, setAGravar] = useState<SkusAGravar>(SKUS_A_GRAVAR_VAZIO);
  const ref = useRef(aGravar);
  ref.current = aGravar;
  const troca = (proximo: SkusAGravar) => { ref.current = proximo; setAGravar(proximo); };
  return {
    aGravar,
    /** leitura síncrona — o Salvar roda no onSuccess do save, fora do ciclo de render */
    atual: () => ref.current,
    pedirRegerar: () => troca(comRegerar(ref.current)),
    /** blur/Enter do SKU: devolve o erro PT (o campo faz o toast) e o valor que o campo deve mostrar */
    digitar: (l: LinhaSku | LinhaPrevia, texto: string): { erro: string | null; valor: string } => {
      const r = digitarSku(ref.current, l, texto);
      if (r.aGravar !== ref.current) troca(r.aGravar);
      return { erro: r.erro, valor: r.valor };
    },
    desfazerManual: (chave: string) => troca(semManual(ref.current, chave)),
    manterMeu: (l: LinhaSku) => troca(manterMeu(ref.current, l)),
    desfazerPrevia: () => troca(SKUS_A_GRAVAR_VAZIO),
    /** depois de gravar: só esvazia se nada mudou no voo (o que entrou depois continua "a gravar") */
    limparSe: (enviado: SkusAGravar) => { if (ref.current === enviado) troca(SKUS_A_GRAVAR_VAZIO); },
  };
}
export type SkusAGravarApi = ReturnType<typeof useSkusAGravar>;

/** Atrasa a troca de uma CHAVE (a entrada da prévia) — a REF é digitada letra a letra. */
function useChaveAtrasada(chave: string, ms: number): string {
  const [v, setV] = useState(chave);
  useEffect(() => {
    if (v === chave) return;
    const t = setTimeout(() => setV(chave), ms);
    return () => clearTimeout(t);
  }, [chave, v, ms]);
  return v;
}

/** `ativo` = card existente e o usuário vê o Planejamento; `podeEditar` = edita o Planejamento (prévia/Salvar/1ª geração). */
export function useSkusModelo(
  modeloId: string | null,
  ativo: boolean,
  podeEditar: boolean,
  o: { refPrevia: string; tamanhoTipo: "letra" | "numero"; aGravar: SkusAGravarApi },
) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: chaveSkus(modeloId),
    enabled: ativo && !!modeloId,
    queryFn: () => lerSkus(modeloId as string),
  });
  const aGravar = o.aGravar.aGravar;
  const temPrevia = !nadaAGravar(aGravar);
  const chave = chaveEntradaPrevia({ ref: o.refPrevia, tamanhoTipo: o.tamanhoTipo, aGravar });
  const chaveAtrasada = useChaveAtrasada(chave, 300);
  const pq = useQuery({
    queryKey: [...prefixoPrevia(modeloId), chaveAtrasada],
    enabled: ativo && podeEditar && !!modeloId && temPrevia,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<PreviaSkus> => {
      const e = entradaDaChave(chaveAtrasada);
      const { data, error } = await supabase.rpc("skus_previa" as any, {
        _modelo_id: modeloId, _ref: e.ref, _tamanho_tipo: e.tamanhoTipo, _manuais: e.manuais, _modo: e.modo,
      });
      if (error) throw error;
      return lerPrevia(data, chaveAtrasada);
    },
  });
  // Espelhos síncronos p/ o Salvar (onSuccess do save, fora do ciclo de render).
  const chaveRef = useRef(chave);
  chaveRef.current = chave;
  const previaRef = useRef<PreviaSkus | undefined>(pq.data);
  previaRef.current = pq.data;
  const buscandoRef = useRef(pq.isFetching);
  buscandoRef.current = pq.isFetching;
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: chaveSkus(modeloId) });
    qc.invalidateQueries({ queryKey: prefixoPrevia(modeloId) });
  };

  /** Salvar do card, DEPOIS do UPDATE do modelo: grava a prévia VISTA. Nunca lança. */
  const aplicarAGravar = async (): Promise<"nada" | "ok" | "falhou"> => {
    const s = o.aGravar.atual();
    if (nadaAGravar(s) || !modeloId) return "nada";
    const d = previaRef.current;
    if (!d || d.entrada !== chaveRef.current || buscandoRef.current || !d.assinatura) {
      toast.error(MSG_PREVIA_CALCULANDO);
      return "falhou";
    }
    if (d.erros.length > 0) {
      toast.error(mensagemErroPrevia(d.erros[0]));
      return "falhou";
    }
    try {
      const { data, error } = await supabase.rpc("aplicar_skus_modelo" as any, {
        _modelo_id: modeloId, _manuais: manuaisParaRpc(s), _modo: modoPrevia(s), _assinatura: d.assinatura,
      });
      if (error) throw error;
      o.aGravar.limparSe(s);
      const r = resumoAplicacao(data);
      if (r.erro) toast.error(r.texto);
      else toast.success(r.texto);
      return "ok";
    } catch (e) {
      toast.error(mensagemAplicarSkus(e));
      return "falhou";
    } finally {
      invalidar();
    }
  };

  /** Depois do Salvar: matriz FRESCA; card com REF e SEM SKU gravado ⇒ gera (`_regerar=false` só cria o que falta — P-50 A). */
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
    temPrevia,
    /** a prévia na tela (a última calculada — pode ser de uma entrada anterior enquanto a nova chega) */
    previa: temPrevia ? (pq.data ?? null) : null,
    previaCarregando: temPrevia && pq.isFetching,
    previaErro: temPrevia && pq.isError,
    refazerPrevia: () => { void pq.refetch(); },
    aplicarAGravar,
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
