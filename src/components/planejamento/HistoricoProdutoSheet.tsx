import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ChevronRight, History, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ReadOnlyScope } from "@/components/RequirePermission";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { useHistoricoModelo, type DadosEtapa, type DiffHistorico, type EventoHistorico } from "@/hooks/useHistoricoModelo";
import { ACAO_META, campoLabel, coletarPares, ehCampoOculto, valLegivel } from "@/lib/audit-legivel";
import { mensagemErro } from "@/lib/erro-mensagem";

// "Histórico" do produto (F5-3 Task 6) — Sheet lateral SÓ LEITURA aberto pelo item "Histórico" do menu ⋯ do Sheet do Planejamento.
// Mostra a TIMELINE ÚNICA (auditoria da ficha + etapas do kanban), do mais recente ao mais antigo, como a RPC `historico_modelo`
// (Task 4) devolve — aqui não se reordena nem se recalcula nada. Texto legível (UUID→nome, rótulo PT) vem da lib `audit-legivel`
// (Task 5), a MESMA da tela /admin/auditoria. Montado `{open && <… />}` pelo chamador (nasce limpo: consulta nova a cada abertura).

// Ação própria do kanban (a lib só conhece as da auditoria).
const ACAO_ETAPA = { label: "Moveu", tone: "info" as StatusTone };

// Origem do movimento no kanban (`modelo_kanban_historico.origem`) → texto de "quem" (etapa não tem usuário).
const ORIGEM_ETAPA: Record<string, string> = {
  manual: "Manual",
  auto: "Sistema (automático)",
  config: "Sistema (configuração da loja)",
  restauracao: "Sistema (restauração)",
};

