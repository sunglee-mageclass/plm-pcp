import { useEffect, useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Wrench, Save, Printer, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { comRotuloColecao } from "@/lib/colecao-rotulo";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReadOnly } from "@/components/RequirePermission";
import { VerificarRevisao } from "@/components/producao/RevisaoErro";
import { ModeloPhotoPrint } from "@/components/producao/cad/shared";
import { printWithImages } from "@/lib/print";
import { PrintArea } from "@/components/shared/PrintArea";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";

export const Route = createFileRoute("/_authenticated/pcp/oficina/$modeloId")({
  component: OficinaDetailPage,
});

const STATUS_TONE: Record<string, StatusTone> = {
  pendente: "warning",
  em_andamento: "info",
  finalizado: "success",
};

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  finalizado: "Finalizado",
};

function computeStatus(b: { data_enviado: string | null; data_entregue: string | null }) {
  if (b.data_entregue) return "finalizado";
  if (b.data_enviado) return "em_andamento";
  return "pendente";
}

function OficinaDetailPage() {
  const { modeloId } = Route.useParams();
  const qc = useQueryClient();
  const fl = useFieldLabels();
  const readOnly = useReadOnly();
  const tenantId = useActiveTenantId();

  const { data: modelo } = useQuery({
    queryKey: ["oficina-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, nome, colecao, colecoes(nome), fotos_modelo, observacoes_tecnicas, categorias_produto:categoria_principal_id(nome)")
        .eq("id", modeloId)
        .single();
      if (error) throw error;
      return comRotuloColecao(data); // [modularidade R11] `colecao` = rótulo
    },
  });

  // [camada C3 · B8c] A query LANÇA o erro (antes engolia: `data` virava `undefined` e a tela tratava a falha como
  // "este modelo ainda não tem CAD"). Sucesso sem linha = `null` (CAD inexistente de verdade); falha na 1ª carga =
  // `cadErro` (aviso + "Tentar de novo", sem formulário, Salvar travado). Refetch com erro depois de sucesso mantém o dado.
  const { data: cad, isError: cadErrored, isSuccess: cadOk, refetch: refetchCad, isFetching: cadFetching } = useQuery({
    queryKey: ["oficina-cad", modeloId],
    retry: 1, // [camada C3 · B1] aviso honesto em ~1s, não nos 3 retries padrão (~7s); o "Tentar de novo" cobre o resto.
    queryFn: async () => {
      const { data, error } = await supabase.from("cad").select("*").eq("modelo_id", modeloId).maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  // Editor de oficina legado (producao_oficina está fora do menu; oficina viva roda em
  // Serviços). Lê empresas de serviço (o espelho terceirizados foi removido).
  const { data: terceirizados = [] } = useQuery({
    queryKey: ["oficina-empresas-servico"],
    queryFn: async () => {
      const { data } = await supabase.from("empresas").select("id, nome_fantasia").eq("tipo", "servico");
      return (data ?? []).map((e: any) => ({ id: e.id, nome_responsavel: e.nome_fantasia }));
    },
  });

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant-cfg-oficina", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await supabase.from("tenant_config").select("tamanhos_grade, oficina_interna").eq("tenant_id", tenantId).maybeSingle()).data,
  });
  const oficinaInterna = Boolean((tenantCfg as any)?.oficina_interna);

  // [camada C3] lança o erro (antes: `data ?? []` -> a ficha imprimia "Sem grade definida." numa falha de carga).
  const { data: gradesRaw, isError: gradesErrored, refetch: refetchGrades, isFetching: gradesFetching } = useQuery({
    // Sufixo "full": esta tela lê o superset (planejada+real+totais). O Direcionamento
    // usa a mesma raiz com só grades_reais ("reais") — sufixo evita shape errado no
    // cache. O CQ invalida por prefixo ["cad-grades", cad?.id], que casa ambos.
    queryKey: ["cad-grades", cad?.id, "full"],
    enabled: !!cad?.id,
    retry: 1, // [camada C3 · B1]
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cad_grades")
        .select("variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real")
        .eq("cad_id", cad!.id)
        .order("variante_numero");
      if (error) throw error;
      return data ?? [];
    },
  });
  const grades = gradesRaw ?? [];
  const gradesErro = gradesErrored && gradesRaw === undefined;

  // Apenas os tamanhos presentes na grade (real, senão planejada), na ordem do
  // tenant_config. Sem isso, o default ["PP",…] não casa com as chaves token
  // "34|PPP" e a grade saía em branco no print (lojas sem tamanhos_grade salvo).
  // Espelha a lógica do Direcionamento, que se auto-corrige.
  const tamanhos = useMemo<string[]>(() => {
    const cfg = (tenantCfg as any)?.tamanhos_grade;
    const order: string[] = Array.isArray(cfg) && cfg.length
      ? cfg.map((x: any) => (typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x))))
      : ["PP", "P", "M", "G", "GG"];
    const present = new Set<string>();
    (grades as any[]).forEach((g) => {
      Object.keys(g.grades_reais ?? g.grades_planejadas ?? {}).forEach((k) => present.add(k));
    });
    if (present.size === 0) return order;
    const ordered = order.filter((t) => present.has(t));
    const extras = [...present].filter((t) => !ordered.includes(t)).sort();
    return [...ordered, ...extras];
  }, [tenantCfg, grades]);

  const { data: existing, refetch, isSuccess: existingOk, isError: existingErrored, isFetching: existingFetching } = useQuery({
    queryKey: ["producao-oficina", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      // Fix hidratação rodada 1 (achado I1 da revisão, "por uniformidade" — Oficina): o erro era
      // engolido (`return data` sem checar) — `data` de `maybeSingle()` some com erro vira `null`,
      // não `undefined`, então a tela seguiria como "sem linha de oficina" (ramo INSERT) mesmo
      // com uma falha real de rede.
      const { data, error } = await supabase.from("producao_oficina").select("*").eq("cad_id", cad!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState({
    terceirizado_id: "" as string,
    preco_por_peca: 0,
    quantidade_enviada: 0,
    quantidade_recebida: 0,
    quantidade_defeito: 0,
    data_enviado: "" as string,
    data_prevista: "" as string,
    data_entregue: "" as string,
    observacao: "",
    observacoes_molde: "",
  });
  const [hydrated, setHydrated] = useState(false);
  // [camada C3 fix1 · I1] `!hydrated`, não `cad === undefined`: depois de um Salvar o `onSuccess` zera `hydrated`; se o refetch do
  // CAD falhar, o RQ MANTÉM o `cad` de antes do save (molde velho) — re-hidratar dele reverteria "Partes do Molde". Erro + não
  // hidratado = aviso com "Tentar de novo" e Salvar travado até uma carga NOVA com sucesso (ver o guard do efeito de hidratação).
  const cadErro = cadErrored && !hydrated;
  const { dirty, reset: resetBaseline } = useDirtySnapshot(form);

  useEffect(() => {
    if (hydrated) return;
    // Espera as duas queries assentarem: producao_oficina e o cad (fonte do molde).
    // Fix hidratação rodada 1 (achado I1): exige `existingOk` (isSuccess) — sem isso, uma carga
    // com ERRO em `producao_oficina` hidrataria como "sem linha" (ramo INSERT do save, que o
    // trigger 1:1 bloqueia se a linha na verdade existir — ver auditoria do report.md).
    // Fix hidratação — re-revisão final (achado m-D, review-final-2.md; pré-existente, idêntico
    // em a8d2fa41): + `|| existingFetching` — voltar à tela (dentro do gcTime, com o cache ainda
    // "morno") semeava do `existing` do cache ANTIGO enquanto o refetch de foco já estava em voo,
    // sem esperar a resposta nova. Se outra pessoa mudou a linha nesse intervalo, o Salvar grava
    // por cima os valores velhos. Tela legada, sem controle de concorrência (é "o último vence"
    // por natureza), mas a correção é barata e fecha a janela de semear do cache desatualizado.
    // [camada C3 fix1 · I1] + `!cadOk || cadFetching`: só semeia de um CAD lido COM SUCESSO e sem refetch em voo (mesma guarda do
    // PCP Serviços/C2) — um refetch pós-Salvar que falha deixa o `cad` VELHO no cache e semearia o molde antigo.
    if (existing === undefined || cad === undefined || !cadOk || cadFetching || !existingOk || existingFetching) return;
    const molde = (cad as any)?.observacoes_molde ?? "";
    let next = form;
    if (existing) {
      next = {
        terceirizado_id: existing.terceirizado_id ?? "",
        preco_por_peca: Number(existing.preco_por_peca ?? 0),
        quantidade_enviada: Number(existing.quantidade_enviada ?? 0),
        quantidade_recebida: Number(existing.quantidade_recebida ?? 0),
        quantidade_defeito: Number(existing.quantidade_defeito ?? 0),
        data_enviado: existing.data_enviado ?? "",
        data_prevista: existing.data_prevista ?? "",
        data_entregue: existing.data_entregue ?? "",
        observacao: existing.observacao ?? "",
        observacoes_molde: molde,
      };
      setForm(next);
    } else {
      next = { ...form, observacoes_molde: molde };
      setForm(next);
    }
    resetBaseline(next);
    setHydrated(true);
  }, [existing, cad, hydrated, existingOk, existingFetching, cadOk, cadFetching]);

  const status = computeStatus({
    data_enviado: form.data_enviado || null,
    data_entregue: form.data_entregue || null,
  });

  const oficinaNome = useMemo(
    () => (terceirizados as any[]).find((t) => t.id === form.terceirizado_id)?.nome_responsavel ?? "—",
    [terceirizados, form.terceirizado_id],
  );

  const { confirm } = useUnsavedGuard({ dirty, blockNav: true });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado. Abra o CAD desse modelo primeiro.");
      const payload = {
        cad_id: cad.id,
        // Oficina interna: o Select de terceirizado fica escondido — não gravar
        // um terceirizado_id órfão (do estado anterior).
        terceirizado_id: oficinaInterna ? null : (form.terceirizado_id || null),
        preco_por_peca: form.preco_por_peca,
        quantidade_enviada: form.quantidade_enviada,
        quantidade_recebida: form.quantidade_recebida,
        quantidade_defeito: form.quantidade_defeito,
        data_enviado: form.data_enviado || null,
        data_prevista: form.data_prevista || null,
        data_entregue: form.data_entregue || null,
        status,
        observacao: form.observacao,
      };
      if (existing?.id) {
        const { error } = await supabase.from("producao_oficina").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("producao_oficina").insert(payload);
        if (error) throw error;
      }
      // "Partes do Molde" tem fonte única no CAD (Ficha de Corte).
      const { error: cadErr } = await supabase
        .from("cad")
        .update({ observacoes_molde: form.observacoes_molde || null } as any)
        .eq("id", cad.id);
      if (cadErr) throw cadErr;
    },
    onSuccess: async () => {
      toast.success("Salvo");
      // Busca os dados frescos ANTES de liberar a hidratação (senão re-hidrata do
      // cache antigo).
      await qc.invalidateQueries({ queryKey: ["producao-oficina", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["oficina-cad", modeloId] });
      await refetch();
      setHydrated(false);
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro")),
  });

  const handlePrint = () => printWithImages();

  const fotos = ((modelo as any)?.fotos_modelo ?? []) as string[];

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 pb-24">
      <VerificarRevisao modeloId={modeloId} etapa="oficina" />

      <div className="no-print space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <Breadcrumb items={[{ label: "PCP" }, { label: "Oficina", to: "/pcp/oficina" }, { label: modelo?.ref ?? "…" }]} />
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </div>
          <div className="flex items-start gap-3">
            <Wrench className="h-7 w-7 text-primary mt-0.5 shrink-0" />
            <div className="flex-1">
              <h1 className="font-display text-xl font-semibold tracking-tight">{modelo?.ref ?? "…"} — {modelo?.nome ?? ""}</h1>
              <p className="text-sm text-muted-foreground">
                {(modelo as any)?.categorias_produto?.nome ?? "—"} • {modelo?.colecao ?? "—"}
              </p>
            </div>
            <StatusBadge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</StatusBadge>
          </div>
        </header>

        {/* Fix hidratação rodada 1 (achado I1, "por uniformidade"): carga com ERRO nunca hidrata
            — banner no lugar do formulário, com "Tentar de novo".
            Fix hidratação rodada 1 (achado M3): sem erro, mas ainda não hidratado —
            "Carregando…" no lugar do formulário, como pedia o brief original.
            Fix hidratação rodada 2 (achado N1 da re-revisão — regressão): o corpo renderiza por
            `hydrated` SOZINHO — um erro de REFETCH posterior não pode esconder o formulário. */}
        {cadErro && (
          <Card role="alert" className="p-5 space-y-3 border-destructive/50 bg-destructive/5 text-sm">
            <p className="text-destructive font-medium">Não foi possível carregar os dados.</p>
            <Button type="button" variant="outline" size="sm" disabled={cadFetching} onClick={() => { refetchCad(); }}>
              <RotateCcw className="h-4 w-4 mr-2" /> {cadFetching ? "Tentando…" : "Tentar de novo"}
            </Button>
          </Card>
        )}
        {cad === undefined && !cadErro && (
          <Card className="p-5 text-sm text-muted-foreground">Carregando…</Card>
        )}
        {gradesErro && (
          <Card role="alert" className="p-4 space-y-2 border-destructive/50 bg-destructive/5 text-sm">
            <p className="text-destructive font-medium">Não foi possível carregar a grade das variantes (usada na ficha impressa).</p>
            <Button type="button" variant="outline" size="sm" disabled={gradesFetching} onClick={() => { refetchGrades(); }}>
              <RotateCcw className="h-4 w-4 mr-2" /> {gradesFetching ? "Tentando…" : "Tentar de novo"}
            </Button>
          </Card>
        )}
        {cad?.id && existingErrored && !hydrated && (
          <Card className="p-5 space-y-3 border-destructive/50 bg-destructive/5 text-sm">
            <p className="text-destructive font-medium">Não foi possível carregar os dados.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
              <RotateCcw className="h-4 w-4 mr-2" /> Tentar de novo
            </Button>
          </Card>
        )}
        {cad?.id && !existingErrored && !cadErro && !hydrated && (
          <Card className="p-5 text-sm text-muted-foreground">Carregando…</Card>
        )}

        {(cad === null || hydrated) && (
        <Card className="p-5 space-y-4">
          <fieldset disabled={readOnly} className="contents">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">Oficina</h3>
            {oficinaInterna && <StatusBadge tone="info">Oficina Interna</StatusBadge>}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {!oficinaInterna && (
              <div>
                <Label className="text-xs">Oficina (responsável)</Label>
                <Select value={form.terceirizado_id} onValueChange={(v) => setForm((f) => ({ ...f, terceirizado_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {(terceirizados as any[]).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.nome_responsavel}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">Preço por Peça</Label>
              <NumberInput blankZero placeholder="0,00" value={form.preco_por_peca}
                onChange={(e) => setForm((f) => ({ ...f, preco_por_peca: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Custo Total</Label>
              <Input readOnly className="bg-muted" value={fmtNum(form.preco_por_peca * form.quantidade_enviada)} />
            </div>

            <div>
              <Label className="text-xs">Qtd Enviada</Label>
              <NumberInput integer blankZero placeholder="0" value={form.quantidade_enviada}
                onChange={(e) => setForm((f) => ({ ...f, quantidade_enviada: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Qtd Recebida</Label>
              <NumberInput integer blankZero placeholder="0" value={form.quantidade_recebida}
                onChange={(e) => setForm((f) => ({ ...f, quantidade_recebida: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Qtd Defeito</Label>
              <NumberInput integer blankZero placeholder="0" value={form.quantidade_defeito}
                onChange={(e) => setForm((f) => ({ ...f, quantidade_defeito: Number(e.target.value) }))} />
            </div>

            <div>
              <Label className="text-xs">Data Enviado</Label>
              <DateField value={form.data_enviado}
                onChange={(e) => setForm((f) => ({ ...f, data_enviado: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Data Prevista</Label>
              <DateField value={form.data_prevista}
                onChange={(e) => setForm((f) => ({ ...f, data_prevista: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Data Entregue</Label>
              <DateField value={form.data_entregue}
                onChange={(e) => setForm((f) => ({ ...f, data_entregue: e.target.value }))} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Observação</Label>
            <Textarea rows={2} value={form.observacao}
              onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Observação de Partes do Molde</Label>
            <Textarea rows={3} value={form.observacoes_molde}
              onChange={(e) => setForm((f) => ({ ...f, observacoes_molde: e.target.value }))} />
          </div>
          </fieldset>
        </Card>
        )}

        {cad === null && (
          <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
            Este modelo ainda não tem registro de CAD. Abra a página de CAD desse modelo antes de salvar.
          </Card>
        )}
      </div>

      {/* Ficha de Oficina — Impressão */}
      <PrintArea>
        <div style={{ padding: 24, fontFamily: "Arial, sans-serif", color: "#000" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Ficha de Oficina</h1>
          <p style={{ fontSize: 12, marginBottom: 16 }}>
            <strong>Oficina:</strong> {oficinaNome}
          </p>

          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            {fotos[0] && <ModeloPhotoPrint path={fotos[0]} maxW={180} maxH={240} />}
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              <div><strong>{fl("ref")}:</strong> {modelo?.ref ?? "—"}</div>
              <div><strong>Modelo:</strong> {modelo?.nome ?? "—"}</div>
              <div><strong>Coleção:</strong> {modelo?.colecao ?? "—"}</div>
              <div><strong>Categoria:</strong> {(modelo as any)?.categorias_produto?.nome ?? "—"}</div>
              <div><strong>Data Enviado:</strong> {form.data_enviado || "—"}</div>
              <div><strong>Data Prevista:</strong> {form.data_prevista || "—"}</div>
              <div><strong>Qtd Enviada:</strong> {form.quantidade_enviada}</div>
            </div>
          </div>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 6 }}>Grade por Variante</h2>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginBottom: 12, pageBreakInside: "avoid" }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={{ border: "1px solid #999", padding: 4, textAlign: "left" }}>Variante</th>
                {tamanhos.map((t) => (
                  <th key={t} style={{ border: "1px solid #999", padding: 4 }}>{t}</th>
                ))}
                <th style={{ border: "1px solid #999", padding: 4 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(grades as any[]).length === 0 && (
                <tr><td colSpan={tamanhos.length + 2} style={{ border: "1px solid #999", padding: 8, textAlign: "center" }}>Sem grade definida.</td></tr>
              )}
              {(grades as any[]).map((g) => {
                // Grade REAL (Recebimento − Defeito) quando o CQ confirmou; antes
                // do CQ grades_reais == planejada, então cai no mesmo valor.
                const gr = g.grades_reais ?? g.grades_planejadas ?? {};
                return (
                  <tr key={g.variante_numero}>
                    <td style={{ border: "1px solid #999", padding: 4 }}>Variante {g.variante_numero}</td>
                    {tamanhos.map((t) => (
                      <td key={t} style={{ border: "1px solid #999", padding: 4, textAlign: "center" }}>
                        {gr[t] ?? ""}
                      </td>
                    ))}
                    <td style={{ border: "1px solid #999", padding: 4, textAlign: "center", fontWeight: 700 }}>
                      {g.grade_total_real ?? g.grade_total_planejada ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 12, marginBottom: 4 }}>Observações Técnicas</h2>
          <p style={{ fontSize: 11, whiteSpace: "pre-wrap", border: "1px solid #ccc", padding: 8, minHeight: 40, pageBreakInside: "avoid" }}>
            {(modelo as any)?.observacoes_tecnicas || "—"}
          </p>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 12, marginBottom: 4 }}>Observação de Partes do Molde</h2>
          <p style={{ fontSize: 11, whiteSpace: "pre-wrap", border: "1px solid #ccc", padding: 8, minHeight: 40, pageBreakInside: "avoid" }}>
            {form.observacoes_molde || "—"}
          </p>


          <div style={{ display: "flex", gap: 32, marginTop: 48 }}>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: "1px solid #000", height: 28 }} />
              <div style={{ fontSize: 11, marginTop: 4 }}>Nome</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: "1px solid #000", height: 28 }} />
              <div style={{ fontSize: 11, marginTop: 4 }}>Assinatura</div>
            </div>
          </div>
        </div>
      </PrintArea>

      <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas na Oficina." />

      <PageActionBar>
        <Button asChild variant="outline" aria-label="Voltar">
          <Link to="/pcp/oficina"><ArrowLeft className="h-4 w-4 md:mr-1" /><span className="max-md:sr-only">Voltar</span></Link>
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" className="hidden md:inline-flex" onClick={handlePrint} disabled={gradesErro || (!!cad?.id && gradesRaw === undefined)}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir Ficha de Oficina
          </Button>
          {/* Fix hidratação (P-57 A, metade 1): + `!hydrated` — auditoria confirmou (26/set) que
              `producao_oficina` não tem RPC própria: o Salvar faz `.update()`/`.insert()` direto
              com TODO o `form` local; cedo demais, grava zeros por cima de um registro real
              (mesma classe de dano do "estado completo", sem ser DELETE). */}
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly || !hydrated || cadErro} aria-label="Salvar">
            <Save className="h-4 w-4 md:mr-2" /><span className="max-md:sr-only">Salvar</span>
          </Button>
        </div>
      </PageActionBar>
    </div>
  );
}
