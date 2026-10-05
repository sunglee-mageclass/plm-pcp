import { useEffect, useMemo, useRef, useState } from "react";
import { mensagemToastPosSavePcp } from "@/lib/cq-status-tela";
import { brl, fmtNum } from "@/lib/format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Users, Save, Plus, Trash2, FileText, Pencil, Printer, Undo2, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { corApelidoLabelServico } from "@/lib/variante";
import { somaCustosAdicionais } from "@/lib/custo";
import type { MoLinha, EstadoMO } from "@/lib/mao-obra";
import { type CelulaGrade, type GradeDetalhe, CELULA_ZERO, somaCampo as somaGrade, saldoCelula, recebidaExcedeCortada, celulasRecebidaAcimaCortada } from "@/lib/grade-cortada";
import { comRotuloColecao } from "@/lib/colecao-rotulo";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import { textoApagarTodosServicos } from "@/lib/confirmacoes-textos";
import { ehApagarTudoPendente, exigirConfirmacaoApagarTudo, MARCA_APAGAR_TUDO_SERVICOS } from "@/lib/apagar-tudo";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useAuth } from "@/hooks/useAuth";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";
import { ModeloResumoMeta } from "@/components/shared/ModeloResumoMeta";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { InfoHover } from "@/components/shared/InfoHover";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useReadOnly } from "@/components/RequirePermission";
import { VerificarRevisao } from "@/components/producao/RevisaoErro";
import { ReverterImpacto } from "@/components/producao/ReverterImpacto";
import { useReverterImpacto } from "@/hooks/useReverterImpacto";
import { printWithImages } from "@/lib/print";
import { FichaTecnica } from "@/components/producao/FichaTecnica";
import { OrdemServicoTerceirizados, type OSItem } from "@/components/producao/OrdemServicoTerceirizados";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { pathDoElemento } from "@/lib/colab/colab-field-path";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeLinhas, igual, type Conflito } from "@/lib/colab/merge";
import { juntarConflitos, baseSemAvancarEmConflito, baseComLinhaResolvida, semConflitosDeLinha } from "@/lib/colab/conflitos-pendentes";
import { mergeGrade } from "@/lib/colab/merge-grade";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useRequerModulo } from "@/hooks/useRequerModulo";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { isServicoPL } from "@/lib/servico-confeccao";
import { EtapasPlPanel } from "@/components/producao/EtapasPlPanel";
import { ReprovadasPl } from "@/components/producao/ReprovadasPl";
import { ETAPAS_DEFAULT, type EtapaCfg } from "@/lib/pcp-etapas";
import { NfList, type NfItem } from "@/components/oc-tecido/NfList";
import { type AviamentoEnviado, type BlocoServico, blocoDeLinha, blocoParaPayload } from "@/lib/servicos-payload";
import { tenantPrefix, sanitizeStorageName } from "@/lib/storage-tenant";

export const Route = createFileRoute("/_authenticated/pcp/servicos/$modeloId")({
  component: TercDetailPage,
});

// Colab (spec 2026-08-07): rótulos PT dos paths do banner de resolução genérica.
const ROTULO_CONFLITO: Record<string, string> = {
  categoria_terceirizado_id: "Serviço",
  empresa_id: "Fornecedor",
  representante_id: "Representante",
  colaborador_id: "Colaborador",
  preco_metro_unidade: "Preço unit.",
  quantidade_enviada: "Qtd. enviada",
  quantidade_recebida: "Qtd. recebida",
  quantidade_defeito: "Qtd. defeito",
  desconto_total: "Desconto",
  multa_total: "Multa",
  numero_parcelas: "Nº de parcelas",
  data_enviado: "Data de envio",
  data_prevista: "Data prevista",
  data_entregue: "Data de entrega",
  observacao: "Observação",
  pt_data_saida: "Peça Teste — Saída",
  pt_data_entrada: "Peça Teste — Entrada",
  pt_aprovacao: "Peça Teste — Aprovação",
};
const CAMPO_GRADE_PT: Record<string, string> = {
  enviada: "Enviada", cortada: "Cortada", recebida: "Recebida", defeito: "Defeito",
};
function rotuloConflito(path: string): string {
  if (path.startsWith("linha:")) return "Bloco de serviço";
  if (path.startsWith("grade:")) {
    const [, , tam, campo] = path.split(":");   // grade:{vid}:{tam}:{campo}
    return `${CAMPO_GRADE_PT[campo] ?? campo} · ${tam}`;
  }
  return ROTULO_CONFLITO[path] ?? path;
}

// Tipos/leitura/payload do bloco: fonte única em src/lib/servicos-payload.ts (também usada pela edição rápida de Etapas PL).
type Bloco = BlocoServico;

// Tom §Q9 por status de bloco/serviço (campanha StatusBadge, ago/2026). pre_finalizado
// (Pré confirmado, Pós ainda não) fica no mesmo tom "em progresso" de em_andamento —
// a distinção de fato mora no LABEL, não há um 6º tom pra um estado intermediário.
const STATUS_TONE: Record<string, StatusTone> = {
  pendente: "warning",
  em_andamento: "info",
  finalizado: "success",
  pre_finalizado: "info",
  sem_selecao: "neutral",
};
const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  finalizado: "Finalizado",
  pre_finalizado: "Pré finalizado",
  sem_selecao: "Sem seleção",
};

// Um bloco só conta como FINALIZADO (trava automática) quando tem data de entrega E foi
// de fato movimentado: qtd enviada > 0 e (qtd recebida > 0 OU qtd defeito > 0). Só a data
// não basta.
function blocoFinalizado(b: {
  data_entregue: string | null;
  quantidade_enviada: number;
  quantidade_recebida: number;
  quantidade_defeito: number;
}): boolean {
  return (
    !!b.data_entregue &&
    Number(b.quantidade_enviada) > 0 &&
    (Number(b.quantidade_recebida) > 0 || Number(b.quantidade_defeito) > 0)
  );
}

function TercDetailPage() {
  const { modeloId } = Route.useParams();
  return <TerceirizadosDetail modeloId={modeloId} />;
}

