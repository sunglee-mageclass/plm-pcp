import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReadOnlyScope } from "@/components/RequirePermission";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FilterButton } from "@/components/shared/filters";
import { PeriodoPicker, type Periodo } from "@/components/shared/PeriodoPicker";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { fmtNum } from "@/lib/format";
import { mensagemErro } from "@/lib/erro-mensagem";
import { cn } from "@/lib/utils";
import {
  filtrarBucket, montarExtrato, rotuloOrigem,
  type BucketEstoque, type Extrato, type FamiliaEstoque, type LinhaExtrato, type MovEstoque,
} from "@/lib/estoque-extrato";
import { useExtratoEstoque } from "./useExtratoEstoque";

// "Histórico" do estoque de UM item (urgentes R3, plano-a Task 16) — Sheet SÓ LEITURA aberto pelo botão de cada linha das 3 abas
// de estoque (Tecido / Aviamento / Insumo). Dados: RPCs da T14 (`useExtratoEstoque`); conta (ordem, saldo corrente, período,
// origem, conferência com o estoque): lib pura `src/lib/estoque-extrato.ts`. Aqui só a tela. Montado `{open && <… />}` pelo
// chamador (nasce limpo: filtros zerados e consulta nova a cada abertura).

const ROTULO_FAMILIA: Record<FamiliaEstoque, string> = { tecido: "Tecido", aviamento: "Aviamento", insumo: "Insumo" };
const TOLERANCIA = 0.005;

const FONTE_DATA: Record<string, string> = {
  data_oc: "(data da OC)",
  data_envio: "(data do envio)",
  data_os: "(data da OS)",
};

// ───────────────────────── helpers puros (exportados p/ teste) ─────────────────────────

/** Período do `PeriodoPicker` (Dates LOCAIS de um calendário) → dias "YYYY-MM-DD" que a lib espera. Não passa pelo UTC. */
export function periodoParaDias(p: Periodo): { de: string | undefined; ate: string | undefined } {
  return {
    de: p?.from ? format(p.from, "yyyy-MM-dd") : undefined,
    ate: p?.to ? format(p.to, "yyyy-MM-dd") : undefined,
  };
}

/**
 * Rodapé do extrato (sempre sobre o saldo TOTAL, não sobre o que o filtro mostra):
 *  · ok        — saldo final = físico da tela de estoque;
 *  · negativo  — saiu mais do que entrou: a tela mostra 0, o extrato mostra o saldo calculado (Ruling A17);
 *  · diferenca — o extrato não fecha com o estoque (a RPC e o estoque divergem) → destructive, "avise o suporte".
 * `un` = unidade já com o espaço ("" ou " m").
 */
export function rodapeDoExtrato(ext: Extrato, movs: MovEstoque[], un: string): { tipo: "ok" | "negativo" | "diferenca"; texto: string } {
  const ref = movs[0];
  const esperado = ref ? ref.coreRecebido - ref.coreBaixa : 0;
  const diferenca = (d: number) => ({
    tipo: "diferenca" as const,
    texto: `Diferença de ${fmtNum(Math.abs(d))}${un} entre o extrato e o estoque — avise o suporte.`,
  });
  if (!ext.confere) return diferenca(ext.saldoFinal - esperado);
  if (ext.negativo) {
    if (Math.abs(ext.fisicoTela) < TOLERANCIA) {
      return {
        tipo: "negativo",
        texto: `Saldo calculado ${fmtNum(ext.saldoFinal)}${un} (negativo): a tela de estoque mostra 0 — saiu mais do que entrou.`,
      };
    }
    return diferenca(ext.saldoFinal - ext.fisicoTela);
  }
  if (Math.abs(ext.saldoFinal - ext.fisicoTela) < TOLERANCIA) {
    return { tipo: "ok", texto: `Saldo final ${fmtNum(ext.saldoFinal)}${un} = físico na tela de estoque.` };
  }
  return diferenca(ext.saldoFinal - ext.fisicoTela);
}

/** dd/mm/aaaa [hh:mm] no fuso da loja (formatToParts: independe de como o ICU junta data e hora). */
function fmtQuando(iso: string, fuso: string, comHora: boolean): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(t);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  const dia = `${p("day")}/${p("month")}/${p("year")}`;
  return comHora ? `${dia} ${p("hour")}:${p("minute")}` : dia;
}

const fmtDiaIso = (d: string) => d.split("-").reverse().join("/");

/** Referência = OC nº · REF/nome do modelo · OS nº · rolo (o que a RPC mandou; "OS 12" já vem pronto em `refOc`). */
function referencia(m: MovEstoque): string {
  const oc = m.refOc
    ? /^OS\s/i.test(m.refOc) ? m.refOc : m.origem === "rolo_entrada" ? `Rolo ${m.refOc}` : `OC ${m.refOc}`
    : null;
  return [oc, m.refModelo, m.detalhe].filter((x): x is string => !!x && x.trim() !== "").join(" · ");
}

// ───────────────────────── componente ─────────────────────────