/** dd/mm/aaaa hh:mm no fuso da loja (formatToParts: independe de como o ICU junta data e hora). */
export function fmtQuandoHistorico(iso: string, fuso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(t);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}`;
}

/** Quem fez: o nome (auditoria) ou, na etapa do kanban (sem usuário), a origem do movimento. */
export function quemDoEvento(e: EventoHistorico): string {
  if (e.quem) return e.quem;
  if (e.tipo === "etapa") {
    const origem = (e.dados as DadosEtapa | null)?.origem;
    return (origem && ORIGEM_ETAPA[origem]) || "Sistema";
  }
  return "Sistema";
}

/** Campos do diff que a tela mostra (sem o ruído técnico). Só auditoria tem diff; etapa devolve []. */
export function camposVisiveis(e: EventoHistorico): [string, { de: unknown; para: unknown }][] {
  if (e.tipo !== "audit" || !e.dados || typeof e.dados !== "object") return [];
  return Object.entries(e.dados as DiffHistorico).filter(([k]) => !ehCampoOculto(k));
}

type ItemProps = { e: EventoHistorico; fuso: string; nomes: Record<string, string> };

function ItemTimeline({ e, fuso, nomes }: ItemProps) {
  const meta = e.tipo === "etapa" ? ACAO_ETAPA : ACAO_META[e.acao] ?? { label: e.acao, tone: "neutral" as StatusTone };
  const campos = camposVisiveis(e);
  const status = e.tipo === "etapa" ? (e.dados as DadosEtapa | null)?.status : null;
  const expansivel = campos.length > 0;

  const cabecalho = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left">
      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
      <span className="text-sm font-medium">{e.entidade}</span>
      {e.tipo === "etapa" && status && <span className="text-sm">→ {status}</span>}
      {expansivel && (
        <span className="text-xs text-muted-foreground">
          {campos.length} {campos.length === 1 ? "alteração" : "alterações"}
        </span>
      )}
      <span className="basis-full text-xs text-muted-foreground">
        {quemDoEvento(e)} · {fmtQuandoHistorico(e.quando, fuso)}
      </span>
    </div>
  );

  return (
    <li className="relative pl-6" data-testid="historico-item">
      {/* trilho + ponto da linha do tempo */}
      <span aria-hidden className="absolute left-[5px] top-0 h-full w-px bg-border" />
      <span aria-hidden className="absolute left-0 top-3 h-[11px] w-[11px] rounded-full border-2 border-background bg-muted-foreground" />
      <Collapsible className="pb-4">
        {expansivel ? (
          <CollapsibleTrigger className="group flex w-full items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/50 data-[state=open]:bg-muted/40">
            {cabecalho}
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          </CollapsibleTrigger>
        ) : (
          <div className="flex w-full items-start gap-2 px-2 py-2">{cabecalho}</div>
        )}
        {expansivel && (
          <CollapsibleContent>
            <ul className="mx-2 mb-1 space-y-1.5 rounded-md border bg-card/40 p-3 text-sm">
              {campos.map(([campo, d]) => {
                const temDePara = d !== null && typeof d === "object" && ("de" in d || "para" in d);
                return (
                  <li key={campo} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium">{campoLabel(campo)}:</span>
                    {temDePara ? (
                      <>
                        <span className="break-words text-muted-foreground line-through">{valLegivel(campo, d.de, nomes)}</span>
                        <span aria-hidden className="text-muted-foreground">→</span>
                        <span className="break-words">{valLegivel(campo, d.para, nomes)}</span>
                      </>
                    ) : (
                      <span className="break-words">{valLegivel(campo, d, nomes)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </CollapsibleContent>
        )}
      </Collapsible>
    </li>
  );
}

export type HistoricoProdutoSheetProps = {
  modeloId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function HistoricoProdutoSheet({ modeloId, open, onOpenChange }: HistoricoProdutoSheetProps) {
  const fuso = useStoreTimezone();
  const q = useHistoricoModelo(modeloId);
  const eventos = useMemo(() => q.data ?? [], [q.data]);

  // Resolve os UUID de FK (escalar ou em array) de TODA a timeline → nome, numa única chamada (mesmo padrão da /admin/auditoria).
  // Fallback "(removido)" p/ registro apagado. Falha aqui NÃO derruba a timeline: só avisa que alguns nomes não vieram.
  const nomesQ = useQuery({
    queryKey: ["historico-nomes", modeloId, eventos.length],
    enabled: eventos.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const pares = eventos.flatMap((e) => (e.tipo === "audit" && e.dados ? coletarPares(e.dados as DiffHistorico) : []));
      if (pares.length === 0) return {} as Record<string, string>;
      const seen = new Set<string>();
      const uniq = pares.filter((p) => {
        const k = `${p.campo}|${p.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const { data, error } = await supabase.rpc("audit_resolver_referencias" as any, { _pares: uniq });
      if (error) throw error;
      return (data ?? {}) as Record<string, string>;
    },
  });
  const nomes = nomesQ.data ?? {};

  // P-57: "ainda não há dado" = isPending (cobre a consulta PAUSADA sem rede, em que isLoading é false) — nunca cai no "vazio".
  const semConexao = q.isPending && q.fetchStatus === "paused";
  const carregando = q.isPending && !semConexao;
  const falhou = q.isError && !q.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* SÓ LEITURA por natureza: quem só VÊ o card não herda o `fieldset disabled` do SheetContent (senão "Tentar de novo" e
          a árvore de expandir ficam mortos — e no celular não há outro jeito de fechar). */}
      <ReadOnlyScope value={false}>
        <SheetContent side="right" size="editor" className="flex flex-col gap-0 p-0 max-sm:[&>button]:hidden">
          <SheetHeader className="shrink-0 space-y-1 border-b p-4 text-left">
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="sm:hidden" onClick={() => onOpenChange(false)}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
              </Button>
            </div>
            <SheetTitle className="flex items-center gap-2 text-base sm:text-lg">
              <History className="h-5 w-5 text-muted-foreground" /> Histórico do produto
            </SheetTitle>
            <SheetDescription>Tudo o que mudou neste produto, do mais recente ao mais antigo.</SheetDescription>
          </SheetHeader>

          {/* overscroll-contain + touch-pan-y: rolagem própria dentro do Sheet (bug Radix #1159). */}
          <div className="flex-1 touch-pan-y overflow-y-auto overscroll-contain p-4">
            {semConexao && (
              <p className="rounded-lg border p-4 text-sm text-muted-foreground">Sem conexão — o histórico carrega quando a internet voltar.</p>
            )}

            {carregando && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico…
              </p>
            )}

            {falhou && (
              <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 p-4">
                <EmptyState
                  className="w-full border-0 bg-transparent py-6"
                  icon={AlertTriangle}
                  title="Não foi possível carregar o histórico"
                  description={mensagemErro(q.error, "Tente de novo em instantes.")}
                />
                <Button type="button" variant="outline" size="sm" className="self-center" onClick={() => { void q.refetch(); }} disabled={q.isFetching}>
                  {q.isFetching ? "Tentando…" : "Tentar de novo"}
                </Button>
              </div>
            )}

            {!q.isPending && !falhou && eventos.length === 0 && (
              <EmptyState icon={History} title="Sem histórico ainda" description="As próximas alterações deste produto aparecem aqui." />
            )}

            {!q.isPending && !falhou && eventos.length > 0 && (
              <>
                {nomesQ.isError && (
                  <p className="mb-3 text-xs text-muted-foreground">Alguns nomes não puderam ser carregados e aparecem como (removido).</p>
                )}
                <ol className="list-none p-0" data-testid="historico-lista">
                  {eventos.map((e, i) => (
                    <ItemTimeline key={`${e.tipo}-${e.quando}-${i}`} e={e} fuso={fuso} nomes={nomes} />
                  ))}
                </ol>
              </>
            )}
          </div>
        </SheetContent>
      </ReadOnlyScope>
    </Sheet>
  );
}
