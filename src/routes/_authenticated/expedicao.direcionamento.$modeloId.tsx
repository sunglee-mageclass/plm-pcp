import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Compass, Save, CheckCircle2, RotateCcw, Pencil, Printer } from "lucide-react";
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

  const { data: modelo } = useQuery({
    queryKey: ["dir-modelo", modeloId],
    queryFn: async () => (await (supabase.from("modelos") as any).select("id, ref, nome, colecao, subcolecao, semana, origem, fotos_modelo, desenho_tecnico_url, croqui_url, mes:mes_id(mes), ano:ano_id(ano)").eq("id", modeloId).single()).data,
  });

  const { data: cad } = useQuery({
    queryKey: ["dir-cad", modeloId],
    queryFn: async () => (await (supabase.from("cad") as any).select("id, direcionamento_status, direcionamento_confirmado_at").eq("modelo_id", modeloId).maybeSingle()).data as { id: string; direcionamento_status: string | null; direcionamento_confirmado_at: string | null } | null,
  });
  useEffect(() => {
    if (cad) setStatus((cad as any).direcionamento_status ?? "pendente");
  }, [cad]);

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant_config", "tamanhos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantId).maybeSingle()).data,
  });

  // Lojas do tenant (ativas E desativadas — as desativadas só aparecem quando têm linha
  // histórica). E-commerce (default) primeiro, depois ordem.
  const { data: lojas = [] } = useQuery({
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
  // Revenda (Produto Acabado, Task 7): modelo `origem='revenda'` não tem Tecido
  // Principal (nunca passa por CAD/cad_tecidos) — rótulo vem do produto vinculado.
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

  // variante_numero (= ordem) -> "N - nome - cor - apelido" (fallback "Variante N").
  const labelByNumero = useMemo<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    (((mainFabric as any)?.cad_tecido_variantes ?? []) as any[]).forEach((v) => {
      if (v.ordem == null) return;
      const vt = v.variantes_tecido;
      const lbl = varianteLabel({ nome: vt?.nome_variante, cor: vt?.cor?.nome, apelido: vt?.apelido?.nome });
      m[Number(v.ordem)] = lbl !== "—" ? `${v.ordem} - ${lbl}` : `Variante ${v.ordem}`;
    });
    // Revenda (Task 7): sem Tecido Principal — fallback pras variantes do produto vinculado.
    if (Object.keys(m).length === 0 && (modelo as any)?.origem === "revenda") {
      (((paVariantes as any)?.produto_acabado_variantes ?? []) as any[]).forEach((v) => {
        if (v.ordem == null) return;
        const lbl = varianteLabel({ cor: v.cor?.nome, apelido: v.apelido?.nome });
        m[Number(v.ordem)] = lbl !== "—" ? `${v.ordem} - ${lbl}` : `Variante ${v.ordem}`;
      });
    }
    return m;
  }, [mainFabric, modelo, paVariantes]);

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

  // Só hidrata quando AMBAS as queries assentaram — senão hidrata do cache vazio
  // (no 1º acesso e ao salvar) e os números somem.
  const dataSettled = gradesFetched && !gradesFetching && existingFetched && !existingFetching;

  useEffect(() => {
    if (hydrated || !cad?.id) return;
    if (!dataSettled) return;
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
    setState(obj);
    // Re-baseline o guarda de alterações a partir do estado semeado (passa o valor
    // explícito — o estado recém-setado ainda está stale neste tick).
    resetBaseline(obj);
    setHydrated(true);
  }, [cadGrades, existing, cad?.id, hydrated, dataSettled]);

  const setQtd = (num: number, lojaId: string, tam: string, qtd: number) => {
    setState((s) => {
      const v = s[num] ?? { variante_numero: num, real: {}, linhas: {} };
      return {
        ...s,
        [num]: { ...v, linhas: { ...v.linhas, [lojaId]: { ...(v.linhas[lojaId] ?? {}), [tam]: qtd } } },
      };
    });
  };

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

  // Guarda de "alterações não salvas": snapshot do estado editável (o split ec/loja por
  // variante). status/confirmação seguem por mutations próprias, fora do snapshot.
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot(state);
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
      const { error } = await supabase.rpc("salvar_direcionamento" as any, { _cad_id: cad.id, _rows: buildRows() });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Salvo");
      setEditing(false); // salvar trava novamente quando já está confirmado
      markClean(); // limpa o indicador de "alterações não salvas" já no sucesso
      // Busca os dados frescos ANTES de liberar a hidratação (senão re-hidrata do
      // cache antigo e zera os números).
      await qc.invalidateQueries({ queryKey: ["direcionamento-lojas", cad?.id] });
      await refetch();
      setHydrated(false);
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro")),
  });

  const confirmMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado.");
      // RPC ATÔMICA: salva (strict — RAISE se ec>real) + marca 'separado' na MESMA
      // transação. Um roundtrip, um toast (antes era save + update separados).
      const { error } = await supabase.rpc("confirmar_direcionamento" as any, { _cad_id: cad.id, _rows: buildRows() });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Direcionamento confirmado — Separado");
      setStatus("separado");
      setEditing(false);
      markClean(); // limpa o indicador de "alterações não salvas" já no sucesso
      await qc.invalidateQueries({ queryKey: ["direcionamento-lojas", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["dir-cad", modeloId] });
      await qc.invalidateQueries({ queryKey: ["dir-list"] });
      await refetch();
      setHydrated(false);
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao confirmar")),
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
      const m = motivoNaoConfere(diffPorTamanho(v.real, Object.values(v.linhas), tamanhos));
      if (m) return `${labelByNumero[v.variante_numero] ?? `Variante ${v.variante_numero}`}: ${m}`;
    }
    return null;
  }, [variantes, tamanhos, labelByNumero]);

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
          <Button variant="outline" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly} aria-label="Salvar">
            <Save className="h-4 w-4 md:mr-2" /><span className="max-md:sr-only">Salvar</span>
          </Button>
          <Button
            title={motivo ?? undefined}
            aria-label="Confirmar Direcionamento"
            onClick={() => confirmMut.mutate()}
            disabled={confirmMut.isPending || saveMut.isPending || readOnly || !cad?.id || !!motivo}
          >
            <CheckCircle2 className="h-4 w-4 md:mr-2" /><span className="max-md:sr-only">Confirmar Direcionamento</span>
          </Button>
        </>
      ) : editing ? (
        <>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly} aria-label="Salvar">
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
      <div className={`${onClose ? "flex-1 overflow-y-auto w-full " : "container mx-auto "}p-3 sm:p-6 space-y-6 ${onClose ? "" : "pb-24"}`}>
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
          nome={modelo?.nome} className="h-14 w-14"
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
              <div className="text-xs text-muted-foreground">Grade Real Total: <strong>{realTotal}</strong></div>
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="border px-2 py-1 text-left">Linha</th>
                    {tamanhos.map((t) => <th key={t} className="border px-2 py-1 text-center w-20">{t}</th>)}
                    <th className="border px-2 py-1 text-center w-20">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border px-2 py-1 font-medium">Grade Real</td>
                    {tamanhos.map((t) => (
                      <td key={t} className="border px-2 py-1 text-center bg-muted/30">{Number(v.real?.[t] ?? 0)}</td>
                    ))}
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
                        {tamanhos.map((t) => (
                          <td key={t} className="border p-0">
                            <NumberInput
                              integer min={0}
                              className="h-8 max-md:h-11 border-0 bg-transparent text-center"
                              value={grades[t] ?? ""}
                              disabled={!editavelLinha}
                              title={editavelLinha ? undefined : "Loja desativada — reative no Cadastro de Lojas para direcionar aqui."}
                              onChange={(e) => setQtd(v.variante_numero, l.id, t, Math.max(0, Number(e.target.value) || 0))}
                            />
                          </td>
                        ))}
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
                          <span className="block text-[10px] font-normal">({d.delta > 0 ? `+${d.delta}` : d.delta})</span>
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
                    <div className="mb-1 border-b pb-1 text-center text-xs font-semibold">{t}</div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Grade Real</span>
                      <span className="font-medium">{d.real}</span>
                    </div>
                    {lojasVisiveis.map((l) => {
                      const editavelLinha = l.ativo || paresHistoricos.has(`${l.id}:${v.variante_numero}`);
                      return (
                        <div key={l.id} className={`mt-1 ${l.ativo ? "" : "opacity-60"}`}>
                          <span className="text-xs text-muted-foreground">{l.nome}</span>
                          <NumberInput
                            integer min={0}
                            className="h-9 max-md:h-11 text-center"
                            value={v.linhas[l.id]?.[t] ?? ""}
                            disabled={!editavelLinha}
                            title={editavelLinha ? undefined : "Loja desativada — reative no Cadastro de Lojas para direcionar aqui."}
                            onChange={(e) => setQtd(v.variante_numero, l.id, t, Math.max(0, Number(e.target.value) || 0))}
                          />
                        </div>
                      );
                    })}
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Σ Direcionado</span>
                      <span className={`font-medium ${d.delta === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {d.direcionado}{d.delta !== 0 ? ` (${d.delta > 0 ? "+" : ""}${d.delta})` : ""}
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
          </Card>
        );
      })}
      </fieldset>

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
