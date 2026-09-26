import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Compass, Save, CheckCircle2, RotateCcw, Pencil, Printer, AlertTriangle } from "lucide-react";
import { printWithImages } from "@/lib/print";
import { RomaneioDirecionamento } from "@/components/producao/RomaneioDirecionamento";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { varianteLabel } from "@/lib/variante";
import { diffPorTamanho, motivoNaoConfere } from "@/lib/direcionamento-diff";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { NumberInput } from "@/components/shared/NumberInput";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";
import { ModeloResumoMeta } from "@/components/shared/ModeloResumoMeta";
import { useReadOnly } from "@/components/RequirePermission";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { VerificarRevisao } from "@/components/producao/RevisaoErro";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { pathDoElemento } from "@/lib/colab/colab-field-path";
import { mergeGradeDir, pathDirCel, type GradeDir } from "@/lib/colab/merge-grade-dir";
import { type Conflito } from "@/lib/colab/merge";
import { InfoHover } from "@/components/shared/InfoHover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ladoTamanho } from "@/lib/tamanho";
import { tipoDoProduto } from "@/lib/distribuicao-produto";
import { preencherComPlano, tamanhosDoPlano, textoPendencia, totalPlanoVariante, type Pendente, type PlanoModeloResp } from "@/lib/direcionamento-plano";
import { PlanoDoModeloCard } from "@/components/direcionamento/PlanoDoModeloCard";

const TEXTO_GRADE_REAL = "Grade Real = o que voltou da recepção dos serviços, já sem os defeitos do CQ.";

export const Route = createFileRoute("/_authenticated/expedicao/direcionamento/$modeloId")({
  component: DirDetailPage,
});

type Loja = { id: string; nome: string; ativo: boolean; is_default: boolean; ordem: number | null };
type VarState = {
  variante_numero: number;
  real: Record<string, number>;
  // loja_id -> { tamanho: qtd } — uma linha digitável por loja
  linhas: Record<string, Record<string, number>>;
};

// Extrai a parte MERGEÁVEL do state (só as `linhas` editáveis, por variante→loja→tam) no shape que
// o `mergeGradeDir` entende. A grade `real` (read-only) fica de fora do merge de propósito.
function stateToGradeDir(state: Record<number, VarState>): GradeDir {
  const out: GradeDir = {};
  for (const v of Object.values(state)) {
    out[v.variante_numero] = {};
    for (const [loja, grades] of Object.entries(v.linhas)) {
      out[v.variante_numero][loja] = { ...grades };
    }
  }
  return out;
}

function DirDetailPage() {
  const { modeloId } = Route.useParams();
  return <DirecionamentoDetail modeloId={modeloId} />;
}