export type ExtratoEstoqueSheetProps = {
  familia: FamiliaEstoque;
  /** Id do ITEM (o que a RPC recebe): variante do tecido / aviamento / insumo (etiqueta). */
  itemId: string;
  /** Qual bucket do item esta linha mostra (variante; ou tamanho × cor no insumo). */
  bucket: BucketEstoque;
  /** Nome do item/linha — vai no título e no breadcrumb. */
  titulo: string;
  onClose: () => void;
  /** Tecido cujo artigo é em kg: o extrato segue em METROS ("kg→m"). */
  kg?: boolean;
  /** Período já escolhido ao abrir (o padrão é nenhum; existe p/ teste). */
  periodoInicial?: Periodo;
};

export function ExtratoEstoqueSheet({ familia, itemId, bucket, titulo, onClose, kg, periodoInicial }: ExtratoEstoqueSheetProps) {
  const fuso = useStoreTimezone();
  const q = useExtratoEstoque(familia, itemId);
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);
  const [origens, setOrigens] = useState<string[]>([]);

  const un = familia === "tecido" ? " m" : "";
  const { varianteId, tamanho, corNome } = bucket;

  const movs = useMemo(
    () => filtrarBucket(q.data ?? [], { varianteId, tamanho, corNome }, familia),
    [q.data, familia, varianteId, tamanho, corNome],
  );
  const { de, ate } = periodoParaDias(periodo);
  const extrato = useMemo(() => montarExtrato(movs, { fuso, de, ate, origens }), [movs, fuso, de, ate, origens]);
  const opcoesOrigem = useMemo(
    () => Array.from(new Set(movs.map((m) => m.origem))).map((o) => ({ id: o, nome: rotuloOrigem(o) })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [movs],
  );
  const rodape = movs.length > 0 ? rodapeDoExtrato(extrato, movs, un) : null;
  const anoBase = Number(new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric" }).format(new Date())) || undefined;

  // P-57: "ainda não há dado" = isPending (cobre a consulta PAUSADA sem rede, em que isLoading é false) — nunca cai no "vazio".
  const semConexao = q.isPending && q.fetchStatus === "paused";
  const carregando = q.isPending && !semConexao;
  const falhou = q.isError && !q.data;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* O extrato é SÓ LEITURA por natureza: quem só VÊ a página da OC não herda o `fieldset disabled` do SheetContent
          (senão Voltar, Período, Origem e "Tentar de novo" ficam mortos — e no celular não há outro jeito de fechar). */}
      <ReadOnlyScope value={false}>
      <SheetContent side="right" size="editor" className="flex flex-col gap-0 p-0 max-sm:[&>button]:hidden">
        <SheetHeader className="shrink-0 space-y-1 border-b p-4 text-left">
          <Breadcrumb items={[{ label: "Entrada e Saída" }, { label: `Estoque ${ROTULO_FAMILIA[familia]}` }, { label: titulo }]} />
          <SheetTitle className="text-base sm:text-lg">Histórico — {titulo}</SheetTitle>
          <SheetDescription>Extrato de entradas e saídas. O saldo final é o físico da tela de estoque.</SheetDescription>
          {familia === "tecido" && (
            <p className="text-xs text-muted-foreground">Quantidades em metros{kg ? " (kg→m)" : ""}.</p>
          )}
        </SheetHeader>

        {/* @container: tabela × cards pela largura do PRÓPRIO Sheet (70vw no desktop, tela cheia no celular), não do viewport. */}
        <div className="@container flex-1 space-y-4 overflow-y-auto p-4">
          {semConexao && (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">Sem conexão — o histórico carrega quando a internet voltar.</p>
          )}
          {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}

          {falhou && (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 p-4">
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{mensagemErro(q.error, "Não foi possível carregar o histórico deste item.")}</span>
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => { void q.refetch(); }} disabled={q.isFetching}>
                {q.isFetching ? "Tentando…" : "Tentar de novo"}
              </Button>
            </div>
          )}

          {!q.isPending && !falhou && movs.length === 0 && (
            <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Nenhum movimento para este item.</p>
          )}

          {!q.isPending && !falhou && movs.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <PeriodoPicker value={periodo} onChange={setPeriodo} anoBase={anoBase} />
                <FilterButton
                  filters={[{ label: "Origem", value: origens, onChange: setOrigens, options: opcoesOrigem }]}
                />
              </div>

              {extrato.linhas.length === 0 && extrato.saldoAnterior === null && (
                <p className="text-sm text-muted-foreground">Nenhum movimento com esses filtros.</p>
              )}

              {(extrato.linhas.length > 0 || extrato.saldoAnterior !== null) && (
                <>
                  {/* Desktop: tabela compacta */}
                  <div className="hidden overflow-x-auto @2xl:block">
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted-foreground">
                        <tr className="border-b">
                          <th className="py-2 pr-3">Data</th>
                          <th className="py-2 pr-3">Movimento</th>
                          <th className="py-2 pr-3">Referência</th>
                          <th className="py-2 pr-3">Quem</th>
                          <th className="py-2 pr-3 text-right">Entrada</th>
                          <th className="py-2 pr-3 text-right">Saída</th>
                          <th className="py-2 text-right">Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {extrato.saldoAnterior !== null && de && (
                          <tr className="border-b bg-muted/30">
                            <td colSpan={6} className="py-2 pr-3 font-medium">
                              Saldo anterior <span className="text-xs font-normal text-muted-foreground">(antes de {fmtDiaIso(de)})</span>
                            </td>
                            <td className="py-2 text-right font-medium tabular-nums">{fmtNum(extrato.saldoAnterior)}{un}</td>
                          </tr>
                        )}
                        {extrato.linhas.map((l, i) => <LinhaTabela key={i} l={l} fuso={fuso} un={un} />)}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile: cada movimento vira um card (sem scroll horizontal em 360px) */}
                  <div className="space-y-2 @2xl:hidden">
                    {extrato.saldoAnterior !== null && de && (
                      <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 text-sm">
                        <span className="font-medium">Saldo anterior <span className="text-xs font-normal text-muted-foreground">(antes de {fmtDiaIso(de)})</span></span>
                        <span className="font-medium tabular-nums">{fmtNum(extrato.saldoAnterior)}{un}</span>
                      </div>
                    )}
                    {extrato.linhas.map((l, i) => <CardMovimento key={i} l={l} fuso={fuso} un={un} />)}
                  </div>
                </>
              )}

              {rodape && (
                <p
                  className={cn(
                    "rounded-lg border p-3 text-sm",
                    rodape.tipo === "diferenca" ? "border-destructive/40 text-destructive" : rodape.tipo === "negativo" ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {rodape.texto}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t p-4">
          <Button variant="outline" onClick={onClose} className="shrink-0 max-sm:aspect-square max-sm:px-0" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Voltar</span>
          </Button>
        </div>
      </SheetContent>
      </ReadOnlyScope>
    </Sheet>
  );
}

// ───────────────────────── linhas ─────────────────────────

function DataCelula({ m, fuso }: { m: MovEstoque; fuso: string }) {
  if (m.quandoFonte === "sem_data" || !m.quando) return <span className="text-muted-foreground">sem data</span>;
  const registro = m.quandoFonte === "registro";
  const txt = fmtQuando(m.quando, fuso, registro);
  if (!txt) return <span className="text-muted-foreground">sem data</span>;
  return (
    <span className="whitespace-nowrap">
      {txt}
      {!registro && FONTE_DATA[m.quandoFonte] && (
        <span className="ml-1 text-[10px] text-muted-foreground">{FONTE_DATA[m.quandoFonte]}</span>
      )}
    </span>
  );
}

function MovimentoBadge({ l }: { l: LinhaExtrato }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <StatusBadge tone={l.tipo === "entrada" ? "success" : "neutral"}>{l.tipo === "entrada" ? "Entrada" : "Saída"}</StatusBadge>
      <span className="text-[10px] text-muted-foreground">{rotuloOrigem(l.origem)}</span>
    </div>
  );
}

function LinhaTabela({ l, fuso, un }: { l: LinhaExtrato; fuso: string; un: string }) {
  const entrada = l.quantidade > 0;
  return (
    <tr className="border-b last:border-0 align-top">
      <td className="py-2 pr-3"><DataCelula m={l} fuso={fuso} /></td>
      <td className="py-2 pr-3"><MovimentoBadge l={l} /></td>
      <td className="py-2 pr-3">{referencia(l) || <span className="text-muted-foreground">—</span>}</td>
      <td className="py-2 pr-3">{l.quem ?? <span className="text-muted-foreground">—</span>}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{entrada ? `${fmtNum(l.quantidade)}${un}` : ""}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{!entrada && l.quantidade < 0 ? `${fmtNum(Math.abs(l.quantidade))}${un}` : ""}</td>
      <td className={cn("py-2 text-right font-medium tabular-nums", l.saldo < 0 && "text-destructive")}>{fmtNum(l.saldo)}{un}</td>
    </tr>
  );
}

function CardMovimento({ l, fuso, un }: { l: LinhaExtrato; fuso: string; un: string }) {
  const ref = referencia(l);
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <DataCelula m={l} fuso={fuso} />
          <MovimentoBadge l={l} />
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("font-semibold tabular-nums", l.quantidade < 0 ? "text-destructive" : "")}>
            {l.quantidade > 0 ? "+" : l.quantidade < 0 ? "−" : ""}{fmtNum(Math.abs(l.quantidade))}{un}
          </div>
          <div className={cn("text-xs tabular-nums text-muted-foreground", l.saldo < 0 && "text-destructive")}>
            Saldo {fmtNum(l.saldo)}{un}
          </div>
        </div>
      </div>
      {(ref || l.quem) && (
        <div className="mt-2 break-words text-xs text-muted-foreground">
          {ref}{ref && l.quem ? " · " : ""}{l.quem}
        </div>
      )}
    </div>
  );
}
