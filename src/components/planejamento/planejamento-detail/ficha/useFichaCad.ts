// F3.3 — estado EDITÁVEL da seção "CAD" no Sheet do Planejamento. PORTA (cópia) do PanelContent do Desenvolvimento
// (ModeloDetailPanel.tsx — estado :567-570, carga :1040-1174, handlers :1176-1220, folhas automáticas :1222-1269,
// rótulos :1271-1312, sincronia :1314-1386), que fica INTOCADO até a F5 (decisão travada 8). Diferenças DELIBERADAS
// (plano F3.3 §7):
//  • T1 — a carga é AMARRADA à do BOM (`cargaSeq` do useFichaBom): mesmos dados estáveis (o CAD entra no
//    `bomFetching`), nunca com a ficha tocada, e reaplica no "usar o novo" (hidratarTick → nova carga); espera os
//    catálogos (preço/largura/nome das linhas semeadas do BOM — no Dev a semeadura podia sair com preço 0);
//  • T2 — toda edição do CAD marca o "tocado" da ficha (no Dev só consumo/%loss marcavam);
//  • T4 — a sincronia cria a linha de um tecido novo na hora e tira a linha ainda não gravada de um bloco esvaziado;
//  • T7 — ao hidratar, entrega a assinatura do CAD do SERVIDOR (a referência do conflito "Tecidos & BOM").
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { GradeRow, TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import {
  assinaturaCadServidor, atualizarLinhaCad, atualizarVarianteCad, calcularFolhasAuto, faltasCad, hidratarCad,
  idsVariantesDosBlocos, propagarBlocoParaCad, sincronizarCadComBlocos,
  type CadTecidoRow, type CadVarianteRow, type PatchBlocoCad, type RotulosVariante,
} from "./ficha-cad";
import type { FichaDados } from "./useFichaDados";

const SEM_LINHAS: CadTecidoRow[] = [];
const SEM_ROTULOS: RotulosVariante = {};

export function useFichaCad({
  modeloId, habilitada, dados, cargaSeq, blocks, grades, proporcoes, marcarTocado, aplicarConsumoNoBom, aoHidratar,
}: {
  modeloId: string | null;
  habilitada: boolean;
  dados: FichaDados;
  /** `useFichaBom.cargaSeq` — sobe a cada carga do BOM (sem toque, com as 6 queries estáveis). */
  cargaSeq: number;
  blocks: TecidoBlock[];
  grades: GradeRow[];
  proporcoes: Record<string, number>;
  marcarTocado: () => void;
  /** CAD → BOM (Dev :1187-1210): consumo/%loss editados no CAD vão ao bloco do mesmo tipo+número. */
  aplicarConsumoNoBom: (tipo: string, numero: number, patch: { consumo?: number; loss_percent?: number }) => void;
  /** Chamado a cada hidratação com a assinatura do CAD do SERVIDOR (referência do conflito). */
  aoHidratar: (assinaturaServidor: string) => void;
}) {
  const [linhas, setLinhas] = useState<CadTecidoRow[]>(SEM_LINHAS);
  // Folhas/metragem automáticas DESLIGADAS por padrão (Dev :569).
  const [autoFolhas, setAutoFolhasState] = useState(false);
  const [hidratado, setHidratado] = useState(false);
  const linhasRef = useRef(linhas);
  linhasRef.current = linhas;
  const aplicadaRef = useRef(0);
  const aoHidratarRef = useRef(aoHidratar);
  aoHidratarRef.current = aoHidratar;

  // Trocar de card na MESMA instância zera tudo (Dev :675).
  useEffect(() => {
    setLinhas(SEM_LINHAS);
    setAutoFolhasState(false);
    setHidratado(false);
    aplicadaRef.current = 0;
  }, [modeloId]);

  const ctx = useMemo(() => ({ artigoMap: dados.artigoMap, frozen: dados.frozenPrecos }), [dados.artigoMap, dados.frozenPrecos]);

  // Carga (Dev :1040-1174): 1× por carga do BOM (`cargaSeq`), com os catálogos prontos e nada recarregando.
  useEffect(() => {
    if (!habilitada || cargaSeq === 0 || cargaSeq === aplicadaRef.current) return;
    if (!dados.catalogosProntos || dados.bomFetching) return;
    const tec = dados.tecidosData;
    if (!tec || dados.cadData === undefined) return;
    aplicadaRef.current = cargaSeq;
    setLinhas(hidratarCad({ cad: dados.cadData, bomTecidos: tec.tecidos, bomVariantes: tec.variantes, artigoMap: ctx.artigoMap, frozen: ctx.frozen }));
    setHidratado(true);
    aoHidratarRef.current(assinaturaCadServidor(dados.cadData));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitada, cargaSeq, dados.catalogosProntos, dados.bomFetching]);

  // Rótulos de TODAS as variantes dos blocos (Dev :1271-1312) — variante nova aparece com nome na hora.
  const idsVariantes = useMemo(() => idsVariantesDosBlocos(blocks), [blocks]);
  const qRotulos = useQuery({
    queryKey: ["plan-ficha-cad-rotulos", idsVariantes.join(",")],
    enabled: habilitada && idsVariantes.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("id", idsVariantes);
      if (error) throw error;
      const map: RotulosVariante = {};
      (data ?? []).forEach((v: any) => {
        map[v.id] = { nome: v.nome_variante ?? v.codigo_variante ?? null, cor: v.cor?.nome ?? null, apelido: v.apelido?.nome ?? null };
      });
      return map;
    },
  });
  const rotulos = qRotulos.data ?? SEM_ROTULOS;

  // Sincronia BOM → CAD depois da carga (Dev :1314-1386 + T4). Devolve a MESMA referência quando nada muda.
  useEffect(() => {
    if (!hidratado) return;
    setLinhas((prev) => sincronizarCadComBlocos(prev, blocks, rotulos, ctx));
  }, [hidratado, blocks, rotulos, ctx]);

  // Folhas/metragem automáticas (Dev :1222-1269). Idempotente (mesma referência quando nada muda) — sem laço.
  useEffect(() => {
    if (!autoFolhas) return;
    setLinhas((prev) => calcularFolhasAuto(prev, grades, proporcoes));
  }, [autoFolhas, grades, proporcoes, linhas]);

  // Handlers da seção (Dev :1176-1220) — T2: TODA edição marca o "tocado" da ficha.
  const updateTec = (i: number, patch: Partial<CadTecidoRow>) => {
    marcarTocado();
    setLinhas((prev) => atualizarLinhaCad(prev, i, patch));
    if (patch.consumo_cad !== undefined || patch.loss_percent_cad !== undefined) {
      const t = linhasRef.current[i];
      if (t) aplicarConsumoNoBom(t.tipo, t.numero, { consumo: patch.consumo_cad, loss_percent: patch.loss_percent_cad });
    }
  };
  const updateVar = (i: number, j: number, patch: Partial<CadVarianteRow>) => {
    marcarTocado();
    setLinhas((prev) => atualizarVarianteCad(prev, i, j, patch));
  };
  // Ligar o automático recalcula folhas/metragem (edição); desligar não muda valor.
  const setAutoFolhas = (v: boolean) => {
    if (v) marcarTocado();
    setAutoFolhasState(v);
  };
  /** BOM → CAD (Dev :2441-2456 + artigo, T4) — chamado pelo `updateBlock`/Importar do useFichaBom. */
  const propagarDoBloco = (tipo: string, numero: number, patch: PatchBlocoCad) => {
    setLinhas((prev) => propagarBlocoParaCad(prev, tipo, numero, patch, ctx));
  };

  const faltas = useMemo(() => faltasCad(linhas), [linhas]);

  return { linhas, linhasRef, hidratado, autoFolhas, setAutoFolhas, faltas, updateTec, updateVar, propagarDoBloco };
}