export function TerceirizadosDetail({
  modeloId,
  onClose,
  onForceClose,
  onDirtyChange,
}: {
  modeloId: string;
  onClose?: () => void;
  onForceClose?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const { canView } = useAuth();
  const podeVerPrecos = canView("producao_terceirizados:precos");

  // Etapas PL (Fase 1, módulo opt-in): painel só aparece quando a loja ligou `etapas_pl`.
  const { isModuleEnabled } = useTenantModules();
  const tenantId = useActiveTenantId();
  const { data: pcpEtapasCfg } = useQuery({
    queryKey: ["tenant_config", "pcp_etapas", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("pcp_etapas")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      const raw = (data as any)?.pcp_etapas;
      return Array.isArray(raw) && raw.length ? (raw as EtapaCfg[]) : ETAPAS_DEFAULT;
    },
    staleTime: 5 * 60_000,
  });
  const etapasCfg = pcpEtapasCfg ?? ETAPAS_DEFAULT;

  const { data: modelo } = useQuery({
    queryKey: ["terc-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("modelos") as any)
        .select("id, ref, nome, colecao, colecoes(nome), subcolecao, semana, categoria_principal_id, custos_adicionais, custo_terceirizados_aprovado, fotos_modelo, desenho_tecnico_url, croqui_url, mes:mes_id(mes), ano:ano_id(ano)")
        .eq("id", modeloId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      let categoria_nome: string | null = null;
      if (data.categoria_principal_id) {
        const { data: cat } = await supabase
          .from("categorias_produto")
          .select("nome")
          .eq("id", data.categoria_principal_id)
          .maybeSingle();
        categoria_nome = cat?.nome ?? null;
      }
      return { ...comRotuloColecao(data), categoria_nome }; // [modularidade R11] `colecao` = rótulo
    },
  });

  // Fix hidratação — revisão final (achado C2, PERDA DE DADO comprovada, review-final.md):
  // engolia o erro (`const { data } = ...; return data;`) — uma falha única virava sucesso com
  // `data=null`, sem retry. `moldeHydrated` (abaixo) semeava `observacoesMolde=""` a partir desse
  // `null` e nunca mais re-hidratava; o Salvar então mandava `_observacoes_molde: null`, e o
  // servidor grava `NULLIF(...)` — apaga "Partes do Molde" (`cad.observacoes_molde`, campo
  // compartilhado com CAD/Ficha de Corte/Oficina). Único consumidor da key `["terc-cad",
  // modeloId]` (conferido por grep) — seguro trocar o `queryFn` sem afetar outra tela.
  // [camada C3 · m-A] sucesso sem linha = `null` (CAD inexistente de verdade); falha na 1ª carga = `cadErro` (aviso +
  // "Tentar de novo", sem corpo, sem "sem CAD", Salvar travado). Refetch com erro depois de sucesso mantém o último dado.
  const { data: cad, isSuccess: cadOk, isFetching: cadFetching, isError: cadErrored, refetch: refetchCad } = useQuery({
    queryKey: ["terc-cad", modeloId],
    retry: 1, // [camada C3 · B1] aviso honesto em ~1s, não nos 3 retries padrão (~7s)
    queryFn: async () => {
      const { data, error } = await supabase.from("cad").select("*").eq("modelo_id", modeloId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });


  // Grade Total Geral (soma das grades do CAD) — exibida no cabeçalho.
  // [camada C3 · m-A] lança o erro (antes: `data ?? []` somava 0 e o cabeçalho mostrava "Grade Total Geral 0,00"
  // numa falha de carga). Falha na 1ª carga -> "—" + aviso com "Tentar de novo" (`custoAuxErro`, abaixo).
  const { data: gradeTotalRaw, isError: gradeTotalErrored, isFetching: gradeTotalFetching, refetch: refetchGradeTotal } = useQuery({
    queryKey: ["terc-grade-total", cad?.id],
    enabled: !!cad?.id,
    retry: 1, // [camada C3 · B1]
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cad_grades")
        .select("grade_total_planejada, grade_total_real")
        .eq("cad_id", cad!.id);
      if (error) throw error;
      return (data ?? []).reduce(
        (a: number, g: any) => a + Number(g.grade_total_real ?? g.grade_total_planejada ?? 0),
        0,
      );
    },
  });

  const gradeTotalGeral = gradeTotalRaw ?? 0;

  // Custo de materiais do CAD por peça (tecidos + aviamentos) — base do custo real.
  // [camada C3 · m-A] lança o erro de qualquer das 2 leituras (antes: custo de materiais 0 silencioso).
  const { data: materiaisRaw, isError: materiaisErrored, isFetching: materiaisFetching, refetch: refetchMateriais } = useQuery({
    queryKey: ["terc-cad-materiais", cad?.id],
    enabled: !!cad?.id,
    retry: 1, // [camada C3 · B1]
    queryFn: async () => {
      const [tecRes, aviRes] = await Promise.all([
        supabase.from("cad_tecidos").select("custo_cad, consumo_cad, loss_percent_cad, artigos:artigo_id(preco_por_metro)").eq("cad_id", cad!.id),
        supabase.from("cad_aviamentos").select("consumo, aviamentos:aviamento_id(preco)").eq("cad_id", cad!.id),
      ]);
      if (tecRes.error) throw tecRes.error;
      if (aviRes.error) throw aviRes.error;
      const tec = (tecRes.data ?? []).reduce((s: number, t: any) =>
        s + (t.custo_cad != null
          ? Number(t.custo_cad)
          : (Number(t.consumo_cad) || 0) * (1 + (Number(t.loss_percent_cad) || 0) / 100) * (Number(t.artigos?.preco_por_metro) || 0)), 0);
      const avi = (aviRes.data ?? []).reduce((s: number, a: any) =>
        s + (Number(a.consumo) || 0) * (Number(a.aviamentos?.preco) || 0), 0);
      return tec + avi;
    },
  });
  const materiaisPorPeca = materiaisRaw ?? 0;
  // Grade/custo do CAD sem dado por falha (1ª carga): mostra "—" e o aviso com "Tentar de novo"; refetch com erro mantém o valor.
  const gradeTotalErro = gradeTotalErrored && gradeTotalRaw === undefined;
  const materiaisErro = materiaisErrored && materiaisRaw === undefined;
  const custoAuxErro = gradeTotalErro || materiaisErro;
  // [camada C3 fix1 · B3] "—" também ENQUANTO carrega/repete (CAD existe e o valor ainda não chegou), nunca "0,00" por falta de dado.
  const gradeTotalPendente = !!cad?.id && gradeTotalRaw === undefined;
  const custoPendente = gradeTotalPendente || (!!cad?.id && materiaisRaw === undefined);

  // Colaboradores (Cadastro > Colaboradores) — responsáveis quando o serviço é Interno.
  const { data: colaboradores = [] } = useQuery({
    queryKey: ["colaboradores-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("colaboradores")
        .select("id, nome, tipo")
        .order("nome");
      return (data ?? []) as { id: string; nome: string; tipo: string }[];
    },
  });

  // Tipos de colaborador → categoria de terceirizado, para filtrar o responsável
  // interno pela categoria do serviço (ex.: Corte interno → só colaboradores de Corte).
  const { data: tiposColaborador = [] } = useQuery({
    // Chave distinta da página de Colaboradores (select diferente) — mas com o
    // mesmo prefixo, então a invalidação ["tipos-colaborador"] de lá também atinge esta.
    queryKey: ["tipos-colaborador", "categoria-map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tipos_colaborador" as any)
        .select("nome, categoria_terceirizado_id");
      return ((data ?? []) as unknown) as { nome: string; categoria_terceirizado_id: string | null }[];
    },
  });
  // categoria_terceirizado_id (string) → Set de nomes de tipo ligados a ela.
  const tiposPorCategoria = useMemo(() => {
    const m = new Map<string, Set<string>>();
    tiposColaborador.forEach((t) => {
      if (!t.categoria_terceirizado_id) return;
      const set = m.get(t.categoria_terceirizado_id) ?? new Set<string>();
      set.add(t.nome);
      m.set(t.categoria_terceirizado_id, set);
    });
    return m;
  }, [tiposColaborador]);
  const colaboradoresDaCategoria = (catId: string) => {
    const tipos = tiposPorCategoria.get(catId);
    if (!tipos) return [];
    return colaboradores.filter((c) => tipos.has(c.tipo));
  };

  const { data: categorias = [], error: categoriasError, isLoading: categoriasLoading } = useQuery({
    queryKey: ["categorias_terceirizado"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("categorias_terceirizado") as any)
        .select("id, nome, etapa, ativo")
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Empresas de serviço (tipo='servico') com suas categorias e representantes —
  // a fonte única do responsável (ramo PL). Grava empresa_id direto no bloco.
  const { data: empresasServico = [] } = useQuery({
    queryKey: ["empresas-servico-sel"],
    queryFn: async () => {
      const { data } = await supabase
        .from("empresas")
        .select(
          "id, nome_fantasia, prazo_pagamento, empresa_categorias_servico(categoria_terceirizado_id), representantes(id, nome)",
        )
        .eq("tipo", "servico");
      return (data ?? []) as any[];
    },
  });
  // [urg R4b] sem `!inner`: o fornecedor da M.O. pode ser qualquer empresa de serviço (P-289 C), mesmo sem vínculo com categoria —
  // com `!inner` ela nem vinha na lista e o Select do bloco nascido da M.O. ficava vazio. O filtro por categoria é o abaixo.
  // Filtra empresas pela categoria do bloco (mesmo padrão do filtro por categoria de hoje).
  const empresasDaCategoria = (catId: string) =>
    (empresasServico as any[]).filter((e) =>
      (e.empresa_categorias_servico ?? []).some((c: any) => c.categoria_terceirizado_id === catId),
    );

  const { data: aviamentosModelo = [] } = useQuery({
    // ⚠️ queryKey PRÓPRIA (não `["modelo-aviamentos", …]` do Desenvolvimento): as duas telas leem
    // a MESMA tabela com SHAPES diferentes; key compartilhada = cache cross-read (a classe de bug
    // que já derrubou tela nesta base — ver CLAUDE.md). Sem invalidação cruzada intencional.
    queryKey: ["pcp-modelo-aviamentos", modeloId],
    queryFn: async () => {
      // Embed da variante (cor base + apelido) escolhida no Desenvolvimento (item 2).
      // `variantes_aviamento` ainda não está no types.ts gerado → cast.
      const { data } = await supabase
        .from("modelo_aviamentos" as any)
        .select("aviamento_id, variante_aviamento_id, aviamentos:aviamento_id(id, codigo_nome), variante:variante_aviamento_id(cor:cor_id(nome), apelido:cor_apelido_id(nome))")
        .eq("modelo_id", modeloId);
      // FF#2 (ago/2026): 1 botão por AVIAMENTO × VARIANTE. O BOM pode repetir o MESMO
      // (aviamento, variante) em várias linhas (consumos distintos) → dedup pela CHAVE COMPOSTA
      // (aviamento_id + variante_aviamento_id). Aviamento sem variante = 1 botão (variante null).
      const byKey = new Map<string, { aviamento_id: string; variante_aviamento_id: string | null; nome: string }>();
      for (const r of (data ?? []) as any[]) {
        const aid = r.aviamentos?.id ?? r.aviamento_id;
        if (!aid) continue;
        const vid = (r.variante_aviamento_id ?? null) as string | null;
        const key = `${aid}::${vid ?? ""}`;
        if (byKey.has(key)) continue;
        const cor = r.variante?.cor?.nome ?? null;
        const apel = r.variante?.apelido?.nome ?? null;
        // Em Serviços o apelido vem na frente (apelido - cor), padrão do bloco de tecidos.
        const varLabel = cor || apel ? corApelidoLabelServico(cor, apel) : null;
        const codigo = r.aviamentos?.codigo_nome ?? "—";
        byKey.set(key, {
          aviamento_id: aid,
          variante_aviamento_id: vid,
          nome: varLabel ? `${codigo} · ${varLabel}` : codigo,
        });
      }
      return [...byKey.values()];
    },
  });

  // Tecidos / forros / entretelas do modelo (com variantes), para marcar quais
  // variantes foram enviadas em cada bloco.
  const { data: tecidosModelo = [] } = useQuery({
    queryKey: ["modelo-tecidos-terc", modeloId],
    queryFn: async () => {
      const { data } = await supabase
        .from("modelo_tecidos")
        .select(
          "id, tipo, numero, artigos:artigo_id(nome), modelo_tecido_variantes(id, ordem, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))",
        )
        .eq("modelo_id", modeloId)
        .order("numero");
      return (data ?? []).map((r: any) => ({
        id: r.id as string,
        tipo: (r.tipo ?? "tecido") as string,
        nome: r.artigos?.nome ?? "—",
        variantes: (r.modelo_tecido_variantes ?? [])
          .map((v: any) => ({
            id: v.id as string,
            label:
              (v.variantes_tecido?.cor?.nome || v.variantes_tecido?.apelido?.nome)
                ? corApelidoLabelServico(v.variantes_tecido?.cor?.nome, v.variantes_tecido?.apelido?.nome)
                : v.variantes_tecido?.nome_variante ||
                  v.variantes_tecido?.codigo_variante ||
                  `Variante ${v.ordem ?? ""}`.trim(),
          }))
          .filter((v: any) => v.id),
      }));
    },
  });

  // Template da GRADE (p/ o modo "por tamanho/variante"): variantes do Tecido 1 × tamanhos da grade
  // PLANEJADA (modelo_grades). Chaveado por variante_tecido_id; `planejado` pré-preenche a Enviada.
  const { data: gradeTpl } = useQuery({
    queryKey: ["modelo-grade-tpl", modeloId],
    queryFn: async () => {
      const { data: mt } = await supabase
        .from("modelo_tecidos")
        .select("numero, modelo_tecido_variantes(ordem, variante_tecido_id, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
        .eq("modelo_id", modeloId).eq("numero", 1).limit(1);
      const rawVars = ((mt?.[0] as any)?.modelo_tecido_variantes ?? []) as any[];
      const variantes = rawVars
        .filter((v) => v.variante_tecido_id)
        .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0))
        .map((v, i) => ({
          id: v.variante_tecido_id as string,
          ordem: Number(v.ordem) || (i + 1),
          label: (v.variantes_tecido?.cor?.nome || v.variantes_tecido?.apelido?.nome)
            ? corApelidoLabelServico(v.variantes_tecido?.cor?.nome, v.variantes_tecido?.apelido?.nome)
            : v.variantes_tecido?.nome_variante || v.variantes_tecido?.codigo_variante || `Variante ${v.ordem ?? i + 1}`,
        }));
      const { data: mg } = await supabase.from("modelo_grades").select("variante_numero, grades").eq("modelo_id", modeloId);
      const byNum = new Map<number, Record<string, number>>();
      for (const g of (mg ?? []) as any[]) byNum.set(Number(g.variante_numero), (g.grades ?? {}) as Record<string, number>);
      // tamanhos = união das chaves de grade, ordenadas pelo prefixo numérico ("38|P")
      const tamSet = new Set<string>();
      for (const g of byNum.values()) for (const t in g) tamSet.add(t);
      const tamanhos = [...tamSet].sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
      const planejado: Record<string, Record<string, number>> = {};
      for (const v of variantes) planejado[v.id] = byNum.get(v.ordem) ?? {};
      return { variantes: variantes.map((v) => ({ id: v.id, label: v.label })), tamanhos, planejado };
    },
  });
  const tamLabel = (t: string) => (t.includes("|") ? t.split("|")[1] || t : t);

  const { data: existing = [], refetch, isFetched: existingFetched, isFetching: existingFetching, isSuccess: existingOk, isError: existingErrored } = useQuery({
    queryKey: ["producao-terc", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("producao_terceirizados")
        .select("*")
        .eq("cad_id", cad!.id)
        .eq("ativo", true)
        // [urg R4b] ordem estável: os blocos que nascem da M.O. no Enviar à Explosão têm created_at crescente na ordem da M.O.
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [blocos, setBlocos] = useState<Bloco[]>([]);

  // Colab (spec 2026-08-07): merge 3-vias no refetch/Realtime em vez de re-seed às cegas.
  const touchedBlocoIdsRef = useRef<Set<string>>(new Set());   // blocos com escalar editado
  const touchedGradeRef = useRef<Set<string>>(new Set());      // células "grade:{vid}:{tam}:{campo}"
  const baseBlocosRef = useRef<Bloco[] | null>(null);          // último "fresh" visto (por bloco)
  const revByBlocoRef = useRef<Record<string, number>>({});    // bloco.id → rev do servidor
  const retryRef = useRef(false);
  const savingRef = useRef(false);
  const blocosLiveRef = useRef(blocos);
  blocosLiveRef.current = blocos;
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const conflitosRef = useRef<Conflito[]>([]);
  const [campoFocado, setCampoFocado] = useState<string | null>(null);
  // Ring de presença por campo: o foco é derivado no container (pathDoElemento) — os campos de grade
  // usam o MESMO path do merge (`grade:${vid}:${tam}:${campo}`) e os escalares `bloco:${id}:${campo}`.
  const colabScopeRef = useRef<HTMLDivElement>(null);

  // Setter rastreado: difere prev→next por bloco (id) e por célula da grade; marca o touched.
  // Mantém a assinatura de setBlocos (zero mudança nos filhos que já chamam setBlocos).
  const setBlocosTracked: typeof setBlocos = (upd) =>
    setBlocos((prev) => {
      const next = typeof upd === "function" ? (upd as (p: Bloco[]) => Bloco[])(prev) : upd;
      // Bloco REMOVIDO (id persistido que sumiu): marca o id p/ o merge não ressuscitá-lo como "linha nova do servidor" (mergeLinhas.removidasIds).
      for (const p of prev) if (p.id && !next.some((b) => b.id === p.id)) touchedBlocoIdsRef.current.add(p.id);
      for (const b of next) {
        if (!b.id) continue;
        const p = prev.find((x) => x.id === b.id);
        if (!p) continue;
        // escalares do bloco (tudo menos grade_detalhe/_key)
        for (const k of Object.keys(b) as (keyof Bloco)[]) {
          if (k === "grade_detalhe" || k === "_key") continue;
          if (!igual(b[k], p[k])) touchedBlocoIdsRef.current.add(b.id);
        }
        // células da grade
        const vids = new Set([...Object.keys(b.grade_detalhe ?? {}), ...Object.keys(p.grade_detalhe ?? {})]);
        for (const vid of vids) {
          const tams = new Set([...Object.keys(b.grade_detalhe?.[vid] ?? {}), ...Object.keys(p.grade_detalhe?.[vid] ?? {})]);
          for (const tam of tams) for (const campo of ["enviada", "cortada", "recebida", "defeito"] as const) {
            const a = Number(b.grade_detalhe?.[vid]?.[tam]?.[campo]) || 0;
            const c = Number(p.grade_detalhe?.[vid]?.[tam]?.[campo]) || 0;
            if (a !== c) touchedGradeRef.current.add(`grade:${vid}:${tam}:${campo}`);
          }
        }
      }
      return next;
    });

  // Abas Pré (até costura) / Pós (pós costura = "acabamento") — filtram categorias e blocos.
  const [tabEtapa, setTabEtapa] = useState<"ate_costura" | "pos_costura">("ate_costura");
  const catEtapa = (id: string) => (categorias as any[]).find((c) => c.id === id)?.etapa ?? "ate_costura";
  const [printTarget, setPrintTarget] = useState<"ficha" | "os">("ficha");

  // Itens da Ordem de Serviço: um por bloco COM responsável (terceirizado ou colaborador interno).
  const osItens = useMemo<OSItem[]>(() => {
    const aviLabel = (e: AviamentoEnviado) =>
      (aviamentosModelo as any[]).find(
        (a) => a.aviamento_id === e.aviamento_id && (a.variante_aviamento_id ?? null) === (e.variante_aviamento_id ?? null),
      )?.nome ?? null;
    const tecLabel = (id: string) => {
      for (const t of tecidosModelo as any[]) {
        const v = (t.variantes ?? []).find((vv: any) => vv.id === id);
        if (v) return `${t.nome} - ${v.label}`;
      }
      return null;
    };
    // Nome da empresa + " (via {rep})" quando há representante; "direto" quando não.
    const empresaLabel = (empresaId: string | null, repId: string | null) => {
      const emp = (empresasServico as any[]).find((e) => e.id === empresaId);
      if (!emp) return "—";
      const rep = repId ? (emp.representantes ?? []).find((r: any) => r.id === repId) : null;
      return rep ? `${emp.nome_fantasia} (via ${rep.nome})` : `${emp.nome_fantasia} (direto)`;
    };
    return blocos
      .filter((b) => (b.interno ? b.colaborador_id : b.empresa_id))
      .map((b) => ({
        servico: (categorias as any[]).find((c) => c.id === b.categoria_terceirizado_id)?.nome ?? "—",
        responsavel: b.interno
          ? (colaboradores.find((c) => c.id === b.colaborador_id)?.nome ?? "—")
          : empresaLabel(b.empresa_id, b.representante_id),
        interno: b.interno,
        quantidade: b.detalhado ? somaGrade(b.grade_detalhe, "enviada") : Number(b.quantidade_enviada ?? 0),
        detalhado: b.detalhado,
        // Grade ENVIADA p/ o print (a OS acompanha as peças ENVIADAS). Só variantes com envio > 0.
        grade: b.detalhado && gradeTpl
          ? {
              tamanhos: gradeTpl.tamanhos.map((t) => tamLabel(t)),
              linhas: gradeTpl.variantes
                .map((v) => {
                  const valores = gradeTpl.tamanhos.map((t) => Number(b.grade_detalhe[v.id]?.[t]?.enviada) || 0);
                  return { label: v.label, valores, total: valores.reduce((s, n) => s + n, 0) };
                })
                .filter((l) => l.total > 0),
            }
          : null,
        dataEnviado: b.data_enviado,
        dataPrevista: b.data_prevista,
        dataEntregue: b.data_entregue,
        observacao: b.observacao ?? "",
        aviamentos: (b.aviamentos_enviados ?? []).map(aviLabel).filter(Boolean) as string[],
        tecidos: (b.tecidos_enviados ?? []).map(tecLabel).filter(Boolean) as string[],
      }));
  }, [blocos, categorias, colaboradores, empresasServico, aviamentosModelo, tecidosModelo, gradeTpl]);
  const [hydrated, setHydrated] = useState(false);
  // Trava por segurança quando o serviço está Finalizado: só edita ao clicar
  // "Editar", e o Salvar volta a travar. UM único modo de edição p/ AMBAS as abas
  // (Pré/Pós): clicar Editar em qualquer aba libera as duas, e Salvar (que já
  // persiste os dois lados) re-trava. Navegar entre abas não perde o rascunho
  // (os `blocos` são um só estado compartilhado).
  const [editing, setEditing] = useState(false);

  // "Observação de Partes do Molde": mesmo campo do CAD (cad.observacoes_molde).
  const [observacoesMolde, setObservacoesMolde] = useState("");
  // [camada C1 · I3] o texto que a tela CARREGOU (base): o Salvar manda `_molde_base` + `_molde_tocado` e o servidor só grava a
  // observação se a pessoa mexeu — e recusa (P0409) se outra pessoa (Oficina/outra aba) mudou desde a base.
  const moldeBaseRef = useRef("");
  // "Não há acabamento (pós)": peças sem serviço pós → Status Geral vira Finalizado.
  const [semAcabamento, setSemAcabamento] = useState(false);
  const [moldeHydrated, setMoldeHydrated] = useState(false);
  // [camada C3 fix1 · M1] erro do CAD + molde ainda não (re)hidratado: 1ª carga OU refetch pós-Salvar que falhou (o `onSuccess` zera
  // `moldeHydrated` e o Salvar fica travado até uma carga NOVA com sucesso) -> aviso com "Tentar de novo" em vez de travar mudo.
  // Refetch com erro de uma tela já hidratada (moldeHydrated true) segue mantendo o dado, sem aviso.
  const cadErro = cadErrored && !moldeHydrated;
  // Fix hidratação — revisão final (C2): + `!cadOk || cadFetching` — espera o `cad` assentar COM
  // SUCESSO (não só `!== undefined`, que também é true depois de um erro engolido). Mesma classe
  // do achado I1 já corrigido no CQ Pré/Direcionamento nas rodadas anteriores; a Oficina não tinha
  // esse problema porque lá o molde hidrata no mesmo gate do `existing`, chaveado por `cad.id`.
  useEffect(() => {
    if (moldeHydrated) return;
    if (cad === undefined || !cadOk || cadFetching) return; // espera o cad carregar COM SUCESSO
    setObservacoesMolde((cad as any)?.observacoes_molde ?? "");
    moldeBaseRef.current = (cad as any)?.observacoes_molde ?? "";
    setSemAcabamento(Boolean((cad as any)?.sem_acabamento));
    setMoldeHydrated(true);
  }, [cad, moldeHydrated, cadOk, cadFetching]);

  // Guarda de "alterações não salvas": snapshot do estado editável (blocos das duas abas
  // Pré/Pós + observação de molde). `semAcabamento` fica FORA (auto-salva sozinho) e o
  // status/lock seguem o estado salvo (existing), não o snapshot.
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot({ blocos, observacoesMolde });
  // Só conta como sujo depois de hidratar as duas fontes e enquanto tem permissão de editar
  // (readOnly = permissão; inputs ficam disabled, então nada muda). O lock por-aba NÃO zera o
  // dirty — a outra aba pode estar editável e o Salvar persiste as duas.
  const dirty = hydrated && moldeHydrated && !readOnly && changed;
  // Full-page (rota /pcp/servicos/$modeloId): bloqueia navegação de rota. Modal
  // (Sheet no index): o guarda vive no pai, que recebe `dirty` via onDirtyChange — aqui inerte.
  const { confirm } = useUnsavedGuard({ dirty: onClose ? false : dirty, blockNav: !onClose });
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Re-baseliniza o guarda UMA vez por ciclo de hidratação (ao carregar e após salvar). Fica
  // fora do effect de dependências mutáveis: um ref garante que rode só na transição
  // "ainda não baselinizado → tudo hidratado", evitando loop (reset é idempotente de qualquer
  // forma, mas o ref torna o gatilho explícito).
  const baselinedRef = useRef(false);
  useEffect(() => {
    if (baselinedRef.current) return;
    if (!hydrated || !moldeHydrated) return;
    resetBaseline({ blocos, observacoesMolde });
    baselinedRef.current = true;
  }, [hydrated, moldeHydrated, blocos, observacoesMolde, resetBaseline]);

  // Salva a flag "não há pós" direto na cad (auto-save do toggle), otimista.
  const semAcabamentoMut = useMutation({
    mutationFn: async (v: boolean) => {
      if (!cad?.id) return;
      const { error } = await supabase.from("cad").update({ sem_acabamento: v }).eq("id", cad.id);
      if (error) throw error;
    },
    onMutate: (v: boolean) => {
      const prev = semAcabamento;
      setSemAcabamento(v);
      return { prev };
    },
    onError: (e: any, _v, ctx: any) => {
      if (ctx) setSemAcabamento(ctx.prev);
      toast.error(mensagemErro(e, "Erro ao salvar"));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terc-cad", modeloId] });
      qc.invalidateQueries({ queryKey: ["producao-terc-list"] });
      // "Sem acabamento" muda o gate do Direcionamento e o Status Geral no CQ.
      qc.invalidateQueries({ queryKey: ["producao-cq-list"] });
      qc.invalidateQueries({ queryKey: ["dir-list"] });
    },
  });

  // Mapeamento server-row → Bloco (reusado pela hidratação/merge e pelo retry P0409).
  const blocosFromRows = (rows: any[]): Bloco[] => rows.map(blocoDeLinha);

  // Colab: 1ª carga semeia + baseline; refetch/Realtime faz merge 3-vias (escalares por bloco
  // via mergeLinhas + células por bloco via mergeGrade) em vez de re-seed às cegas. Espera a
  // query ASSENTAR (isFetched && !isFetching): hidratar do cache vazio enquanto o refetch
  // ainda corria era o que zerava o formulário ao salvar.
  // Fix hidratação rodada 1 (achado I1): exige `isSuccess` — `isFetched` sozinho também fica
  // true depois de um ERRO (TanStack v5); sem isso, uma falha de rede semeava com `existing=[]`
  // (0 blocos) e um Salvar subsequente mandaria `_blocos:[]`, que `salvar_terceirizados` grava
  // como DELETE de todos os blocos do CAD (auditoria do report.md/review.md).
  useEffect(() => {
    if (!cad?.id) return;
    if (!existingFetched || existingFetching || !existingOk) return;
    const fresh = blocosFromRows(existing as any[]);
    revByBlocoRef.current = Object.fromEntries((existing as any[]).filter((r) => r.id).map((r) => [r.id, Number(r.rev ?? 0)]));

    if (!baseBlocosRef.current) {
      // 1ª carga: seed normal.
      baseBlocosRef.current = fresh;
      setBlocos(fresh);
      setHydrated(true);
      touchedBlocoIdsRef.current = new Set();
      touchedGradeRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      resetBaseline({ blocos: fresh, observacoesMolde });
      return;
    }
    // Refetch: MERGE. Escalares por bloco (mergeLinhas) + células (mergeGrade) por bloco.
    const ml = mergeLinhas({ base: baseBlocosRef.current, draft: blocos, fresh, touchedIds: touchedBlocoIdsRef.current, removidasIds: touchedBlocoIdsRef.current });
    let out = ml.linhas;
    const gradeConf: Conflito[] = [];
    let gradeAtual = 0;
    out = out.map((b) => {
      if (!b.id) return b;
      const fb = fresh.find((x) => x.id === b.id);
      const bb = baseBlocosRef.current!.find((x) => x.id === b.id);
      if (!fb || !bb) return b;
      const mg = mergeGrade({ base: bb.grade_detalhe ?? {}, meu: b.grade_detalhe ?? {}, fresh: fb.grade_detalhe ?? {}, tocadas: touchedGradeRef.current });
      gradeConf.push(...mg.conflitos);
      gradeAtual += mg.atualizados.length;
      return mg.atualizados.length || mg.conflitos.length ? { ...b, grade_detalhe: mg.valor } : b;
    });
    const semResultado = ml.atualizadas.length === 0 && ml.conflitos.length === 0 && gradeConf.length === 0 && gradeAtual === 0;
    if (semResultado) {
      // Merge SEM resultado: nenhum conflito de LINHA foi recalculado, logo nenhum vale mais (o servidor apagou o bloco, ou a outra pessoa
      // reverteu): descarta-os — "usar o novo" neles ressuscitaria bloco inexistente ou desfaria a reversão alheia.
      const restantes = semConflitosDeLinha(conflitosRef.current);
      if (restantes.length !== conflitosRef.current.length) {
        conflitosRef.current = restantes;
        setConflitos(restantes);
        setUltimoMerge((prev) => (prev ? { ...prev, conflitos: prev.conflitos.filter((c) => !c.path.startsWith("linha:")) } : prev));
      }
      baseBlocosRef.current = fresh;
      return;
    }
    setBlocos(out);
    // Conflitos ainda NÃO resolvidos continuam na lista (um eco de OUTRO bloco não pode destravar o Salvar) e a base dos blocos em
    // conflito NÃO avança — senão o próximo merge daria o conflito por resolvido e o Salvar apagaria a edição alheia.
    const todos = juntarConflitos(conflitosRef.current, [...ml.conflitos, ...gradeConf]);
    conflitosRef.current = todos;
    setConflitos(todos);
    setUltimoMerge({ atualizados: ml.atualizadas.length + gradeAtual, conflitos: todos });
    baseBlocosRef.current = baseSemAvancarEmConflito(baseBlocosRef.current, fresh, todos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, cad?.id, existingFetched, existingFetching, existingOk]);

  // Colab: presença (quem está na tela) + reação a UPDATE/INSERT/DELETE de blocos alheios
  // (canal por cad; filtra por cad_id porque há N blocos por cad, sem id de raiz).
  const { presentes } = useColabRegistro({
    canal: cad?.id ? `colab:pcp-servico:${cad.id}` : null,
    tabela: "producao_terceirizados",
    filtroColuna: "cad_id",
    registroId: cad?.id ?? null,
    onMudancaServidor: () => qc.invalidateQueries({ queryKey: ["producao-terc", cad?.id] }),
    campoFocado,
  });

  // Resolução GENÉRICA de um conflito a partir do banner (round 4): "usar o novo" aplica o
  // valor do servidor no rascunho e tira o campo/célula/id do touched; "manter meu" só descarta
  // o aviso. Cobre TODO conflito (escalar de bloco, linha, célula da grade) — sem isso, um
  // conflito sem UI própria deixaria o Salvar travado (deadlock, lição do piloto).
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitos.find((x) => x.path === path);
    if (!c) return;
    if (escolha === "dele") {
      if (path.startsWith("grade:")) {
        const [, vid, tam, campo] = path.split(":");
        setBlocos((prev) => prev.map((b) => {
          const has = b.grade_detalhe?.[vid]?.[tam] !== undefined || b.grade_detalhe?.[vid] !== undefined;
          if (!b.id || !has) return b;
          const gd = { ...b.grade_detalhe, [vid]: { ...(b.grade_detalhe?.[vid] ?? {}) } };
          gd[vid][tam] = { ...(b.grade_detalhe?.[vid]?.[tam] ?? {} as any), [campo]: Number(c.dele) || 0 };
          return { ...b, grade_detalhe: gd };
        }));
        touchedGradeRef.current.delete(path);
      } else if (path.startsWith("linha:")) {
        const id = path.slice("linha:".length);
        // (a base desse bloco passa a ser o que o servidor tem: ver o bloco comum abaixo)
        setBlocos((prev) => c.dele
          ? (prev.some((b) => b.id === id) ? prev.map((b) => (b.id === id ? (c.dele as Bloco) : b)) : [...prev, c.dele as Bloco]) // ausente = eu o removi: "usar o novo" o traz de volta
          : prev.filter((b) => b.id !== id));
        touchedBlocoIdsRef.current.delete(id);
      } else {
        // conflito de escalar num bloco: aplica dele.[path] no bloco correspondente
        const id = (c.dele as any)?.id ?? (c.meu as any)?.id;
        if (id) { setBlocos((prev) => prev.map((b) => (b.id === id ? { ...b, ...(c.dele as any) } : b))); touchedBlocoIdsRef.current.delete(id); }
      }
    }
    // A base do bloco resolvido passa a ser o que o servidor tem (a base dos blocos em conflito não avançou no merge): não reaparece.
    if (path.startsWith("linha:") && baseBlocosRef.current)
      baseBlocosRef.current = baseComLinhaResolvida(baseBlocosRef.current, path.slice("linha:".length), (c.dele ?? null) as Bloco | null);
    setConflitos((prev) => { const nx = prev.filter((x) => x.path !== path); conflitosRef.current = nx; return nx; });
    setUltimoMerge((prev) => prev ? { ...prev, conflitos: prev.conflitos.filter((x) => x.path !== path) } : prev);
  };

  // Quantos blocos existem por categoria (a mesma categoria pode repetir).
  const countByCat = blocos.reduce<Record<string, number>>((m, b) => {
    m[b.categoria_terceirizado_id] = (m[b.categoria_terceirizado_id] ?? 0) + 1;
    return m;
  }, {});

  // Cada clique ACRESCENTA um novo bloco da categoria (pode mandar pra dois lugares).
  const addCategoria = (catId: string, catNome: string) => {
    setBlocosTracked((bs) => [
      ...bs,
      {
        _key: crypto.randomUUID(),
        categoria_terceirizado_id: catId,
        categoria_nome: catNome,
        interno: false,
        empresa_id: null,
        representante_id: null,
        colaborador_id: null,
        preco_metro_unidade: 0,
        aprovado: false,
        quantidade_enviada: 0,
        quantidade_recebida: 0,
        quantidade_defeito: 0,
        desconto_total: 0,
        multa_total: 0,
        numero_parcelas: 1,
        data_enviado: null,
        data_prevista: null,
        data_entregue: null,
        status: "pendente",
        observacao: "",
        aviamentos_enviados: [],
        tecidos_enviados: [],
        detalhado: false,
        grade_detalhe: {},
        pt_data_saida: null,
        pt_data_entrada: null,
        pt_aprovacao: null,
        nf_saida: [],
        nf_entrada: [],
        peca_foto: false,
        peca_foto_data: null,
      },
    ]);
  };
  const removeBloco = (idx: number) => setBlocosTracked((bs) => bs.filter((_, i) => i !== idx));

  const updateBloco = (idx: number, patch: Partial<Bloco>) => {
    setBlocosTracked((bs) => bs.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  // Notas Fiscais do serviço PL (Etapas PL S4): upload no bucket próprio pcp-servicos,
  // path por tenant/bloco (mesmo idioma do uploadFile de oc-tecido/shared.ts).
  async function uploadNfServico(blocoId: string, file: File): Promise<string> {
    const tenant = await tenantPrefix();
    const path = `${tenant}/${blocoId}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
    const { error } = await supabase.storage.from("pcp-servicos").upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
  }

  // 3 status: PRÉ (até costura), PÓS (pós costura) e GERAL (derivado). Regras do dono:
  // pré fin + pós pendente → geral "pendente"; pré fin + pós fin → "finalizado";
  // pré fin + pós SEM seleção → "pré finalizado".
  const { statusPre, statusPos, statusGeral, dataInicial, dataFinal, slaDias } = useMemo(() => {
    const etapaDe = (id: string) => (categorias as any[]).find((c) => c.id === id)?.etapa ?? "ate_costura";
    const statusDe = (bs: typeof blocos) =>
      bs.length === 0 ? "sem_selecao" : bs.every(blocoFinalizado) ? "finalizado" : "em_andamento";
    const pre = blocos.filter((b) => etapaDe(b.categoria_terceirizado_id) === "ate_costura");
    const pos = blocos.filter((b) => etapaDe(b.categoria_terceirizado_id) === "pos_costura");
    const sPre = statusDe(pre);
    const sPos = statusDe(pos);
    let geral: string;
    if (blocos.length === 0) geral = "sem_selecao";
    else if (sPre !== "finalizado") geral = "em_andamento"; // pré ainda não fechou
    else if (sPos === "finalizado") geral = "finalizado"; // pré + pós fechados
    else if (sPos === "sem_selecao") geral = semAcabamento ? "finalizado" : "pre_finalizado"; // pré fechado, pós não selecionado (ou "não há pós")
    else geral = "pendente"; // pré fechado, pós em andamento
    const enviados = blocos.map((b) => b.data_enviado).filter(Boolean) as string[];
    const entregues = blocos.map((b) => b.data_entregue).filter(Boolean) as string[];
    const di = enviados.length ? enviados.slice().sort()[0] : null;
    const df = entregues.length ? entregues.slice().sort().slice(-1)[0] : null;
    let sla = null;
    if (di && df) sla = Math.round((new Date(df).getTime() - new Date(di).getTime()) / 86400000);
    return { statusPre: sPre, statusPos: sPos, statusGeral: geral, dataInicial: di, dataFinal: df, slaDias: sla };
  }, [blocos, categorias, semAcabamento]);

  // Custo de serviço por peça e custo real (= materiais do CAD + serviço).
  const servicoTotal = useMemo(
    () => blocos.reduce((s, b) => s + (b.interno ? 0 : (Number(b.preco_metro_unidade) || 0) * (Number(b.quantidade_enviada) || 0) - (Number(b.desconto_total) || 0) + (Number(b.multa_total) || 0)), 0),
    [blocos],
  );
  const servicoPorPeca = gradeTotalGeral > 0 ? servicoTotal / gradeTotalGeral : 0;
  // + custos adicionais do modelo (seguem para frente desde o Desenvolvimento — src/lib/custo.ts).
  const custosAdicionaisPeca = somaCustosAdicionais((modelo as any)?.custos_adicionais);
  const custoRealPeca = (Number(materiaisPorPeca) || 0) + servicoPorPeca + custosAdicionaisPeca;

  // Resumo da MO PLANEJADA aprovada por serviço (Task 6, RPC `modelo_mo_resumo` da Task 4).
  // Distinto do "Custo real (c/ serviço)/peça" acima (blocos EXECUTADOS na produção): este lê o
  // PLANEJADO/aprovado no Planejamento. Mascara total/total_aprovado p/ quem não vê custos — mas
  // o card já é gated por `podeVerPrecos` (∈ `_pode_ver_custos`), então na prática não chega mascarado.
  const { data: moResumo } = useQuery({
    queryKey: ["pcp-mo-resumo", modeloId],
    // [urg R4b] sem `podeVerPrecos`: o aviso "M.O. não aprovada" também vale para quem não vê preço; o wrapper já devolve `{}` a quem
    // não vê custo nem aprova (nada vaza). Os cards de MO seguem gated por `podeVerPrecos` na tela.
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data as any)?.[modeloId] ?? null) as
        { estado: EstadoMO; total: number | null; total_aprovado: number | null; linhas: (MoLinha & { valor: number | null })[] } | null;
    },
  });
  // `total_aprovado` null = mascarado (sem permissão de custo) — não vira "R$ 0,00" enganoso.
  const moTotalAprovado = moResumo?.total_aprovado != null ? Number(moResumo.total_aprovado) : null;
  const moEstado = moResumo?.estado ?? null;
  const moLinhas = moResumo?.linhas ?? [];

  const cqStatusAntesRef = useRef<string | null>(null);
  const lerStatusCq = async (cadId: string): Promise<string | null> => {
    const { data, error } = await supabase.from("controle_qualidade").select("status").eq("cad_id", cadId).maybeSingle();
    return error ? null : ((data as { status?: string | null } | null)?.status ?? "pendente");
  };

  // [camada C2 · P-262 A] Remover TODOS os serviços e Salvar apaga tudo no servidor: antes pergunta "Apagar todos os N serviços?" e
  // só ao confirmar manda a marca explícita de "apagar tudo" (a trava da C1 recusa o Salvar vazio sem ela). `apagarTudoRef` = a
  // pessoa JÁ confirmou (vale também para o retry automático do P0409; limpa ao terminar).
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao();
  const apagarTudoRef = useRef(false);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado para este modelo. Abra o CAD primeiro.");
      // [lost update, P0409] lê os blocos do REF ao vivo (não da closure do render do clique): o retry automático do P0409 roda o merge e
      // grava o resultado em `blocosLiveRef` ANTES de salvar de novo — a closure ainda teria o rascunho pré-merge e sobrescreveria,
      // em silêncio, o que a outra pessoa mudou (mesma receita da OC Tecido, S6 B1).
      const blocos = blocosLiveRef.current;
      // R13: a RPC devolve void — lê o status do CQ ANTES p/ saber, depois, se o save o rebaixou (grade real zerada).
      cqStatusAntesRef.current = await lerStatusCq(cad.id);
      // RPC transacional com diff-por-id: preserva ids, atualiza/insere/deleta numa
      // transação (a lógica de `interno` fica aqui; o resto é genérico no banco).
      const _blocos = blocos.map(blocoParaPayload);
      // Colab: barra o save enquanto há conflito pendente (o banner no topo lista cada um).
      if (conflitosRef.current.length > 0)
        throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
      // _rev_base por bloco existente (id→rev semeado da query). null=bypass; a RPC dá P0409
      // se algum bloco avançou desde a última carga.
      // [camada C1 · I2] + o rev de TODO bloco da base (inclusive os que a pessoa removeu): o servidor recusa (P0409) apagar bloco
      // que outra pessoa editou ou criou depois da carga. [I3] + a base/marca da Observação de Partes do Molde.
      const _rev_base: Record<string, number | boolean | string> = {
        ...revByBlocoRef.current,
        ...Object.fromEntries(
          blocos.filter((b) => b.id).map((b) => [b.id as string, revByBlocoRef.current[b.id as string] ?? 0]),
        ),
        _molde_tocado: observacoesMolde !== moldeBaseRef.current,
        _molde_base: moldeBaseRef.current,
      };
      // [camada C2 · P-262 A] payload vazio + o servidor TEM serviços (as linhas que seriam apagadas) => exige a confirmação.
      const nServidorApagar = (qc.getQueryData<unknown[]>(["producao-terc", cad.id]) ?? (existing as unknown[])).length;
      if (exigirConfirmacaoApagarTudo({ nPayload: _blocos.length, nServidor: nServidorApagar, confirmado: apagarTudoRef.current }))
        // [camada C1 · M1] a marca leva N = o MESMO número que o diálogo mostrou; o servidor recusa (P0409) se tiver outro número
        _rev_base[MARCA_APAGAR_TUDO_SERVICOS] = nServidorApagar;
      const { error } = await supabase.rpc("salvar_terceirizados" as any, {
        _cad_id: cad.id,
        _blocos,
        _observacoes_molde: observacoesMolde || null,
        _rev_base,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      apagarTudoRef.current = false;
      const antes = cqStatusAntesRef.current;
      cqStatusAntesRef.current = null;
      // R13: só com o CQ confirmado antes vale reler o status depois (o toast espera essa leitura, DEPOIS do reset do colab
      // abaixo — o `await` não pode adiar `baseBlocosRef=null`, senão o eco Realtime do próprio save cai no merge).
      if (antes !== "confirmado") toast.success("Salvo com sucesso");
      markClean(); // limpa o indicador de "alterações não salvas" já no sucesso
      setEditing(false); // salvar re-trava ambas as abas que já estão finalizadas
      // Colab: limpa o touched/conflitos. Diferente do piloto (OC Tecido FECHA no save), esta
      // tela FICA ABERTA e re-trava — então o pós-save NÃO pode ser um "merge": o rascunho
      // ainda tem o bloco novo SEM id enquanto o refetch traz o mesmo bloco COM id (duplicaria)
      // + acenderia "alguém salvou" pro meu próprio save. Zerar `baseBlocosRef` faz o refetch
      // abaixo cair no caminho de SEED (re-adota a verdade do servidor, como o PCP sempre fez),
      // sem tocar o merge da via realtime (UPDATE alheio enquanto edito segue com base != null).
      baseBlocosRef.current = null;
      touchedBlocoIdsRef.current = new Set();
      touchedGradeRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      setUltimoMerge(null);
      if (antes === "confirmado" && cad?.id) {
        const cadId = cad.id;
        void lerStatusCq(cadId).then((depois) => {
          const msg = mensagemToastPosSavePcp(antes, depois);
          if (msg.rebaixou) {
            toast.warning(msg.texto);
            // O servidor rebaixou em cascata CQ/Pós/Lançado/Direcionamento: as telas abaixo ficam velhas se não invalidar.
            for (const queryKey of [["cq", cadId], ["cqpos-cq", cadId], ["producao-cq-list"], ["dir-list"], ["lancamentos-cards"], ["plan-cq"]])
              qc.invalidateQueries({ queryKey });
          } else toast.success(msg.texto);
        }).catch(() => toast.success("Salvo com sucesso"));
      }
      // Busca os dados frescos ANTES de liberar o guard de hidratação, senão a
      // re-hidratação rodava com o cache antigo (vazio) e o formulário "sumia".
      await qc.invalidateQueries({ queryKey: ["producao-terc", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["terc-cad", modeloId] });
      await qc.invalidateQueries({ queryKey: ["producao-terc-list"] });
      // salvar mexe em preço/desconto/multa/datas/parcelas → o Financeiro (Serviços/
      // calendário) e a Home consomem servicos_financeiro; mantê-los em sincronia.
      qc.invalidateQueries({ queryKey: ["servicos-financeiro"] });
      await refetch();
      setMoldeHydrated(false);
      baselinedRef.current = false; // re-baseliniza o guarda na próxima hidratação
    },
    onError: async (e: any) => {
      // [camada C2 · P-262 A] Salvar iria esvaziar a lista: abre o "Apagar todos os N serviços?". Cancelar não grava nada
      // (as linhas continuam removidas no rascunho, a pessoa pode voltar atrás); Confirmar salva de novo COM a marca.
      if (ehApagarTudoPendente(e)) {
        pedirConfirmacao({
          ...textoApagarTodosServicos({ n: e.n, nome: modelo?.nome }),
          onConfirmar: () => { apagarTudoRef.current = true; saveMut.mutate(); },
        });
        return;
      }
      // Qualquer saída que NÃO seja o retry automático do P0409 encerra a confirmação (a próxima tentativa pergunta de novo).
      if (!(e?.code === "P0409" && !retryRef.current)) apagarTudoRef.current = false;
      // Colab: conflito de versão (outra pessoa salvou entre a carga e agora). Busca o
      // estado novo e roda o merge AQUI MESMO (síncrono, lendo o cache direto + os refs-
      // espelho — NUNCA via useEffect, que rodaria com refs velhos e reenviaria o mesmo
      // _rev_base rejeitado). Sem conflito de verdade → tenta salvar de novo UMA vez.
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true;
        savingRef.current = true;
        await qc.refetchQueries({ queryKey: ["producao-terc", cad?.id] });
        const rows = qc.getQueryData<any[]>(["producao-terc", cad?.id]) ?? [];
        const fresh = blocosFromRows(rows);
        revByBlocoRef.current = Object.fromEntries(rows.filter((r) => r.id).map((r) => [r.id, Number(r.rev ?? 0)]));
        const base = baseBlocosRef.current ?? fresh;
        const live = blocosLiveRef.current;
        const ml = mergeLinhas({ base, draft: live, fresh, touchedIds: touchedBlocoIdsRef.current, removidasIds: touchedBlocoIdsRef.current });
        const gradeConf: Conflito[] = [];
        // Colab (item 2, fast-follow): soma as células de grade ADOTADAS (mg.atualizados) junto
        // com ml.atualizadas — espelha o merge effect (linha 629, `gradeAtual`). Sem isso o banner
        // "N campos atualizados" no retry P0409 subcontava (só via linhas, nunca via célula).
        let gradeAtual = 0;
        const out = ml.linhas.map((b) => {
          if (!b.id) return b;
          const fb = fresh.find((x) => x.id === b.id); const bb = base.find((x) => x.id === b.id);
          if (!fb || !bb) return b;
          const mg = mergeGrade({ base: bb.grade_detalhe ?? {}, meu: b.grade_detalhe ?? {}, fresh: fb.grade_detalhe ?? {}, tocadas: touchedGradeRef.current });
          gradeConf.push(...mg.conflitos);
          gradeAtual += mg.atualizados.length;
          return mg.atualizados.length || mg.conflitos.length ? { ...b, grade_detalhe: mg.valor } : b;
        });
        blocosLiveRef.current = out; // o retry abaixo roda ANTES do re-render: o mutationFn lê o estado MESCLADO daqui
        setBlocos(out);
        const todos = juntarConflitos(conflitosRef.current, [...ml.conflitos, ...gradeConf]);
        conflitosRef.current = todos;
        setConflitos(todos);
        setUltimoMerge({ atualizados: ml.atualizadas.length + gradeAtual, conflitos: todos });
        baseBlocosRef.current = baseSemAvancarEmConflito(base, fresh, todos);
        if (todos.length === 0) {
          saveMut.mutate(undefined, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
          return;
        }
        apagarTudoRef.current = false;
        savingRef.current = false; retryRef.current = false;
        toast.error(mensagemErro(e, "Erro ao salvar"));
        return;
      }
      toast.error(mensagemErro(e, "Erro ao salvar"));
    },
  });

  // "Voltar uma etapa" — reverte o corte/baixa e volta o modelo para a Explosão.
  const [voltarOpen, setVoltarOpen] = useState(false);
  // [modularidade F2, T1 review M2 + F2 m2] `reverter_corte_tecido` exige Criação (legado, 1º) E Entrada e Saída no servidor: sem
  // elas o botão some (não vira erro).
  const podeReverterCorte = useRequerModulo("criacao", "entrada_saida").ok;
  const reverterImpacto = useReverterImpacto(cad?.id, voltarOpen);
  const voltarMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado");
      const { error } = await supabase.rpc("reverter_corte_tecido" as any, { _cad_id: cad.id });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Modelo voltou para a Explosão");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["producao-terc-list"] }),
        qc.invalidateQueries({ queryKey: ["producao-cq-list"] }),
        qc.invalidateQueries({ queryKey: ["producao-explosao-list"] }),
        qc.invalidateQueries({ queryKey: ["dir-list"] }),
        qc.invalidateQueries({ queryKey: ["estoque-tecidos"] }),
        qc.invalidateQueries({ queryKey: ["dev-cad-row"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-estoque"] }),
        qc.invalidateQueries({ queryKey: ["sidebar-badges"] }),
        qc.invalidateQueries({ queryKey: ["etapas-afetadas", modeloId] }),
      ]);
      (onForceClose ?? onClose)?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao voltar etapa")),
  });


  // Trava POR ABA: cada etapa (pré/pós) tem seu "finalizado" + lápis. Finalizar o pré
  // não trava o pós (que ainda nem aconteceu), e vice-versa.
  const blocosDaAba = blocos.filter((b) => catEtapa(b.categoria_terceirizado_id) === tabEtapa);
  // Etapas PL (Fase 1, fix-round 1): blocos PL reprovados na Peça Teste, da aba corrente
  // (espelha o filtro da lista de blocos abaixo) — SAEM da lista principal (renderBlocoCard)
  // e vivem só no colapsável "PLs reprovadas na peça teste" (ReprovadasPl), onde o MESMO card
  // editável abre dentro de cada item colapsado. `idx` é o índice em `blocos` (não em
  // `blocosDaAba`) — updateBloco/removeBloco endereçam por ele.
  const reprovadosPl = blocos
    .map((b, idx) => ({ b, idx }))
    .filter(({ b }) => {
      if (catEtapa(b.categoria_terceirizado_id) !== tabEtapa) return false;
      const catNome = (categorias as any[]).find((c) => c.id === b.categoria_terceirizado_id)?.nome ?? "";
      return !b.interno && isServicoPL(catNome) && b.pt_aprovacao === "reprovado";
    })
    .map(({ b, idx }) => ({
      _key: b._key,
      idx,
      empresa: (empresasServico as any[]).find((e) => e.id === b.empresa_id)?.nome_fantasia ?? "—",
      pt_data_saida: b.pt_data_saida,
    }));
  const reprovadosPlIds = new Set(reprovadosPl.map((r) => r._key));
  // Botões "Categorias do Serviço" (só p/ ADICIONAR bloco novo): categoria inativa some,
  // exceto se já existir um bloco dela no modelo (aí some esmaecida — permite editar o
  // existente, mas não convida a criar outro).
  const catsDaAba = (categorias as any[]).filter(
    (cat) =>
      (cat.etapa ?? "ate_costura") === tabEtapa &&
      (cat.ativo !== false || blocos.some((b) => b.categoria_terceirizado_id === cat.id)),
  );
  // A trava reflete o estado SALVO (existing), NÃO o que está sendo digitado — senão travava no
  // meio da digitação (ex.: ao começar a digitar a qtd recebida). Só trava após Salvar. Marcar
  // "não há pós" também trava (o checkbox auto-salva).
  const salvosDaAba = ((existing as any[]) ?? []).filter((r) => catEtapa(r.categoria_terceirizado_id) === tabEtapa);
  const abaFinalizada =
    (tabEtapa === "pos_costura" && semAcabamento && salvosDaAba.length === 0) ||
    (salvosDaAba.length > 0 && salvosDaAba.every(blocoFinalizado));
  const locked = abaFinalizada && !editing;

  // Regra 2 — botões na barra STICKY do rodapé (todos os tamanhos): Voltar à ESQUERDA,
  // Salvar/Editar à DIREITA (ml-auto). No modo Sheet o Voltar dispara `onClose` (o pai
  // guarda o descarte); na página inteira navega pela rota.
  const backButton = onClose ? (
    <Button type="button" variant="outline" onClick={onClose} aria-label="Voltar">
      <ArrowLeft className="h-4 w-4 md:mr-1" /><span className="max-md:sr-only">Voltar</span>
    </Button>
  ) : (
    <Button asChild variant="outline" aria-label="Voltar">
      <Link to="/pcp/servicos"><ArrowLeft className="h-4 w-4 md:mr-1" /><span className="max-md:sr-only">Voltar</span></Link>
    </Button>
  );
  // "Voltar uma etapa" (secundário) vive na barra de ações do rodapé, logo à ESQUERDA
  // do Salvar (que fica na extrema direita com ml-auto). Empurrado p/ a direita por ml-auto.
  const voltarEtapaButton = cad?.id && podeReverterCorte ? (
    <Button className="ml-auto" variant="outline" size="icon" onClick={() => setVoltarOpen(true)} disabled={voltarMut.isPending || readOnly} title="Voltar uma etapa (volta pra Explosão)" aria-label="Voltar uma etapa">
      <Undo2 className="h-4 w-4" />
    </Button>
  ) : null;
  // Salvar/Editar na extrema direita. Se "voltar uma etapa" existe, ele já carrega o ml-auto
  // (empurra ambos p/ a direita); senão o próprio Salvar/Editar carrega o ml-auto.
  const actionButtons = locked ? (
    <Button className={voltarEtapaButton ? "" : "ml-auto"} variant="outline" size="icon" onClick={() => setEditing(true)} disabled={readOnly} aria-label="Editar">
      <Pencil className="h-4 w-4" />
    </Button>
  ) : (
    // Fix hidratação (P-57 A, metade 1): `salvar_terceirizados` audita como ESTADO COMPLETO em
    // `producao_terceirizados` — `DELETE FROM producao_terceirizados WHERE cad_id=_cad_id AND
    // NOT (id=ANY(v_ids))` (não é diff incremental nem upsert-só-por-bloco). Um payload
    // `_blocos: []`: se ALGUM bloco removido (ausente do payload) tem parcela paga, o RAISE
    // ABORTA A OPERAÇÃO INTEIRA (nada é gravado); senão, o DELETE apaga TODOS os blocos do CAD —
    // não é um apagamento parcial nos dois casos. O `grade_detalhe` destrinchado é gravado como
    // objeto OPACO por bloco — travar o Salvar até `hydrated && moldeHydrated` é barato e fecha a
    // classe (ver `.superpowers/fix-hidratacao/review.md`, auditoria das RPCs).
    <Button className={voltarEtapaButton ? "" : "ml-auto"} onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly || !hydrated || !moldeHydrated || cadErro} aria-label="Salvar">
      <Save className="h-4 w-4 md:mr-2" /><span className="max-md:sr-only">Salvar</span>
    </Button>
  );

  // Corpo COMPLETO do card de edição de UM bloco — extraído (Etapas PL Fase 1, fix-round 1)
  // p/ ser reusado tanto na lista principal quanto, colapsado por default, dentro de cada item
  // do colapsável "PLs reprovadas na peça teste" (ReprovadasPl): o usuário edita ali dentro a
  // Aprovação (de volta pra pendente/aprovado) e/ou lança uma nova Data de Saída, e ao deixar
  // de casar `pt_aprovacao==='reprovado'` o bloco some do colapsável e volta pra lista principal
  // no próximo render — sem ação extra. `idx` é sempre o índice em `blocos` (não em
  // `blocosDaAba`/`reprovadosPl`), pois é o que `updateBloco`/`removeBloco` esperam.
  function renderBlocoCard(b: Bloco, idx: number) {
    const catNome = (categorias as any[]).find((c) => c.id === b.categoria_terceirizado_id)?.nome ?? "—";
    // [urg R4b / fix round 1 L3] o aviso só vale se o resumo da M.O. trouxe a linha do bloco (resumo vazio = sem acesso ou ainda
    // carregando: nada a afirmar, então nada é mostrado).
    const linhaMoDoBloco = moLinhas.find((l) => l.id === b.mo_linha_id);
    const empresaSel = (empresasServico as any[]).find((e) => e.id === b.empresa_id);
    // [urg R4b] opções = empresas da categoria ∪ a já escolhida (bloco nascido da M.O. pode ter fornecedor sem vínculo com a categoria).
    const empresasCatBase = empresasDaCategoria(b.categoria_terceirizado_id);
    const empresasCat = empresaSel && !empresasCatBase.some((e: any) => e.id === b.empresa_id) ? [...empresasCatBase, empresaSel] : empresasCatBase;
    const repsDaEmpresa = (empresaSel?.representantes ?? []) as { id: string; nome: string | null }[];
    const colabsCat = colaboradoresDaCategoria(b.categoria_terceirizado_id);
    // SLA do serviço: dias entre enviado e entregue (calculado das datas).
    const slaBloco =
      b.data_enviado && b.data_entregue
        ? Math.round((new Date(b.data_entregue).getTime() - new Date(b.data_enviado).getTime()) / 86400000)
        : null;
    // Nº do bloco entre os da mesma categoria (ex.: "Estamparia 2"), só quando repete.
    const mesmaCatAteAqui = blocos.slice(0, idx + 1).filter((x) => x.categoria_terceirizado_id === b.categoria_terceirizado_id).length;
    const totalMesmaCat = countByCat[b.categoria_terceirizado_id] ?? 1;
    return (
      <Card key={b._key} className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-lg">
            {catNome}
            {totalMesmaCat > 1 && <span className="text-muted-foreground font-normal"> #{mesmaCatAteAqui}</span>}
          </h3>
          <div className="flex items-center gap-2">
            {/* Toggle Interno / PL (Interno esconde o responsável) */}
            <div className="flex rounded-md border overflow-hidden text-xs font-medium">
              <button
                type="button"
                onClick={() => updateBloco(idx, { interno: true, empresa_id: null, representante_id: null })}
                className={cn(
                  "px-2.5 py-1 max-sm:py-2 transition-colors",
                  b.interno ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                Interno
              </button>
              <button
                type="button"
                onClick={() => updateBloco(idx, { interno: false })}
                className={cn(
                  "px-2.5 py-1 max-sm:py-2 transition-colors border-l",
                  !b.interno ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                PL
              </button>
            </div>
            <Badge variant="outline" className="text-xs whitespace-nowrap">
              SLA: {slaBloco != null ? `${slaBloco}d` : "—"}
            </Badge>
            {(() => {
              // Badge do bloco pela MESMA regra do lock/status (blocoFinalizado), não pelo
              // b.status cru do trigger (que vira 'finalizado' só com data_entregue).
              const bSt = blocoFinalizado(b) ? "finalizado" : b.data_enviado ? "em_andamento" : "pendente";
              return <StatusBadge tone={STATUS_TONE[bSt] ?? "neutral"}>{STATUS_LABELS[bSt] ?? bSt}</StatusBadge>;
            })()}
            {/* [urg R4b] bloco nascido da M.O. (Enviar à Explosão), externo e ainda sem preço: o preço entra sozinho quando a linha de M.O.
                for aprovada no Planejamento. Some quando a linha está aprovada ou quando já há preço (digitado ou vindo da aprovação). */}
            {b.mo_linha_id && !b.interno && !(Number(b.preco_metro_unidade) > 0)
              && linhaMoDoBloco && linhaMoDoBloco.aprovado !== true && (
              <span className="inline-flex items-center gap-1">
                <StatusBadge tone="warning">M.O. não aprovada</StatusBadge>
                <InfoHover ariaLabel="Por que o preço está vazio">
                  O preço entra sozinho quando a mão de obra deste serviço for aprovada no Planejamento. Se digitar um preço aqui, ele não é trocado.
                </InfoHover>
              </span>
            )}
            <Button type="button" size="icon" variant="ghost" onClick={() => removeBloco(idx)} aria-label="Remover bloco">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Toggle: destrinchar as quantidades por tamanho × variante. Ligar pré-preenche a
              Enviada com a grade PLANEJADA do modelo (uma vez). Ligado, os 3 totais viram Σ. */}
          <label className="col-span-full flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={b.detalhado}
              onChange={(e) => {
                const on = e.target.checked;
                if (on && gradeTpl && somaGrade(b.grade_detalhe, "enviada") === 0 && Object.keys(b.grade_detalhe ?? {}).length === 0) {
                  const g: GradeDetalhe = {};
                  for (const v of gradeTpl.variantes) { g[v.id] = {}; for (const t of gradeTpl.tamanhos) g[v.id][t] = { enviada: Number(gradeTpl.planejado[v.id]?.[t]) || 0, cortada: 0, recebida: 0, defeito: 0 }; }
                  updateBloco(idx, { detalhado: true, grade_detalhe: g });
                } else updateBloco(idx, { detalhado: on });
              }}
            />
            <span>Quantidade por tamanho e variante (destrinchar a grade)</span>
          </label>
          {b.interno ? (
            <div>
              <Label className="text-xs">Responsável</Label>
              <Select
                value={b.colaborador_id ?? ""}
                onValueChange={(v) => updateBloco(idx, { colaborador_id: v || null })}
              >
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {colabsCat.length === 0 && (
                    <div className="p-2 text-xs text-muted-foreground">
                      Nenhum colaborador desta categoria. Em Cadastro &gt; Colaboradores, crie um
                      tipo ligado a "{catNome}" e cadastre os nomes.
                    </div>
                  )}
                  {colabsCat.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs">Empresa</Label>
                <Select
                  value={b.empresa_id ?? ""}
                  onValueChange={(v) =>
                    // Trocar a empresa limpa o representante (reps são daquela empresa).
                    updateBloco(idx, { empresa_id: v || null, representante_id: null })
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {empresasCat.length === 0 && (
                      <div className="p-2 text-xs text-muted-foreground">Nenhuma empresa cadastrada nesta categoria.</div>
                    )}
                    {empresasCat.map((e: any) => (
                      <SelectItem key={e.id} value={e.id}>{e.nome_fantasia}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Representante (opcional)</Label>
                <Select
                  value={b.representante_id ?? "__direto__"}
                  onValueChange={(v) =>
                    updateBloco(idx, { representante_id: v === "__direto__" ? null : v })
                  }
                  disabled={!b.empresa_id}
                >
                  <SelectTrigger><SelectValue placeholder="Direto na empresa" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__direto__">Direto na empresa</SelectItem>
                    {repsDaEmpresa.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.nome ?? "—"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {!b.interno && podeVerPrecos && (
            <div>
              <Label className="text-xs">Preço por metro/unidade</Label>
              <NumberInput
                type="number"
                step="0.01"
                placeholder="0,00"
                value={b.preco_metro_unidade || ""}
                onChange={(e) => updateBloco(idx, { preco_metro_unidade: Number(e.target.value) })}
                data-colab-path={`bloco:${b.id ?? b._key}:preco_metro_unidade`}
              />
            </div>
          )}
          <div>
            <Label className="text-xs">Qtd Enviada{b.detalhado ? " (Σ grade)" : ""}</Label>
            <NumberInput
              type="number"
              placeholder="0,00"
              disabled={b.detalhado}
              value={b.detalhado ? somaGrade(b.grade_detalhe, "enviada") : (b.quantidade_enviada || "")}
              onChange={(e) => updateBloco(idx, { quantidade_enviada: Number(e.target.value) })}
              data-colab-path={`bloco:${b.id ?? b._key}:quantidade_enviada`}
            />
          </div>
          {b.detalhado && (
            <div>
              <Label className="text-xs">Qtd Cortada (Σ grade)</Label>
              <Input readOnly value={somaGrade(b.grade_detalhe, "cortada")} className="bg-muted/40" />
            </div>
          )}
          {b.detalhado && (
            <div>
              <Label className="text-xs">Saldo a receber (Σ)</Label>
              <Input readOnly value={somaGrade(b.grade_detalhe, "cortada") - somaGrade(b.grade_detalhe, "recebida")} className="bg-muted/40" />
            </div>
          )}

          <div>
            <Label className="text-xs">Data Enviado</Label>
            <DateField
              value={b.data_enviado ?? ""}
              onChange={(e) => updateBloco(idx, { data_enviado: e.target.value || null })}
            />
          </div>
          <div>
            <Label className="text-xs">Data Prevista</Label>
            <DateField
              value={b.data_prevista ?? ""}
              onChange={(e) => updateBloco(idx, { data_prevista: e.target.value || null })}
            />
          </div>
          <div>
            <Label className="text-xs">Data Entregue</Label>
            <DateField
              value={b.data_entregue ?? ""}
              onChange={(e) => updateBloco(idx, { data_entregue: e.target.value || null })}
            />
          </div>

          <div>
            <Label className="text-xs">Qtd Recebida{b.detalhado ? " (Σ grade)" : ""}</Label>
            <NumberInput
              type="number"
              placeholder="0,00"
              disabled={b.detalhado}
              value={b.detalhado ? somaGrade(b.grade_detalhe, "recebida") : (b.quantidade_recebida || "")}
              onChange={(e) => updateBloco(idx, { quantidade_recebida: Number(e.target.value) })}
              data-colab-path={`bloco:${b.id ?? b._key}:quantidade_recebida`}
            />
          </div>
          <div>
            <Label className="text-xs">Qtd Defeito{b.detalhado ? " (Σ grade)" : ""}</Label>
            <NumberInput
              type="number"
              placeholder="0,00"
              disabled={b.detalhado}
              value={b.detalhado ? somaGrade(b.grade_detalhe, "defeito") : (b.quantidade_defeito || "")}
              onChange={(e) => updateBloco(idx, { quantidade_defeito: Number(e.target.value) })}
              data-colab-path={`bloco:${b.id ?? b._key}:quantidade_defeito`}
            />
          </div>
          {b.detalhado && (
            <div className="col-span-full rounded-md border bg-muted/20 p-3">
              <div className="mb-2 text-xs text-muted-foreground">Grade por <b>tamanho × variante</b> — a <b>Enviada</b> vem pré-preenchida da grade planejada; ajuste conforme o envio/recebimento.</div>
              {(() => {
                const violacoes = celulasRecebidaAcimaCortada(b.grade_detalhe);
                if (violacoes.length === 0) return null;
                return (
                  <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      Recebida acima da Cortada em {violacoes.length} célula{violacoes.length > 1 ? "s" : ""} — confira.
                    </span>
                  </div>
                );
              })()}
              <GradeEditor tpl={gradeTpl ?? { variantes: [], tamanhos: [] }} grade={b.grade_detalhe} onChange={(g) => updateBloco(idx, { grade_detalhe: g })} />
            </div>
          )}
          {!b.interno && (
            <div>
              <Label className="text-xs">Desconto total</Label>
              <NumberInput
                type="number"
                step="0.01"
                placeholder="0,00"
                value={b.desconto_total || ""}
                onChange={(e) => updateBloco(idx, { desconto_total: Number(e.target.value) })}
                data-colab-path={`bloco:${b.id ?? b._key}:desconto_total`}
              />
            </div>
          )}
          {!b.interno && (
            <div>
              <Label className="text-xs">Multa total</Label>
              <NumberInput
                type="number"
                step="0.01"
                placeholder="0,00"
                value={b.multa_total || ""}
                onChange={(e) => updateBloco(idx, { multa_total: Number(e.target.value) })}
                data-colab-path={`bloco:${b.id ?? b._key}:multa_total`}
              />
            </div>
          )}
          {!b.interno && (
            <div>
              <Label className="text-xs">Prazo de Pagamento</Label>
              <Input
                readOnly
                value={(empresaSel?.prazo_pagamento as string) || "—"}
                className="bg-muted"
              />
              <span className="text-[11px] text-muted-foreground">(do fornecedor)</span>
            </div>
          )}
          {!b.interno && podeVerPrecos && (
            <div>
              <Label className="text-xs">Custo Total</Label>
              <Input
                readOnly
                value={fmtNum((Number(b.preco_metro_unidade) || 0) * (Number(b.quantidade_enviada) || 0) - (Number(b.desconto_total) || 0) + (Number(b.multa_total) || 0))}
                className="bg-muted"
              />
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs">Observação</Label>
          <Textarea
            value={b.observacao}
            onChange={(e) => updateBloco(idx, { observacao: e.target.value })}
            data-colab-path={`bloco:${b.id ?? b._key}:observacao`}
            rows={2}
          />
        </div>

        {!b.interno && isServicoPL(catNome) && isModuleEnabled("etapas_pl") && (
          <EtapasPlPanel
            bloco={{
              pt_data_saida: b.pt_data_saida,
              pt_data_entrada: b.pt_data_entrada,
              pt_aprovacao: b.pt_aprovacao,
              data_enviado: b.data_enviado,
              data_entregue: b.data_entregue,
              qtd_recebida: b.detalhado ? somaGrade(b.grade_detalhe, "recebida") : b.quantidade_recebida,
              grade_detalhe: b.grade_detalhe,
            }}
            etapasCfg={etapasCfg}
            onChange={(campo, valor) => updateBloco(idx, { [campo]: valor } as Partial<Bloco>)}
            readOnly={readOnly}
          />
        )}

        {!b.interno && isServicoPL(catNome) && isModuleEnabled("etapas_pl") && (
          <div className="col-span-full rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
            <div className="text-sm font-medium">Notas Fiscais</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">NF de Saída</div>
                <NfList value={b.nf_saida} onChange={(nfs) => updateBloco(idx, { nf_saida: nfs })} uploadFn={(f) => uploadNfServico(b.id ?? b._key, f)} bucket="pcp-servicos" readOnly={readOnly} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">NF de Entrada</div>
                <NfList value={b.nf_entrada} onChange={(nfs) => updateBloco(idx, { nf_entrada: nfs })} uploadFn={(f) => uploadNfServico(b.id ?? b._key, f)} bucket="pcp-servicos" readOnly={readOnly} />
              </div>
            </div>
          </div>
        )}

        {!b.interno && isServicoPL(catNome) && isModuleEnabled("etapas_pl") && (
          <div className="col-span-full space-y-2">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={b.peca_foto}
                onChange={(e) => updateBloco(idx, e.target.checked ? { peca_foto: true } : { peca_foto: false, peca_foto_data: null })} />
              <span>Peça de foto</span>
            </label>
            {b.peca_foto && (
              <div className="max-w-xs">
                <Label className="text-xs">Data de entrega da peça de foto</Label>
                <DateField value={b.peca_foto_data ?? ""} onChange={(e) => updateBloco(idx, { peca_foto_data: e.target.value || null })} disabled={readOnly} />
              </div>
            )}
          </div>
        )}
      </Card>
    );
  }

  // Modo Sheet (via terceirizados.index): flex column p/ o rodapé de ações grudar embaixo.
  // Modo página inteira: container com pb-24 (a barra de ações é o PageActionBar em portal).
  return (
    <div className={onClose ? "flex h-full flex-col min-h-0" : ""}>
      <div
        ref={colabScopeRef}
        className={`${onClose ? "flex-1 overflow-y-auto w-full " : "container mx-auto "}p-3 sm:p-6 space-y-6 ${onClose ? "" : "pb-24"}`}
        onFocusCapture={(e) => {
          const scope = colabScopeRef.current;
          setCampoFocado(scope ? pathDoElemento(e.target as HTMLElement, scope) : null);
        }}
        onBlurCapture={() => setCampoFocado(null)}
      >
      <ColabPresenceOverlay presentes={presentes} scopeRef={colabScopeRef} />
      <VerificarRevisao modeloId={modeloId} etapa="terceirizados" />
      {/* Cabeçalho: breadcrumb + botões SECUNDÁRIOS de impressão. "Voltar uma etapa" e as
          ações primárias (Voltar / Salvar) ficam no rodapé sticky. */}
      <div className="flex items-center justify-between gap-2">
        <Breadcrumb items={[{ label: "PCP", to: "/pcp/servicos" }, { label: modelo?.ref ?? "…" }]} />
        <div className="flex items-center gap-2">
          <UnsavedIndicator show={dirty} className="shrink-0" />
          <Button variant="outline" className="hidden md:inline-flex" onClick={() => { setPrintTarget("ficha"); printWithImages(); }} disabled={!cad?.id}>
            <FileText className="h-4 w-4 mr-2" /> Ficha Técnica
          </Button>
          <Button variant="outline" className="hidden md:inline-flex" onClick={() => { setPrintTarget("os"); printWithImages(); }} disabled={osItens.length === 0}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir OS
          </Button>
        </div>
      </div>

      {/* Colab: presença + resultado do merge + resolução genérica de conflitos. FORA do
          fieldset (resolver conflito precisa funcionar mesmo com a aba travada). */}
      <ColabBanner
        presentes={presentes}
        ultimoMerge={ultimoMerge}
        conflitos={conflitos}
        onResolver={resolverPorPath}
        rotulo={rotuloConflito}
      />

      {/* Abas Pré/Pós — FORA do fieldset: travar uma aba não pode impedir trocar de aba. */}
      <div className="flex rounded-md border p-0.5 w-fit">
        <Button size="sm" variant={tabEtapa === "ate_costura" ? "secondary" : "ghost"} onClick={() => setTabEtapa("ate_costura")}>
          Pré (até costura)
        </Button>
        <Button size="sm" variant={tabEtapa === "pos_costura" ? "secondary" : "ghost"} onClick={() => setTabEtapa("pos_costura")}>
          Pós (acabamento)
        </Button>
      </div>

      {/* "Não há acabamento": FORA do fieldset, pra continuar clicável mesmo com a aba
          travada (senão, pra desmarcar, precisaria clicar no lápis antes). */}
      {tabEtapa === "pos_costura" && (
        <label className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm w-fit">
          <Checkbox
            className="mt-0.5"
            checked={semAcabamento}
            onCheckedChange={(v) => semAcabamentoMut.mutate(Boolean(v))}
            // Fix hidratação rodada 1 (achado M2 da revisão): + `!hydrated` — antes, com
            // `blocos=[]` (ainda em voo), a guarda `blocosDaAba.length > 0` deixava marcar
            // "sem acabamento" mesmo num modelo que tem serviços pós (o checkbox auto-salva).
            disabled={blocosDaAba.length > 0 || readOnly || !cad?.id || !hydrated}
          />
          <span>Este modelo <b>não tem acabamento</b> (pós).</span>
        </label>
      )}

      {/* Fix hidratação rodada 1 (achado I1): carga com ERRO nunca hidrata (o gate exige
          `existingOk`) — banner no lugar do formulário, com "Tentar de novo".
          Fix hidratação rodada 1 (achado M3): sem erro, mas ainda não hidratado — "Carregando…"
          no lugar do corpo (Status Geral/blocos), como pedia o brief original.
          Fix hidratação rodada 2 (achado N1 da re-revisão — regressão): o corpo renderiza por
          `hydrated` SOZINHO — uma vez hidratado, um erro de REFETCH posterior não esconde o
          formulário nem deixa Salvar habilitado "por engano" (o botão só olha `hydrated`, então
          escondê-lo sem travar o Salvar era pior). */}
      {cadErro && (
        <Card role="alert" className="p-5 space-y-3 border-destructive/50 bg-destructive/5 text-sm">
          <p className="text-destructive font-medium">Não foi possível carregar os dados.</p>
          <Button type="button" variant="outline" size="sm" disabled={cadFetching} onClick={() => { refetchCad(); }}>
            <RotateCcw className="h-4 w-4 mr-2" /> {cadFetching ? "Tentando…" : "Tentar de novo"}
          </Button>
        </Card>
      )}
      {cad === undefined && !cadErro && (
        <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
      )}
      {cad?.id && existingErrored && !hydrated && (
        <Card className="p-5 space-y-3 border-destructive/50 bg-destructive/5 text-sm">
          <p className="text-destructive font-medium">Não foi possível carregar os dados.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
            <RotateCcw className="h-4 w-4 mr-2" /> Tentar de novo
          </Button>
        </Card>
      )}
      {cad?.id && !existingErrored && !hydrated && (
        <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
      )}

      {/* [fix3 N-L2] FORA do fieldset do corpo (que fica desabilitado no aviso do M1): o "Tentar de novo" segue clicável. */}
      {(cad === null || hydrated) && custoAuxErro && (
        <Card role="alert" className="p-4 space-y-2 border-destructive/50 bg-destructive/5 text-sm">
          <p className="text-destructive font-medium">Não foi possível carregar a grade e o custo do CAD.</p>
          <Button type="button" variant="outline" size="sm" disabled={gradeTotalFetching || materiaisFetching} onClick={() => { if (gradeTotalErro) refetchGradeTotal(); if (materiaisErro) refetchMateriais(); }}>
            <RotateCcw className="h-4 w-4 mr-2" /> {gradeTotalFetching || materiaisFetching ? "Tentando…" : "Tentar de novo"}
          </Button>
        </Card>
      )}

      {(cad === null || hydrated) && (
      <fieldset disabled={readOnly || locked || cadErro} className="contents">

      <header className="flex items-start gap-3">
        <Users className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <ModeloResumoFoto
          fontes={[(modelo as any)?.fotos_modelo?.[0], (modelo as any)?.desenho_tecnico_url, (modelo as any)?.croqui_url]}
          nome={modelo?.nome} className="h-14 w-14" zoom
        />
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight">
            {modelo?.ref ?? "…"} — {modelo?.nome ?? ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            {(modelo as any)?.categoria_nome ?? "—"} • {modelo?.colecao ?? "—"}
          </p>
          <ModeloResumoMeta
            subcolecao={(modelo as any)?.subcolecao} lancamento={(modelo as any)?.semana}
            mesNome={(modelo as any)?.mes?.mes} anoNome={(modelo as any)?.ano?.ano}
          />
        </div>
      </header>

      {/* Status geral */}
      <Card className="p-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <div>
          <Label className="text-xs text-muted-foreground">Grade Total Geral</Label>
          <div className="mt-1 text-sm font-semibold">{gradeTotalErro || gradeTotalPendente ? "—" : fmtNum(gradeTotalGeral)}</div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status Pré</Label>
          <div className="mt-1">
            <StatusBadge tone={STATUS_TONE[statusPre] ?? "neutral"}>{STATUS_LABELS[statusPre] ?? statusPre}</StatusBadge>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status Pós</Label>
          <div className="mt-1">
            <StatusBadge tone={STATUS_TONE[statusPos] ?? "neutral"}>{STATUS_LABELS[statusPos] ?? statusPos}</StatusBadge>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status Geral</Label>
          <div className="mt-1">
            <StatusBadge tone={STATUS_TONE[statusGeral] ?? "neutral"}>{STATUS_LABELS[statusGeral] ?? statusGeral}</StatusBadge>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Data Inicial</Label>
          <div className="mt-1 text-sm">{dataInicial ? dataInicial.split("-").reverse().join("/") : "—"}</div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Data Final</Label>
          <div className="mt-1 text-sm">{dataFinal ? dataFinal.split("-").reverse().join("/") : "—"}</div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">SLA (dias)</Label>
          <div className="mt-1 text-sm">{slaDias ?? "—"}</div>
        </div>
        {podeVerPrecos && (
        <div>
          <Label className="text-xs text-muted-foreground">Custo real (c/ serviço) / peça</Label>
          <div
            className="mt-1 text-sm font-bold text-primary"
            title={custoAuxErro || custoPendente ? undefined : `Materiais CAD ${brl(Number(materiaisPorPeca) || 0)} + serviço ${brl(servicoPorPeca)}${custosAdicionaisPeca > 0 ? ` + adicionais ${brl(custosAdicionaisPeca)}` : ""}`}
          >
            {custoAuxErro || custoPendente ? "—" : brl(custoRealPeca)}
          </div>
          {custosAdicionaisPeca > 0 && (
            <div className="text-xs text-muted-foreground">inclui custos adicionais: {brl(custosAdicionaisPeca)}</div>
          )}
        </div>
        )}
        {podeVerPrecos && (
        <div>
          {/* MO Aprovada = MO PLANEJADA aprovada (Σ modelo_servico_mo.valor onde aprovado=true),
              com detalhe por serviço (Task 6). Distinto do "Custo real (c/ serviço)/peça" acima
              (blocos executados na produção). */}
          <Label className="text-xs text-muted-foreground">MO Aprovada (planejada)</Label>
          <div
            className={`mt-1 text-sm font-bold ${moEstado === "aprovada" ? "text-emerald-600" : moEstado === "reprovada" ? "text-destructive" : "text-foreground"}`}
            title={moLinhas.map((l) => `${l.nome}: ${l.valor != null ? brl(Number(l.valor)) : "—"} — ${l.aprovado === true ? "aprovada" : l.aprovado === false ? "reprovada" : "pendente"}`).join("\n") || "Sem serviços de mão de obra"}
          >
            {moTotalAprovado != null ? brl(moTotalAprovado) : "—"}
          </div>
          <div className={`text-xs ${moEstado === "aprovada" ? "text-emerald-600" : moEstado === "reprovada" ? "text-destructive" : moEstado === "sem_servico" ? "text-muted-foreground" : "text-amber-600"}`}>
            {moEstado === "aprovada" ? "✓ aprovada" : moEstado === "reprovada" ? "reprovada" : moEstado === "sem_servico" ? "sem serviços" : "aprovação pendente"}
          </div>
          {moLinhas.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {moLinhas.map((l) => (
                <li key={l.categoria_terceirizado_id ?? "legado"} className="flex justify-between gap-2">
                  <span className="truncate">{l.nome}</span>
                  <span className={`shrink-0 ${l.aprovado === true ? "text-emerald-600" : l.aprovado === false ? "text-destructive" : "text-amber-600"}`}>
                    {l.valor != null ? brl(Number(l.valor)) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
      </Card>

      {/* Categoria buttons (só as da etapa da aba) */}
      <Card className="p-4">
        <Label className="text-sm font-semibold mb-3 block">Categorias do Serviço (clique para adicionar um bloco)</Label>
        <div className="flex flex-wrap gap-2">
          {catsDaAba.map((c) => {
            const count = countByCat[c.id] ?? 0;
            const inativa = c.ativo === false;
            return (
              <Button
                key={c.id}
                type="button"
                variant={count > 0 ? "default" : "outline"}
                size="sm"
                className={inativa ? "opacity-60" : undefined}
                title={inativa ? "Serviço desativado — some das novas seleções" : undefined}
                onClick={() => addCategoria(c.id, c.nome)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {c.nome}
                {count > 0 && <span className="ml-1 opacity-80">({count})</span>}
              </Button>
            );
          })}
          {categoriasLoading && (
            <p className="text-sm text-muted-foreground">Carregando categorias…</p>
          )}
          {categoriasError && (
            <p className="text-sm text-destructive">
              Erro ao carregar categorias: {(categoriasError as any)?.message ?? "desconhecido"}
            </p>
          )}
          {!categoriasLoading && !categoriasError && (categorias as any[]).length === 0 && (
            <p className="text-sm text-muted-foreground">Cadastre categorias em Cadastro &gt; Atributos.</p>
          )}
        </div>
      </Card>

      {/* Blocos (só os da etapa da aba; idx preservado p/ updateBloco). PL reprovado
          na Peça Teste NÃO aparece aqui — vive só no colapsável ReprovadasPl abaixo
          (renderBlocoCard é compartilhada pelos dois lugares, editável nos dois). */}
      {blocos.map((b, idx) => {
        if (catEtapa(b.categoria_terceirizado_id) !== tabEtapa) return null;
        if (reprovadosPlIds.has(b._key)) return null;
        return renderBlocoCard(b, idx);
      })}

      {reprovadosPl.length > 0 && isModuleEnabled("etapas_pl") && (
        <ReprovadasPl blocos={reprovadosPl} renderBloco={(idx) => renderBlocoCard(blocos[idx], idx)} />
      )}

      {blocos.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Adicione uma categoria acima para começar.
        </Card>
      )}

      <Card className="p-5 space-y-2">
        <Label className="text-sm font-semibold">Observação de Partes do Molde</Label>
        <Textarea
          rows={3}
          value={observacoesMolde}
          onChange={(e) => setObservacoesMolde(e.target.value)}
          placeholder="Instruções de corte / partes do molde…"
        />
        <p className="text-xs text-muted-foreground">Mesmo campo do CAD / Ficha de Corte.</p>
      </Card>

      {cad === null && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
          Atenção: este modelo ainda não possui um registro de CAD. Abra a página de CAD desse modelo antes de salvar.
        </Card>
      )}
      </fieldset>
      )}

      {/* Documento de impressão (oculto na tela; aparece só na impressão). Alterna
          entre Ficha Técnica e Ordem de Serviço conforme o botão — o CSS de print
          mostra TODAS as .print-area, então só uma pode estar montada por vez. */}
      {printTarget === "os" ? (
        <OrdemServicoTerceirizados modelo={modelo} itens={osItens} dataStr={new Date().toLocaleDateString("pt-BR")} />
      ) : (
        <FichaTecnica modeloId={modeloId} />
      )}

      {dialogConfirmacao}

      <AlertDialog open={voltarOpen} onOpenChange={setVoltarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voltar este modelo para a Explosão?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div><ReverterImpacto cadId={cad?.id} open={voltarOpen} /></div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voltarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={voltarMut.isPending || reverterImpacto.data?.temPaga}
              onClick={() => voltarMut.mutate()}
            >
              Voltar uma etapa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full-page: guarda o "sair sem salvar" (bloqueia navegação de rota). No modal
          (Sheet no index) o guarda é renderizado pelo pai — aqui não duplica. */}
      {!onClose && (
        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas nos Serviços." />
      )}
      </div>

      {/* Regra 2 — barra de ações sticky no rodapé (todos os tamanhos).
          Sheet: rodapé in-flow do próprio modal. Página inteira: PageActionBar (portal no body). */}
      {onClose ? (
        <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2">
          {backButton}
          {voltarEtapaButton}
          {actionButtons}
        </div>
      ) : (
        <PageActionBar>
          {backButton}
          {voltarEtapaButton}
          {actionButtons}
        </PageActionBar>
      )}
    </div>
  );
}

// Editor da grade por tamanho × variante — 4 tabelas (Enviada / Cortada / Recebida / Defeito) +
// Saldo a receber (derivado, read-only). Chaveado por variante_tecido_id; tamanho no formato
// "38|P" (exibe o rótulo). Total por linha à direita.
const CAMPOS_GRADE: { k: keyof CelulaGrade; label: string }[] = [
  { k: "enviada", label: "Enviada" },
  { k: "cortada", label: "Cortada" },
  { k: "recebida", label: "Recebida" },
  { k: "defeito", label: "Defeito" },
];
function GradeEditor({
  tpl, grade, onChange, disabled,
}: {
  tpl: { variantes: { id: string; label: string }[]; tamanhos: string[] };
  grade: GradeDetalhe;
  onChange: (g: GradeDetalhe) => void;
  disabled?: boolean;
}) {
  const tamLabel = (t: string) => (t.includes("|") ? t.split("|")[1] || t : t);
  const cel = (vid: string, t: string): CelulaGrade => grade[vid]?.[t] ?? CELULA_ZERO;
  const set = (vid: string, t: string, campo: keyof CelulaGrade, val: number) => {
    const g: GradeDetalhe = { ...grade, [vid]: { ...(grade[vid] ?? {}) } };
    g[vid][t] = { ...CELULA_ZERO, ...(g[vid][t] ?? {}), [campo]: val };
    onChange(g);
  };
  if (!tpl.variantes.length || !tpl.tamanhos.length)
    return <p className="text-xs text-muted-foreground">Sem grade planejada para destrinchar — defina a grade (tamanhos/variantes) do modelo primeiro.</p>;
  // Cada variante do template vira {num,label} pro MatrizGradeResponsiva — "num" aqui é
  // POSICIONAL (índice na lista), só pra casar com a assinatura (num,tam)=>ReactNode; a chave
  // real usada em cel()/set() continua sendo o v.id (uuid), mapeado de volta pelo índice.
  const variantesMatriz = tpl.variantes.map((v, i) => ({ num: i, label: v.label }));
  return (
    <div className="space-y-3">
      {CAMPOS_GRADE.map(({ k, label }) => (
        <div key={k}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          <MatrizGradeResponsiva
            tamanhos={tpl.tamanhos}
            variantes={variantesMatriz}
            emptyLabel="Sem variantes."
            total={(i) => tpl.tamanhos.reduce((s, t) => s + (Number(cel(tpl.variantes[i].id, t)[k]) || 0), 0)}
            cellClass={(i, t) => (k === "recebida" && recebidaExcedeCortada(cel(tpl.variantes[i].id, t)) ? "border-destructive" : "")}
            renderCell={(i, t) => {
              const v = tpl.variantes[i];
              // Recebida não deveria superar a Cortada — alerta visual (não bloqueia o save).
              const alerta = k === "recebida" && recebidaExcedeCortada(cel(v.id, t));
              return (
                <input
                  type="number" min={0} disabled={disabled}
                  title={alerta ? "Recebida maior que a Cortada — confira." : undefined}
                  className={`h-8 max-md:h-11 w-full border-0 bg-background px-1 text-center disabled:opacity-60 ${alerta ? "text-destructive font-semibold" : ""}`}
                  value={cel(v.id, t)[k] || ""}
                  data-colab-path={`grade:${v.id}:${t}:${k}`}
                  onChange={(e) => set(v.id, t, k, Number(e.target.value) || 0)}
                />
              );
            }}
          />
        </div>
      ))}
      {/* Saldo a receber = Cortada − Recebida (derivado; negativo = recebido a mais). Read-only. */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo a receber (Cortada − Recebida)</div>
        <MatrizGradeResponsiva
          tamanhos={tpl.tamanhos}
          variantes={variantesMatriz}
          emptyLabel="Sem variantes."
          total={(i) => {
            const soma = tpl.tamanhos.reduce((s, t) => s + saldoCelula(cel(tpl.variantes[i].id, t)), 0);
            return <span className={soma < 0 ? "text-destructive font-semibold" : ""}>{soma}</span>;
          }}
          renderCell={(i, t) => {
            const s = saldoCelula(cel(tpl.variantes[i].id, t));
            return <div className={`px-1 py-1.5 text-center bg-muted/20 ${s < 0 ? "text-destructive font-semibold" : ""}`}>{s}</div>;
          }}
        />
      </div>
    </div>
  );
}