export function DirecionamentoDetail({ modeloId, onClose, onDirtyChange }: { modeloId: string; onClose?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const tenantId = useActiveTenantId();
  // Status do Direcionamento: 'pendente' (default) -> 'separado' ao Confirmar.
  // Confirmado trava as edições; "Editar" reabre e Salvar volta a travar.
  const [status, setStatus] = useState("pendente");
  const [editing, setEditing] = useState(false);

  // Presença por campo + MERGE de conflito (Fase 3). O ring/presença e o `campoFocado` seguem;
  // o merge 3-vias entra via useColabRegistro (montado mais abaixo, depois de `cad`/`state`).
  const [campoFocadoColab, setCampoFocadoColab] = useState<string | null>(null);
  const colabScopeRef = useRef<HTMLDivElement>(null);
  // Estado do merge (espelho do CQ): base = último visto do servidor · touched = células que EU
  // editei (path dir:${variante}:${loja}:${tam}) · rev = rev da âncora · reseeding = gate p/ o
  // pós-save/reconcile re-baselinar sem disparar o merge. Conflitos pendentes barram Salvar/Confirmar.
  const baseGradeRef = useRef<GradeDir>({});
  const touchedRef = useRef<Set<string>>(new Set());
  const revRef = useRef<number>(0);
  const reseedingRef = useRef(false);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const conflitosRef = useRef<Conflito[]>([]);
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);

  const { data: modelo } = useQuery({
    queryKey: ["dir-modelo", modeloId],
    queryFn: async () => (await (supabase.from("modelos") as any).select("id, ref, nome, colecao, subcolecao, semana, origem, tamanho_tipo, fotos_modelo, desenho_tecnico_url, croqui_url, mes:mes_id(mes), ano:ano_id(ano)").eq("id", modeloId).single()).data,
  });

  const { data: cad } = useQuery({
    queryKey: ["dir-cad", modeloId],
    queryFn: async () => (await (supabase.from("cad") as any).select("id, direcionamento_status, direcionamento_confirmado_at").eq("modelo_id", modeloId).maybeSingle()).data as { id: string; direcionamento_status: string | null; direcionamento_confirmado_at: string | null } | null,
  });
  useEffect(() => {
    if (cad) setStatus((cad as any).direcionamento_status ?? "pendente");
  }, [cad]);

  // Distribuição por produto (spec R21/R38): plano SALVO do Plan. Tecido para ESTE modelo + "X modelos direcionados" da
  // subcoleção. Substitui a tira global antiga (RPC de resumo da subcoleção, apagada na remoção). O plano é
  // REFERÊNCIA — nenhum gate lê isto (invariante #10).
  const { data: planoResp, isFetched: planoFetched, isFetching: planoFetching } = useQuery({
    queryKey: ["dir-plano-modelo", modeloId],
    enabled: !!modeloId,
    retry: 1, // M1 (T7 fix2): não os 3 retries padrão — um erro real não deve atrasar a hidratação em ~7s.
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("direcionamento_plano_modelo", { _modelo_id: modeloId });
      if (error) throw error;
      return data as PlanoModeloResp;
    },
  });
  const plano = planoResp?.plano ?? null;
  const tipoTam = tipoDoProduto(plano?.tamanho_tipo ?? (modelo as any)?.tamanho_tipo);
  const rotuloTam = (t: string) => ladoTamanho(t, tipoTam) ?? t;
  // Semi-preenchimento (R22): pendências (cor × tamanho que não bateu) e células vindas do plano (azul-claro até editar).
  const [preench, setPreench] = useState<{ aplicado: boolean; pendentes: Pendente[]; doPlano: Set<string> }>({ aplicado: false, pendentes: [], doPlano: new Set() });
  const [confirmarPreencher, setConfirmarPreencher] = useState(false);

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant_config", "tamanhos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantId).maybeSingle()).data,
  });

  // Lojas do tenant (ativas E desativadas — as desativadas só aparecem quando têm linha
  // histórica). E-commerce (default) primeiro, depois ordem.
  const { data: lojas = [], isFetched: lojasFetched, isFetching: lojasFetching } = useQuery({
    queryKey: ["dir-lojas", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("lojas_direcionamento" as any) as any)
        .select("id, nome, ativo, is_default, ordem")
        .order("is_default", { ascending: false })
        .order("ordem", { ascending: true, nullsFirst: false })
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Loja[];
    },
  });

  const { data: cadGrades = [], isFetched: gradesFetched, isFetching: gradesFetching } = useQuery({
    // Sufixo "reais": esta tela lê só variante_numero+grades_reais. A Oficina usa a
    // mesma raiz com colunas diferentes ("full") — sufixo evita shape errado no cache.
    // O CQ invalida por prefixo ["cad-grades", cad?.id], que casa ambos.
    queryKey: ["cad-grades", cad?.id, "reais"],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_grades")
        .select("variante_numero, grades_reais")
        .eq("cad_id", cad!.id)
        .order("variante_numero");
      return data ?? [];
    },
  });

  // Variantes do Tecido Principal (tipo=tecido, numero=1) p/ rotular por cor+apelido.
  const { data: mainFabric } = useQuery({
    queryKey: ["dir-main-fabric", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_tecidos")
        .select("cad_tecido_variantes(ordem, variantes_tecido:variante_tecido_id(nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
        .eq("cad_id", cad!.id)
        .eq("tipo", "tecido")
        .eq("numero", 1)
        .maybeSingle();
      return data;
    },
  });
  // Comprado (Revenda/Importado): modelo comprado não tem Tecido Principal (nunca passa
  // por CAD/cad_tecidos) — rótulo vem do produto vinculado. Cada origem lê a SUA tabela:
  // revenda → produtos_acabados; importado → produtos_importados (mesmo shape de variante).
  const { data: paVariantes } = useQuery({
    queryKey: ["pa-variantes", modeloId],
    enabled: (modelo as any)?.origem === "revenda",
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos_acabados" as any) as any)
        .select("id, produto_acabado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))")
        .eq("modelo_id", modeloId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: impVariantes } = useQuery({
    queryKey: ["imp-variantes", modeloId],
    enabled: (modelo as any)?.origem === "importado",
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos_importados" as any) as any)
        .select("id, produto_importado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))")
        .eq("modelo_id", modeloId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // variante_numero (= ordem) -> "N - nome - cor - apelido" (fallback "Variante N").
  const labelByNumero = useMemo<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    (((mainFabric as any)?.cad_tecido_variantes ?? []) as any[]).forEach((v) => {
      if (v.ordem == null) return;
      const vt = v.variantes_tecido;
      const lbl = varianteLabel({ nome: vt?.nome_variante, cor: vt?.cor?.nome, apelido: vt?.apelido?.nome });
      m[Number(v.ordem)] = lbl !== "—" ? `${v.ordem} - ${lbl}` : `Variante ${v.ordem}`;
    });
    // Comprado (Revenda/Importado): sem Tecido Principal — fallback pras variantes do
    // produto vinculado. Cada origem lê a sua fonte (produto_acabado/produto_importado).
    if (Object.keys(m).length === 0) {
      const compradoVars =
        (modelo as any)?.origem === "revenda"
          ? ((paVariantes as any)?.produto_acabado_variantes ?? [])
          : (modelo as any)?.origem === "importado"
            ? ((impVariantes as any)?.produto_importado_variantes ?? [])
            : [];
      (compradoVars as any[]).forEach((v) => {
        if (v.ordem == null) return;
        const lbl = varianteLabel({ cor: v.cor?.nome, apelido: v.apelido?.nome });
        m[Number(v.ordem)] = lbl !== "—" ? `${v.ordem} - ${lbl}` : `Variante ${v.ordem}`;
      });
    }
    return m;
  }, [mainFabric, modelo, paVariantes, impVariantes]);

  // Apenas os tamanhos presentes na Grade Real (cadastrados), na ordem do
  // tenant_config — não traz os tamanhos da config que o modelo não usa.
  const tamanhos = useMemo<string[]>(() => {
    const cfg = (tenantCfg as any)?.tamanhos_grade;
    const order: string[] = Array.isArray(cfg) && cfg.length ? cfg.map(String) : ["PP", "P", "M", "G", "GG"];
    const present = new Set<string>();
    (cadGrades as any[]).forEach((g) => Object.keys(g.grades_reais ?? {}).forEach((k) => present.add(k)));
    if (present.size === 0) return order;
    const ordered = order.filter((t) => present.has(t));
    const extras = [...present].filter((t) => !ordered.includes(t)).sort();
    return [...ordered, ...extras];
  }, [tenantCfg, cadGrades]);

  const { data: existing = [], refetch, isFetched: existingFetched, isFetching: existingFetching } = useQuery({
    queryKey: ["direcionamento-lojas", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("direcionamento_lojas" as any) as any)
        .select("loja_id, variante_numero, grades")
        .eq("cad_id", cad!.id);
      if (error) throw error;
      return ((data ?? []) as unknown) as { loja_id: string; variante_numero: number; grades: Record<string, number> }[];
    },
  });

  // Rev da âncora de colaboração (direcionamento_controle) — base do rev-check otimista (P0409).
  const { data: dirControle } = useQuery({
    queryKey: ["dir-controle", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("direcionamento_controle" as any) as any)
        .select("rev").eq("cad_id", cad!.id).maybeSingle();
      if (error) throw error;
      return (data ?? null) as { rev: number } | null;
    },
  });
  useEffect(() => { revRef.current = dirControle?.rev ?? 0; }, [dirControle?.rev]);

  // Canal colab por-registro: presença (ring) + reação a UPDATE alheio (merge). A âncora bumpa a cada
  // save do Direcionamento → postgres_changes → onMudancaServidor invalida e o effect de merge roda.
  const { presentes: presentesColab } = useColabRegistro({
    canal: cad?.id ? `colab:dir:${cad.id}` : null,
    tabela: "direcionamento_controle",
    filtroColuna: "cad_id",
    registroId: cad?.id ?? null,
    campoFocado: campoFocadoColab,
    onMudancaServidor: () => {
      qc.invalidateQueries({ queryKey: ["direcionamento-lojas", cad?.id] });
      qc.invalidateQueries({ queryKey: ["dir-controle", cad?.id] });
    },
  });

  // Lojas visíveis na grade: ativas sempre; desativadas só se têm linha salva (esmaecidas).
  const lojasComLinha = useMemo(() => new Set((existing as any[]).map((d) => d.loja_id)), [existing]);
  const lojasVisiveis = useMemo(
    () => (lojas as Loja[]).filter((l) => l.ativo || lojasComLinha.has(l.id)),
    [lojas, lojasComLinha],
  );
  // Pares loja×variante com linha HISTÓRICA salva (mesmo zerada) — uma loja desativada só é
  // editável nas variantes onde já tinha linha; nas outras, o core rejeita linha NOVA de loja
  // inativa (RAISE), então a célula fica desabilitada em vez de aceitar digitação e falhar o save.
  const paresHistoricos = useMemo(
    () => new Set((existing as any[]).map((d) => `${d.loja_id}:${d.variante_numero}`)),
    [existing],
  );

  const [state, setState] = useState<Record<number, VarState>>({});
  const [hydrated, setHydrated] = useState(false);

  // Guarda de "alterações não salvas": snapshot do estado editável (o split ec/loja por variante).
  // status/confirmação seguem por mutations próprias, fora do snapshot. Declarado aqui (antes dos 2
  // effects de hidratação/merge) porque ambos usam `resetBaseline`/`changed` dentro do corpo do effect.
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot(state);

  // Só hidrata quando AMBAS as queries assentaram — senão hidrata do cache vazio
  // (no 1º acesso e ao salvar) e os números somem.
  const dataSettled = gradesFetched && !gradesFetching && existingFetched && !existingFetching && planoFetched && lojasFetched;

  // Loja EDITÁVEL numa variante (ativa, ou inativa com par histórico) — usada pela regra do preenchimento
  // E pelos totais do plano exibidos na tela (M2, T7 fix2): o "plano N" da Grade Real Total, o total do
  // callout e o aviso por tamanho devem somar só as lojas onde o preenchimento de fato mexe, senão o
  // número mostrado não bate com o que a regra realmente compara/escreve.
  const podeEditarLoja = (lojaId: string, vnum: number) => {
    const l = lojasVisiveis.find((x) => x.id === lojaId);
    return !!l && (l.ativo || paresHistoricos.has(`${lojaId}:${vnum}`));
  };
  const lojasEditaveisDe = (vnum: number) => lojasVisiveis.map((l) => l.id).filter((id) => podeEditarLoja(id, vnum));

  // Regra do preenchimento sobre um estado (R22): só lojas EDITÁVEIS da variante (ativa, ou inativa com par histórico).
  // `baseServidor` (T7 fix2, I1) é o que está SALVO (shape GradeDir) — decide quais células a regra considera "minha
  // edição" (`escritas`): só as que DIFEREM do servidor. Sem isso, células pendentes/0-sobre-0 entrariam no `touched`
  // e o merge acusaria conflito falso quando outra pessoa salvasse ali (o rascunho não tinha tocado de fato aquela
  // célula). Default = a base atual do merge (`baseGradeRef`), que é sempre o último visto do servidor.
  const aplicarPlano = (base: Record<number, VarState>, baseServidor: GradeDir = baseGradeRef.current) => {
    const r = preencherComPlano({
      variantes: Object.values(base).map((v) => ({ variante_numero: v.variante_numero, real: v.real })),
      tamanhos,
      lojas: lojasVisiveis.map((l) => ({ id: l.id })),
      podeEditar: podeEditarLoja,
      plano,
      base: baseServidor,
    });
    const obj: Record<number, VarState> = {};
    for (const v of Object.values(base)) obj[v.variante_numero] = { ...v, linhas: r.linhas[v.variante_numero] ?? {} };
    return { obj, pendentes: r.pendentes, doPlano: r.doPlano, escritas: r.escritas };
  };

  useEffect(() => {
    if (hydrated || !cad?.id) return;
    // O plano pode refetchar (voltando de outra aba com cache) enquanto o resto já assentou — espera
    // ele estabilizar antes de semear, senão o rascunho semeia com o plano ANTIGO (fora do dataSettled
    // compartilhado: o effect de MERGE abaixo não depende do plano e não pode esperar por isto).
    // M11 (T7 fix2, simétrico ao planoFetching): lojas em refetch (voltando de outra aba com cache) não deve
    // semear a regra do preenchimento com um conjunto de lojas antigo — `paresHistoricos`/`lojasVisiveis`
    // dependem de `lojas`, e um refetch em voo pode trocar quem é "editável" a meio da hidratação.
    if (!dataSettled || planoFetching || lojasFetching) return;
    const obj: Record<number, VarState> = {};
    (cadGrades as any[]).forEach((g) => {
      obj[g.variante_numero] = {
        variante_numero: g.variante_numero,
        real: g.grades_reais ?? {},
        linhas: {},
      };
    });
    (existing as any[]).forEach((d) => {
      if (!obj[d.variante_numero]) {
        obj[d.variante_numero] = { variante_numero: d.variante_numero, real: {}, linhas: {} };
      }
      obj[d.variante_numero].linhas[d.loja_id] = d.grades ?? {};
    });
    // Distribuição por produto (R22/P-12): sem direcionamento salvo, ainda pendente e editável ⇒ abre SEMI-PREENCHIDO pelo
    // plano. É RASCUNHO refeito a cada abertura enquanto nada for salvo: NÃO conta como "alteração não salva" (P-32 = B,
    // dono 25/set — o guarda nasce do estado PREENCHIDO); a base do merge 3-vias segue o SERVIDOR e as células escritas
    // pelo preenchimento contam como minhas (touched).
    const preencher = !!plano && (existing as any[]).length === 0 && (cad as any)?.direcionamento_status !== "separado" && !readOnly;
    // `baseGradeRef.current` ainda é a baseline ANTERIOR neste tick (só é atualizada logo abaixo) — passa o `obj`
    // recém-montado (o servidor atual) explícito como base do preenchimento, não o ref stale.
    const p = preencher ? aplicarPlano(obj, stateToGradeDir(obj)) : null;
    setState(p ? p.obj : obj);
    // Re-baseline o guarda de alterações a partir do estado semeado (passa o valor
    // explícito — o estado recém-setado ainda está stale neste tick). P-32 = B: o preenchido.
    resetBaseline(p ? p.obj : obj);
    // Baseline do MERGE: o que veio do servidor é a base 3-vias; o "tocado" = as células que o preenchimento escreveu.
    baseGradeRef.current = stateToGradeDir(obj);
    touchedRef.current = new Set(p?.escritas ?? []);
    setPreench(p ? { aplicado: true, pendentes: p.pendentes, doPlano: new Set(p.doPlano) } : { aplicado: false, pendentes: [], doPlano: new Set() });
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadGrades, existing, cad?.id, hydrated, dataSettled, planoFetching, lojasFetching, plano, readOnly]);

  // MERGE 3-vias quando chega UPDATE alheio (o `existing` refetcha por postgres_changes da âncora).
  // Gated por `hydrated` (só depois do seed) e `!reseedingRef` (o pós-save re-baselina sozinho).
  // Monta o `fresh` (estado do servidor) no shape GradeDir e funde com o meu (`state`), preservando
  // minhas células tocadas e sinalizando conflito onde EU e o servidor divergimos na MESMA célula.
  useEffect(() => {
    if (!hydrated || reseedingRef.current || !cad?.id || !dataSettled) return;
    const fresh: GradeDir = {};
    (cadGrades as any[]).forEach((g) => { fresh[g.variante_numero] = {}; });
    (existing as any[]).forEach((d) => {
      (fresh[d.variante_numero] ??= {})[d.loja_id] = d.grades ?? {};
    });
    // I1 (T7 fix2, correção b): o rascunho do semi-preenchimento AINDA intacto (nada editado à mão) não é
    // "meu" de verdade — se o servidor mandou linhas novas (outra pessoa salvou as pendentes, por exemplo),
    // re-hidrata direto do fresh (descarta o preenchimento) em vez de rodar o merge 3-vias normal, que
    // trataria as células tocadas pelo plano como conflito em potencial. Coerente com R22 ("só sem linha
    // salva") e P-32 = B (o rascunho nunca foi uma edição real da pessoa).
    if (preench.aplicado && !changed && (existing as any[]).length > 0) {
      const obj: Record<number, VarState> = {};
      (cadGrades as any[]).forEach((g) => {
        obj[g.variante_numero] = { variante_numero: g.variante_numero, real: g.grades_reais ?? {}, linhas: {} };
      });
      (existing as any[]).forEach((d) => {
        if (!obj[d.variante_numero]) obj[d.variante_numero] = { variante_numero: d.variante_numero, real: {}, linhas: {} };
        obj[d.variante_numero].linhas[d.loja_id] = d.grades ?? {};
      });
      setState(obj);
      resetBaseline(obj);
      baseGradeRef.current = fresh;
      touchedRef.current = new Set();
      setPreench({ aplicado: false, pendentes: [], doPlano: new Set() });
      conflitosRef.current = [];
      setConflitos([]);
      setUltimoMerge(null);
      return;
    }
    const meu = stateToGradeDir(state);
    const mg = mergeGradeDir({ base: baseGradeRef.current, meu, fresh, tocadas: touchedRef.current });
    // Aplica o resultado (mantém minhas edições, adota o fresh no não-tocado), re-baselina e re-tenta.
    if (mg.atualizados.length > 0 || mg.conflitos.length > 0) {
      setState((s) => {
        const out: Record<number, VarState> = {};
        for (const v of Object.values(s)) out[v.variante_numero] = { ...v, linhas: { ...v.linhas } };
        for (const [vnum, lojas] of Object.entries(mg.valor)) {
          const n = Number(vnum);
          out[n] ??= { variante_numero: n, real: {}, linhas: {} };
          out[n].linhas = {};
          for (const [loja, grades] of Object.entries(lojas)) out[n].linhas[loja] = { ...grades };
        }
        return out;
      });
      setUltimoMerge({ atualizados: mg.atualizados.length, conflitos: mg.conflitos });
    }
    conflitosRef.current = mg.conflitos;
    setConflitos(mg.conflitos);
    baseGradeRef.current = fresh;                 // a base agora é o servidor fresco
    // O `revRef` NÃO é atualizado aqui de propósito: `["direcionamento-lojas"]` e `["dir-controle"]`
    // refetcham independentes; ler `dirControle?.rev` neste effect (deps=[existing]) poderia gravar um
    // rev STALE se `existing` chega antes. O effect dedicado abaixo (deps=[dirControle?.rev]) é a fonte
    // ÚNICA do rev — sempre corrige quando a âncora assenta (revisão adversarial, set/2026).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  const setQtd = (num: number, lojaId: string, tam: string, qtd: number) => {
    const path = pathDirCel(num, lojaId, tam);
    touchedRef.current.add(path); // p/ o merge saber o que EU editei
    setPreench((p) => (p.doPlano.has(path) ? { ...p, doPlano: new Set([...p.doPlano].filter((x) => x !== path)) } : p));
    setState((s) => {
      const v = s[num] ?? { variante_numero: num, real: {}, linhas: {} };
      return {
        ...s,
        [num]: { ...v, linhas: { ...v.linhas, [lojaId]: { ...(v.linhas[lojaId] ?? {}), [tam]: qtd } } },
      };
    });
  };

  // "Preencher com o plano" (R22): AlertDialog só se há número DIGITADO à mão — não conta o que o próprio
  // plano já escreveu (M5, T7 fix2): senão o preenchimento inicial já dispararia a confirmação nele mesmo.
  const temNumero = Object.values(state).some((v) =>
    Object.entries(v.linhas).some(([lojaId, g]) =>
      Object.entries(g ?? {}).some(([t, q]) => Number(q) > 0 && !preench.doPlano.has(pathDirCel(v.variante_numero, lojaId, t))),
    ),
  );
  const preencherAgora = () => {
    const r = aplicarPlano(state);
    setState(r.obj);
    for (const p of r.escritas) touchedRef.current.add(p);
    setPreench({ aplicado: true, pendentes: r.pendentes, doPlano: new Set(r.doPlano) });
  };
  // Estado visual da célula (R22): pendente = cor × tamanho que não bateu e ainda vazia; doPlano = veio do plano sem edição.
  const estadoCel = (vn: number, lojaId: string, t: string, valor: number | undefined) => {
    const pendente = valor === undefined && preench.pendentes.some((p) => p.variante_numero === vn && p.tamanho === t);
    const doPlano = preench.doPlano.has(pathDirCel(vn, lojaId, t));
    return {
      classe: pendente ? "bg-amber-50 dark:bg-amber-950/40 placeholder:text-amber-700 dark:placeholder:text-amber-400" : doPlano ? "bg-sky-50 dark:bg-sky-950/40" : "",
      placeholder: pendente ? "–" : "0",
      title: pendente ? "Distribua à mão" : undefined,
    };
  };
  const nomeCorVariante = (vn: number) => plano?.variantes.find((x) => x.variante_numero === vn)?.cor_nome ?? `Variante ${vn}`;

  // Resolução de conflito (path `dir:${variante}:${loja}:${tam}`): "usar o novo" grava o valor do
  // servidor na célula e a destoca (sai do meu "tocado"); "manter o meu" só remove o conflito. Depois
  // limpa o conflito das listas + esvazia o banner quando não sobra nenhum.
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const conf = conflitosRef.current.find((c) => c.path === path);
    if (conf && escolha === "dele" && path.startsWith("dir:")) {
      const [, vnum, loja, tam] = path.split(":");
      setQtd(Number(vnum), loja, tam, Number(conf.dele) || 0);
      touchedRef.current.delete(path); // adotei o do servidor → não é mais "minha" edição
    }
    conflitosRef.current = conflitosRef.current.filter((c) => c.path !== path);
    setConflitos(conflitosRef.current);
    if (conflitosRef.current.length === 0) setUltimoMerge(null);
  };
  // Rótulo humano de um path de conflito p/ o banner: "<loja> · <tam> (var N)". M9 (T7 fix2): o tamanho pelo
  // "Tamanho em" da loja (rotuloTam), não a chave crua ("38|P") que ninguém reconhece no banner.
  const rotuloConflito = (path: string) => {
    if (!path.startsWith("dir:")) return path;
    const [, vnum, loja, tam] = path.split(":");
    const nome = lojasVisiveis.find((l) => l.id === loja)?.nome ?? "loja";
    return `${nome} · ${rotuloTam(tam)} (var ${vnum})`;
  };
  const temConflito = conflitos.length > 0;

  // Payload v2 = estado COMPLETO: uma linha por loja×variante tocada; o servidor sanitiza
  // pelos tamanhos da grade real e faz o diff (linhas fora do payload são apagadas).
  const buildRows = () => {
    const rows: { loja_id: string; variante_numero: number; grades: Record<string, number> }[] = [];
    Object.values(state).forEach((v) => {
      lojasVisiveis.forEach((l) => {
        const grades = v.linhas[l.id];
        if (!grades || Object.keys(grades).length === 0) return;
        // Guarda extra (a célula já fica disabled): nunca manda linha NOVA de loja
        // desativada — o core rejeita (RAISE) e derrubaria o save inteiro.
        if (!l.ativo && !paresHistoricos.has(`${l.id}:${v.variante_numero}`)) return;
        rows.push({ loja_id: l.id, variante_numero: v.variante_numero, grades });
      });
    });
    return rows;
  };

  // Editável = não confirmado, OU confirmado mas com "Editar" ligado. Só marca sujo
  // depois de hidratar e enquanto editável (locked/readOnly não altera nada).
  const editavel = !readOnly && !(status === "separado" && !editing);
  const dirty = hydrated && editavel && changed;
  // Full-page (rota /expedicao/direcionamento/$modeloId): bloqueia navegação. Modal (Sheet
  // no index): o guarda vive no pai, que recebe `dirty` via onDirtyChange — aqui fica inerte.
  const { confirm } = useUnsavedGuard({ dirty: onClose ? false : dirty, blockNav: !onClose });
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado.");
      // Rascunho: a RPC clampa ec≤real e recomputa o split (diff por cad_id+variante).
      // `_rev_base` = rev da âncora que eu vi → a RPC dá P0409 se alguém salvou no meio.
      reseedingRef.current = true; // meu próprio refetch pós-save NÃO deve disparar o merge
      const { error } = await supabase.rpc("salvar_direcionamento" as any, {
        _cad_id: cad.id, _rows: buildRows(), _rev_base: { dir: revRef.current },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Salvo");
      setEditing(false); // salvar trava novamente quando já está confirmado
      markClean(); // limpa o indicador de "alterações não salvas" já no sucesso
      setConflitos([]); conflitosRef.current = []; setUltimoMerge(null);
      // Busca os dados frescos ANTES de liberar a hidratação (senão re-hidrata do
      // cache antigo e zera os números).
      await qc.invalidateQueries({ queryKey: ["direcionamento-lojas", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["dir-controle", cad?.id] });
      await refetch();
      setHydrated(false); // re-hidrata do servidor (re-baselina base/touched/rev)
    },
    onSettled: () => { reseedingRef.current = false; },
    onError: (e: any) => {
      if (e?.code === "P0409") {
        // Alguém salvou no meio: recarrega o servidor → o effect de merge funde e mostra conflitos.
        toast.warning("Alguém salvou o Direcionamento agora — confira os itens em conflito.");
        qc.invalidateQueries({ queryKey: ["direcionamento-lojas", cad?.id] });
        qc.invalidateQueries({ queryKey: ["dir-controle", cad?.id] });
      } else {
        toast.error(mensagemErro(e, "Erro"));
      }
    },
  });

  const confirmMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado.");
      // RPC ATÔMICA: salva (strict — RAISE se ec>real) + marca 'separado' na MESMA
      // transação. Um roundtrip, um toast (antes era save + update separados).
      // `_rev_base` → P0409 se alguém salvou no meio (mesma proteção do Salvar).
      reseedingRef.current = true;
      const { error } = await supabase.rpc("confirmar_direcionamento" as any, {
        _cad_id: cad.id, _rows: buildRows(), _rev_base: { dir: revRef.current },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Direcionamento confirmado — Separado");
      setStatus("separado");
      setEditing(false);
      markClean(); // limpa o indicador de "alterações não salvas" já no sucesso
      setConflitos([]); conflitosRef.current = []; setUltimoMerge(null);
      await qc.invalidateQueries({ queryKey: ["direcionamento-lojas", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["dir-controle", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["dir-cad", modeloId] });
      await qc.invalidateQueries({ queryKey: ["dir-list"] });
      await qc.invalidateQueries({ queryKey: ["dir-plano-modelo", modeloId] });
      await refetch();
      setHydrated(false);
    },
    onSettled: () => { reseedingRef.current = false; },
    onError: (e: any) => {
      if (e?.code === "P0409") {
        toast.warning("Alguém salvou o Direcionamento agora — confira os itens em conflito antes de confirmar.");
        qc.invalidateQueries({ queryKey: ["direcionamento-lojas", cad?.id] });
        qc.invalidateQueries({ queryKey: ["dir-controle", cad?.id] });
      } else {
        toast.error(mensagemErro(e, "Erro ao confirmar"));
      }
    },
  });

  const desmarcarMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) return;
      const { error } = await supabase
        .from("cad")
        .update({ direcionamento_status: "pendente", direcionamento_confirmado_at: null } as any)
        .eq("id", cad.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Confirmação desmarcada — voltou a editável");
      setStatus("pendente");
      setEditing(false);
      setHydrated(false); // re-hidrata do dado fresco (igual save/confirm)
      await qc.invalidateQueries({ queryKey: ["dir-cad", modeloId] });
      await qc.invalidateQueries({ queryKey: ["dir-list"] });
      await qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
      await qc.invalidateQueries({ queryKey: ["dir-plano-modelo", modeloId] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao desmarcar")),
  });

  const confirmado = status === "separado";
  const locked = confirmado && !editing;
  const variantes = Object.values(state).sort((a, b) => a.variante_numero - b.variante_numero);
  // Motivo de bloqueio do Confirmar: primeiro tamanho com falta/sobra (o servidor RAISE
  // igual — aqui é o feedback antes de tentar). null = tudo bate.
  const motivo = useMemo(() => {
    for (const v of variantes) {
      const m = motivoNaoConfere(diffPorTamanho(v.real, Object.values(v.linhas), tamanhos).map((d) => ({ ...d, tamanho: rotuloTam(d.tamanho) })));
      if (m) return `${labelByNumero[v.variante_numero] ?? `Variante ${v.variante_numero}`}: ${m}`;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantes, tamanhos, labelByNumero, tipoTam]);

  // Botões de ação renderizados na barra STICKY do rodapé (todos os tamanhos): rodapé
  // do Sheet no modo modal, PageActionBar (portal no body) no modo página inteira.
  const backButton = onClose ? (
    <Button type="button" variant="outline" onClick={onClose} aria-label="Voltar">
      <ArrowLeft className="h-4 w-4 md:mr-1" /><span className="max-md:sr-only">Voltar</span>
    </Button>
  ) : (
    <Button asChild variant="outline" aria-label="Voltar">
      <Link to="/expedicao/direcionamento"><ArrowLeft className="h-4 w-4 md:mr-1" /><span className="max-md:sr-only">Voltar</span></Link>
    </Button>
  );
  const actionButtons = (
    <div className="ml-auto flex items-center gap-2">
      {!confirmado && motivo && (
        <span className="hidden sm:inline text-xs text-amber-600 dark:text-amber-400 max-w-[46ch] truncate" title={motivo}>
          {motivo}
        </span>
      )}
      {!confirmado ? (
        <>
          <Button variant="outline" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly || temConflito} title={temConflito ? "Resolva os conflitos antes de salvar" : undefined} aria-label="Salvar">
            <Save className="h-4 w-4 md:mr-2" /><span className="max-md:sr-only">Salvar</span>
          </Button>
          <Button
            title={temConflito ? "Resolva os conflitos antes de confirmar" : (motivo ?? undefined)}
            aria-label="Confirmar Direcionamento"
            onClick={() => confirmMut.mutate()}
            disabled={confirmMut.isPending || saveMut.isPending || readOnly || !cad?.id || !!motivo || temConflito}
          >
            <CheckCircle2 className="h-4 w-4 md:mr-2" /><span className="max-md:sr-only">Confirmar Direcionamento</span>
          </Button>
        </>
      ) : editing ? (
        <>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly || temConflito} title={temConflito ? "Resolva os conflitos antes de salvar" : undefined} aria-label="Salvar">
            <Save className="h-4 w-4 md:mr-2" /><span className="max-md:sr-only">Salvar</span>
          </Button>
          <Button variant="ghost" onClick={() => desmarcarMut.mutate()} disabled={desmarcarMut.isPending || readOnly} aria-label="Desmarcar">
            <RotateCcw className="h-4 w-4 md:mr-2" /><span className="max-md:sr-only">Desmarcar</span>
          </Button>
        </>
      ) : (
        <>
          <Button variant="outline" size="icon" onClick={() => setEditing(true)} disabled={readOnly} aria-label="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={() => desmarcarMut.mutate()} disabled={desmarcarMut.isPending || readOnly} aria-label="Desmarcar">
            <RotateCcw className="h-4 w-4 md:mr-2" /><span className="max-md:sr-only">Desmarcar</span>
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className={onClose ? "flex h-full flex-col min-h-0" : ""}>
      <div
        ref={colabScopeRef}
        className={`${onClose ? "flex-1 overflow-y-auto w-full " : "container mx-auto "}p-3 sm:p-6 space-y-6 ${onClose ? "" : "pb-24"}`}
        onFocusCapture={(e) => {
          const scope = colabScopeRef.current;
          setCampoFocadoColab(scope ? pathDoElemento(e.target as HTMLElement, scope) : null);
        }}
        onBlurCapture={() => setCampoFocadoColab(null)}
      >
      <ColabPresenceOverlay presentes={presentesColab} scopeRef={colabScopeRef} />
      {/* Banner de colaboração: presença + "alguém salvou agora" + resolução de conflito por célula. */}
      <ColabBanner
        presentes={presentesColab}
        ultimoMerge={ultimoMerge}
        conflitos={conflitos}
        onResolver={resolverPorPath}
        rotulo={rotuloConflito}
      />
      <VerificarRevisao modeloId={modeloId} etapa="direcionamento" />
      {/* Cabeçalho: breadcrumb + Imprimir (topo-direita, p/ o indicador global de "não
          salvo" cair logo abaixo). Voltar vai só no rodapé; ações primárias idem. */}
      <div className="flex items-start gap-3">
        <Breadcrumb
          items={[
            { label: "Expedição & Logística" },
            { label: "Direcionamento" },
            { label: modelo?.ref ?? "…" },
          ]}
        />
        <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
        <Button variant="outline" size="sm" className="hidden md:inline-flex shrink-0" onClick={() => printWithImages()} disabled={variantes.length === 0}>
          <Printer className="h-4 w-4 mr-2" /> Imprimir Romaneio
        </Button>
      </div>
      <fieldset disabled={readOnly || locked} className="contents">

      <header className="flex items-start gap-3">
        <Compass className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <ModeloResumoFoto
          fontes={[(modelo as any)?.fotos_modelo?.[0], (modelo as any)?.desenho_tecnico_url, (modelo as any)?.croqui_url]}
          nome={modelo?.nome} className="h-14 w-14" zoom
        />
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight">{modelo?.ref ?? "…"} — {modelo?.nome ?? ""}</h1>
          <p className="text-sm text-muted-foreground">{modelo?.colecao ?? "—"}</p>
          <ModeloResumoMeta
            subcolecao={(modelo as any)?.subcolecao} lancamento={(modelo as any)?.semana}
            mesNome={(modelo as any)?.mes?.mes} anoNome={(modelo as any)?.ano?.ano}
          />
        </div>
        <StatusBadge tone={confirmado ? "success" : "warning"}>
          {confirmado ? "Separado" : "Pendente"}
        </StatusBadge>
      </header>

      {/* Distribuição por produto (P-16 = C): só "X modelos direcionados" da subcoleção (sai o /Y e a tira global). */}
      {planoResp?.subcolecao && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <div><span className="text-muted-foreground">Subcoleção </span><span className="font-medium">{planoResp.subcolecao}</span></div>
          <div>
            <span className="font-semibold tabular-nums">{planoResp.direcionados}</span>
            <span className="text-muted-foreground"> {planoResp.direcionados === 1 ? "modelo direcionado" : "modelos direcionados"}</span>
          </div>
        </Card>
      )}
      {planoResp && (
        <PlanoDoModeloCard
          plano={plano}
          motivo={planoResp.motivo_sem_plano}
          tamanhos={tamanhosDoPlano(plano?.tamanhos ?? tamanhos, tamanhos, plano)}
          rotuloTam={rotuloTam}
          rotuloVariante={(vn) => labelByNumero[vn] ?? `Variante ${vn}`}
          podePreencher={editavel && variantes.length > 0}
          onPreencher={() => (temNumero ? setConfirmarPreencher(true) : preencherAgora())}
        />
      )}
      {preench.aplicado && plano && variantes.length > 0 && (() => {
        const realTotal = variantes.reduce((s, v) => s + tamanhos.reduce((a, t) => a + (Number(v.real?.[t]) || 0), 0), 0);
        const planoTotal = variantes.reduce((s, v) => s + totalPlanoVariante(plano, v.variante_numero, lojasEditaveisDe(v.variante_numero)).total, 0);
        const lista = preench.pendentes.map((p) => `${nomeCorVariante(p.variante_numero)} ${rotuloTam(p.tamanho)} (${p.real} peças)`).join(" e ");
        return (
          <Card className="flex gap-2 border-amber-500/50 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              <b>Preenchido pelo plano onde bateu com a Grade Real</b> (rascunho — nada foi salvo; células em azul-claro vieram do plano).
              {" "}A <b>Grade Real</b> é o que voltou da <b>recepção dos serviços</b>, já sem os defeitos do CQ: <b>{realTotal}</b> peças, contra <b>{planoTotal}</b> do plano.
              {preench.pendentes.length > 0 ? (
                <>{" "}Onde cor × tamanho não bateu, a coluna ficou vazia (–) em todas as lojas, porque não dá para saber de qual loja tirar. É aqui que a diferença entre plano e realidade se acerta: <b>distribua à mão as colunas vazias</b> — <b>{lista}</b>.</>
              ) : (
                <>{" "}Tudo bateu com a Grade Real.</>
              )}
              {" "}O Confirmar continua exigindo Σ Direcionado = Grade Real em cada tamanho.
            </p>
          </Card>
        );
      })()}

      {!cad?.id && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
          Sem registro de CAD para este modelo.
        </Card>
      )}

      {variantes.length === 0 && cad?.id && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma variante com grade real definida no CAD.</Card>
      )}

      {variantes.map((v) => {
        const diffs = diffPorTamanho(v.real, Object.values(v.linhas), tamanhos);
        const realTotal = diffs.reduce((s, d) => s + d.real, 0);
        const dirTotal = diffs.reduce((s, d) => s + d.direcionado, 0);
        return (
          <Card key={v.variante_numero} className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{labelByNumero[v.variante_numero] ?? `Variante ${v.variante_numero}`}</h3>
              <div className="text-xs text-muted-foreground">
                Grade Real Total: <strong>{realTotal}</strong>
                {plano && <span> · plano {totalPlanoVariante(plano, v.variante_numero, lojasEditaveisDe(v.variante_numero)).total}</span>}
              </div>
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="border px-2 py-1 text-left">Linha</th>
                    {tamanhos.map((t) => <th key={t} className="border px-2 py-1 text-center w-20">{rotuloTam(t)}</th>)}
                    <th className="border px-2 py-1 text-center w-20">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border px-2 py-1 font-medium">
                      <span className="inline-flex items-center gap-1">Grade Real<InfoHover ariaLabel="O que é a Grade Real">{TEXTO_GRADE_REAL}</InfoHover></span>
                    </td>
                    {tamanhos.map((t) => {
                      const real = Number(v.real?.[t] ?? 0);
                      const pt = plano ? (totalPlanoVariante(plano, v.variante_numero, lojasEditaveisDe(v.variante_numero)).porTamanho[t] ?? 0) : null;
                      return (
                        <td key={t} className="border px-2 py-1 text-center bg-muted/30">
                          {real}
                          {pt !== null && pt !== real && <small className="block text-[10px] text-amber-700 dark:text-amber-400">plano {pt}</small>}
                        </td>
                      );
                    })}
                    <td className="border px-2 py-1 text-center font-semibold">{realTotal}</td>
                  </tr>
                  {lojasVisiveis.map((l) => {
                    const grades = v.linhas[l.id] ?? {};
                    const lojaTotal = tamanhos.reduce((s, t) => s + Number(grades[t] ?? 0), 0);
                    // Desativada + sem linha histórica NESTA variante: célula fica desabilitada
                    // (evita que uma linha nova de loja inativa derrube o Salvar/Confirmar).
                    const editavelLinha = l.ativo || paresHistoricos.has(`${l.id}:${v.variante_numero}`);
                    return (
                      <tr key={l.id} className={l.ativo ? "" : "opacity-60"}>
                        <td className="border px-2 py-1 font-medium">
                          {l.nome}
                          {!l.ativo && <Badge variant="secondary" className="ml-2 text-[10px]">Desativada</Badge>}
                        </td>
                        {tamanhos.map((t) => {
                          const est = estadoCel(v.variante_numero, l.id, t, grades[t]);
                          return (
                            <td key={t} className="border p-0">
                              <NumberInput
                                integer blankZero placeholder={est.placeholder} min={0}
                                className={`h-8 max-md:h-11 border-0 bg-transparent text-center ${est.classe}`}
                                value={grades[t] ?? ""}
                                disabled={!editavelLinha}
                                data-colab-path={`dir:${v.variante_numero}:${l.id}:${t}`}
                                title={editavelLinha ? est.title : "Loja desativada — reative no Cadastro de Lojas para direcionar aqui."}
                                onChange={(e) => setQtd(v.variante_numero, l.id, t, Math.max(0, Number(e.target.value) || 0))}
                              />
                            </td>
                          );
                        })}
                        <td className="border px-2 py-1 text-center font-semibold">{lojaTotal}</td>
                      </tr>
                    );
                  })}
                  {/* Rodapé vivo: Σ direcionado vs grade real por tamanho (verde = bate). */}
                  <tr className="bg-muted/40">
                    <td className="border px-2 py-1 font-medium">Σ Direcionado</td>
                    {diffs.map((d) => (
                      <td
                        key={d.tamanho}
                        className={`border px-2 py-1 text-center font-semibold ${d.delta === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
                      >
                        {d.direcionado}
                        {d.delta !== 0 && (
                          <span className="block text-[10px] font-normal">{d.delta < 0 ? `faltam ${-d.delta}` : `${d.delta} a mais`}</span>
                        )}
                      </td>
                    ))}
                    <td className={`border px-2 py-1 text-center font-semibold ${dirTotal === realTotal ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {dirTotal} / {realTotal}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Mobile: empilhado por tamanho — real, uma entrada por loja e o Σ vivo. */}
            <div className="md:hidden grid grid-cols-2 gap-2">
              {diffs.map((d) => {
                const t = d.tamanho;
                return (
                  <div key={t} className={`rounded-lg border p-2 ${d.delta !== 0 ? "border-amber-400/60" : ""}`}>
                    <div className="mb-1 border-b pb-1 text-center text-xs font-semibold">{rotuloTam(t)}</div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">Grade Real<InfoHover ariaLabel="O que é a Grade Real">{TEXTO_GRADE_REAL}</InfoHover></span>
                      <span className="font-medium">{d.real}</span>
                    </div>
                    {lojasVisiveis.map((l) => {
                      const editavelLinha = l.ativo || paresHistoricos.has(`${l.id}:${v.variante_numero}`);
                      return (
                        <div key={l.id} className={`mt-1 ${l.ativo ? "" : "opacity-60"}`}>
                          <span className="text-xs text-muted-foreground">{l.nome}</span>
                          <NumberInput
                            integer blankZero placeholder={estadoCel(v.variante_numero, l.id, t, v.linhas[l.id]?.[t]).placeholder} min={0}
                            className={`h-9 max-md:h-11 text-center ${estadoCel(v.variante_numero, l.id, t, v.linhas[l.id]?.[t]).classe}`}
                            value={v.linhas[l.id]?.[t] ?? ""}
                            disabled={!editavelLinha}
                            data-colab-path={`dir:${v.variante_numero}:${l.id}:${t}`}
                            title={editavelLinha ? estadoCel(v.variante_numero, l.id, t, v.linhas[l.id]?.[t]).title : "Loja desativada — reative no Cadastro de Lojas para direcionar aqui."}
                            onChange={(e) => setQtd(v.variante_numero, l.id, t, Math.max(0, Number(e.target.value) || 0))}
                          />
                        </div>
                      );
                    })}
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Σ Direcionado</span>
                      <span className={`font-medium ${d.delta === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {d.direcionado}{d.delta < 0 ? ` · faltam ${-d.delta}` : d.delta > 0 ? ` · ${d.delta} a mais` : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="md:hidden flex justify-between border-t pt-2 text-xs text-muted-foreground">
              <span>Real: <b className="text-foreground">{realTotal}</b></span>
              <span className={dirTotal === realTotal ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                Direcionado: <b>{dirTotal}</b>
              </span>
            </div>
            {preench.pendentes
              .filter((p) => p.variante_numero === v.variante_numero && Object.values(v.linhas).every((g) => g?.[p.tamanho] === undefined))
              .map((p) => (
                <p key={p.tamanho} className="flex gap-1 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span>{textoPendencia(rotuloTam(p.tamanho), p)}</span>
                </p>
              ))}
          </Card>
        );
      })}
      </fieldset>

      {confirmarPreencher && (
        <AlertDialog open onOpenChange={(o) => !o && setConfirmarPreencher(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Preencher com o plano?</AlertDialogTitle>
              <AlertDialogDescription>
                Isso troca os números digitados pelo plano onde ele bate com a Grade Real e deixa vazias as colunas que não batem. Nada é salvo até você clicar em Salvar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmarPreencher(false); preencherAgora(); }}>Preencher</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <RomaneioDirecionamento
        modelo={modelo}
        tamanhos={tamanhos}
        variantes={variantes}
        lojas={lojasVisiveis}
        confirmado={confirmado}
        // Romaneio confirmado carimba a data da SEPARAÇÃO (direcionamento_confirmado_at),
        // não o momento da impressão — senão reimprimir amanhã mostra data errada.
        dataStr={new Date(
          (confirmado && (cad as any)?.direcionamento_confirmado_at) || Date.now(),
        ).toLocaleDateString("pt-BR")}
        labelByNumero={labelByNumero}
      />

      {/* Full-page: guarda o "sair sem salvar" (bloqueia navegação de rota). No modal
          (Sheet no index) o guarda é renderizado pelo pai — aqui não duplica. */}
      {!onClose && (
        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas no direcionamento." />
      )}
      </div>

      {/* Regra 2 — barra de ações sticky no rodapé (todos os tamanhos).
          Sheet: rodapé in-flow do próprio modal. Página inteira: PageActionBar (portal no body). */}
      {onClose ? (
        <div className="shrink-0 border-t bg-background p-3 flex flex-wrap items-center gap-2">
          {backButton}
          {actionButtons}
        </div>
      ) : (
        <PageActionBar>
          {backButton}
          {actionButtons}
        </PageActionBar>
      )}
    </div>
  );
}
