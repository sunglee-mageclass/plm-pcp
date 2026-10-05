// urg R2 T12 — lista "Insumos padrão" da loja + catálogo de insumos, para o "+ Novo" e o "Criar vários cards".
// queryKey PRÓPRIA (CLAUDE.md: key única por tela), com a loja. `tenant_config.insumos_padrao` e o catálogo saem JUNTOS: a normalização
// precisa dos dois (órfão = insumo que não está no catálogo da loja). Erro de REDE lança no queryFn (a tela trava o Salvar com
// "Tentar de novo" — P-57); valor cru ruim NÃO é erro (a normalização ignora item a item).
// H1 (fix round 1): NUNCA se semeia de cache velho. `refetchOnMount: "always"` + `carregado` só vale com uma leitura BEM-SUCEDIDA feita
// DEPOIS de abrir (`isFetchedAfterMount`); a key também está em `TENANT_CONFIG_EXTRA_KEYS`/tokens de `etiquetas` (realtime-invalidation-map),
// então salvar a Config da Loja ou mexer num insumo a marca como velha. L2: uma vez carregado, um refetch de FUNDO que falha NÃO esconde o
// editor nem trava o Salvar (`erro` = só a 1ª carga).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import {
  recomputeEtiqueta,
  type EtiquetaInfo,
  type ModeloEtiquetaRow,
  type Opt,
} from "@/components/desenvolvimento/modelo-detail/types";
import { linhasParaRascunho } from "@/lib/insumos-iniciais";
import {
  normalizarInsumosPadraoParaCard,
  type InsumoPadraoLinhaCard,
} from "@/lib/insumos-padrao-normalizadores";

type Carga = { raw: unknown; etiquetas: EtiquetaInfo[] };
const SEM_ETIQUETAS: EtiquetaInfo[] = [];
const SEM_LINHAS: InsumoPadraoLinhaCard[] = [];

export function useInsumosPadrao(enabled: boolean) {
  const tenantId = useActiveTenantId();
  const q = useQuery({
    queryKey: ["planejamento-insumos-padrao", tenantId],
    enabled: enabled && !!tenantId,
    refetchOnMount: "always",
    queryFn: async (): Promise<Carga> => {
      // Colunas novas fora do types.ts → cast (CLAUDE.md).
      const [cfg, etq] = await Promise.all([
        (supabase.from("tenant_config") as any)
          .select("insumos_padrao")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabase
          .from("etiquetas" as any)
          .select(
            "id, nome, formato_tamanho, preco, tamanho_vinculado, variantes_etiqueta(cor_id, preco, tamanho, cor:cor_id(nome))",
          )
          .order("nome"),
      ]);
      if (cfg.error) throw cfg.error;
      if (etq.error) throw etq.error;
      const etiquetas = ((etq.data ?? []) as any[]).map((e) => ({
        id: e.id,
        nome: e.nome,
        formato_tamanho: e.formato_tamanho ?? "ambos",
        preco: e.preco,
        tamanho_vinculado: e.tamanho_vinculado ?? null,
        variantes: (e.variantes_etiqueta ?? []).map((v: any) => ({
          cor_id: v.cor_id,
          cor_nome: v.cor?.nome ?? null,
          preco: v.preco,
          tamanho: v.tamanho ?? null,
        })),
      })) as EtiquetaInfo[];
      return { raw: cfg.data?.insumos_padrao ?? null, etiquetas };
    },
  });
  // "Já houve uma leitura bem-sucedida FEITA DEPOIS de abrir" (por loja). Fica verdadeiro mesmo se um refetch de fundo falhar depois.
  const frescoRef = useRef<{ loja: string; ok: boolean }>({ loja: tenantId, ok: false });
  if (frescoRef.current.loja !== tenantId) frescoRef.current = { loja: tenantId, ok: false };
  if (enabled && q.isFetchedAfterMount && q.isSuccess) frescoRef.current.ok = true;
  const fresco = enabled && frescoRef.current.ok;

  const etiquetas = q.data?.etiquetas ?? SEM_ETIQUETAS;
  const etiquetaMap = useMemo(
    () => Object.fromEntries(etiquetas.map((e) => [e.id, e])) as Record<string, EtiquetaInfo>,
    [etiquetas],
  );
  const etiquetaOpts = useMemo<Opt[]>(
    () => etiquetas.map((e) => ({ id: e.id, nome: e.nome })),
    [etiquetas],
  );
  const normalizada = useMemo(
    () =>
      q.data
        ? normalizarInsumosPadraoParaCard(q.data.raw, etiquetaMap)
        : { linhas: SEM_LINHAS, orfaos: 0 },
    [q.data, etiquetaMap],
  );
  return {
    /** Linhas válidas da lista da loja (já filtradas pelo catálogo, ≤ 20). SÓ confie nelas com `carregado`. */
    linhas: normalizada.linhas,
    orfaos: normalizada.orfaos,
    etiquetaMap,
    etiquetaOpts,
    /** Leitura FRESCA (feita depois de abrir) concluída com sucesso. */
    carregado: fresco,
    /** 1ª carga em andamento (a query habilitada ainda não trouxe uma leitura fresca nem errou). */
    carregando: enabled && !fresco && (!tenantId || !q.isError),
    /** Erro de rede/servidor na 1ª carga (trava o Salvar; "Tentar de novo" = `refetch`). Refetch de fundo que falha depois NÃO conta. */
    erro: enabled && !fresco && q.isError,
    tentarDeNovo: () => {
      void q.refetch();
    },
  };
}

const chaveLinhas = (rows: ModeloEtiquetaRow[]) =>
  JSON.stringify(rows.map((r) => [r.etiqueta_id, r.cor_id, r.consumo, r.loss_percent]));

/**
 * Rascunho da seção "Insumos" do Dialog "Novo Modelo": semeado UMA vez a partir da lista da loja (leitura fresca), editável, com
 * "não salvo" só quando a pessoa mexe. `rowsRef` = espelho síncrono para o Salvar.
 */
export function useInsumosNovosRascunho(enabled: boolean) {
  const padrao = useInsumosPadrao(enabled);
  const [rows, setRows] = useState<ModeloEtiquetaRow[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const baseRef = useRef("[]");
  const [semeado, setSemeado] = useState(false);
  useEffect(() => {
    if (!enabled || semeado || !padrao.carregado) return;
    const semente = linhasParaRascunho(padrao.linhas, padrao.etiquetaMap);
    baseRef.current = chaveLinhas(semente);
    setRows(semente);
    setSemeado(true);
  }, [enabled, semeado, padrao.carregado, padrao.linhas, padrao.etiquetaMap]);
  const dirty = enabled && semeado && chaveLinhas(rows) !== baseRef.current;
  const mudarLinha = (idx: number, patch: Partial<ModeloEtiquetaRow>) =>
    setRows((rs) =>
      rs.map((r, i) => (i === idx ? recomputeEtiqueta({ ...r, ...patch }, padrao.etiquetaMap) : r)),
    );
  return { padrao, rows, setRows, rowsRef, dirty, semeado, mudarLinha };
}
