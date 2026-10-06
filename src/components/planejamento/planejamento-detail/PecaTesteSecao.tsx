// Peça Teste (R9, T6) — seção "N. Peça Teste" do Sheet do Planejamento (aparência do mockup APROVADO; comportamento = spec-r9).
// Uma TRILHA por linha de M.O. cujo tipo de serviço exige peça teste; cada trilha tem TENTATIVAS (Fornecedor · Data de saída · Data de
// entrada · Aprovação). A tentativa atual é editável; as reprovadas ficam num histórico só leitura. Nada grava aqui: o rascunho vive no
// `usePecaTeste` e vai no Salvar do card. Componente de APRESENTAÇÃO (props), testável em render estático.
import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronRight, Info, Lock, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { DateField } from "@/components/shared/DateField";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import { ReadOnlyScope } from "@/components/RequirePermission";
import { Secao } from "@/components/planejamento/planejamento-detail/campos";
import { textoReprovarTentativa } from "@/lib/confirmacoes-textos";
import { cn } from "@/lib/utils";
import type { Conflito } from "@/lib/colab/merge";
import {
  ROTULO_STATUS_TRILHA, TEXTO_APROVAR_COM_TROCA, entradaAntesDaSaida, fornecedorMudou, historico, lerPathPT, motivoSemDecisao,
  pathPT, requisitoDoEstado, statusTrilha, tentativaAtualPT, textoMotivoSemDecisao,
  type EstadoPT, type TentativaPT, type TrilhaPT,
} from "@/lib/peca-teste";

export type FornecedorServicoPT = { id: string; nome_fantasia: string };

const SEM_DECISAO = "__sem_decisao__";
const TOM_STATUS: Record<ReturnType<typeof statusTrilha>, StatusTone> = {
  aguardando_saida: "neutral", em_teste: "info", aprovada: "success", reprovada_nova: "danger",
};
const CAMPO_ROTULO: Record<string, string> = {
  fornecedor: "Fornecedor", data_saida: "Data de saída", data_entrada: "Data de entrada", aprovacao: "Aprovação",
};

export const TEXTO_TROCA_FORNECEDOR_REABRE =
  "Trocar o fornecedor aqui troca também na mão de obra deste serviço — ela volta para pendente e precisa de nova aprovação.";
export const TEXTO_TROCA_FORNECEDOR = "Trocar o fornecedor aqui troca também na mão de obra deste serviço.";
export const TEXTO_FORNECEDOR_TRAVADO = "Peça aprovada: fornecedor travado.";
export const TEXTO_ENTRADA_ANTES_DA_SAIDA = "A data de entrada está antes da data de saída — confira (não impede de salvar).";

const dataBR = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

export function PecaTesteSecao({
  numero, selo, estado, base, fornecedores, somenteLeitura = false, carregando = false, erro = false, onTentarDeNovo,
  linhasNovas = [], bloqueadasPorTipo, conflitos = [], onResolverConflito, historicoAberto = false,
  onEditarAtual, onAprovar, onDesfazer, onReprovar, onTrocarFornecedor,
}: {
  numero?: number;
  selo?: ReactNode;
  /** Estado EFETIVO (rascunho + fornecedor trocado no editor da M.O.). */
  estado: EstadoPT | null;
  /** O que o servidor tinha na última leitura (o "M.O.: <fornecedor>" do cabeçalho e as travas). */
  base: EstadoPT | null;
  fornecedores: FornecedorServicoPT[];
  /** Sem permissão de EDITAR a seção: tudo só leitura. */
  somenteLeitura?: boolean;
  carregando?: boolean;
  erro?: boolean;
  onTentarDeNovo?: () => void;
  /** Serviços de linhas de M.O. NOVAS (ainda não salvas) cujo tipo exige peça teste: "Salve o card para lançar…". */
  linhasNovas?: string[];
  /** Linhas cujo TIPO mudou no rascunho da M.O. (a trilha atual é do tipo antigo): só aviso até salvar o card. */
  bloqueadasPorTipo?: ReadonlySet<string>;
  conflitos?: Conflito[];
  /** Estado inicial do "Tentativas anteriores" (colapsável; fechado por padrão — a prop existe para o teste de render estático). */
  historicoAberto?: boolean;
  onResolverConflito?: (path: string, escolha: "meu" | "dele") => void;
  onEditarAtual: (linhaId: string, patch: { data_saida?: string | null; data_entrada?: string | null }) => void;
  onAprovar: (linhaId: string) => void;
  onDesfazer: (linhaId: string) => void;
  onReprovar: (linhaId: string) => void;
  onTrocarFornecedor: (linhaId: string, empresaId: string | null, empresaNome: string | null) => void;
}) {
  const { pedir, dialog } = useConfirmacao();
  const trilhas = estado?.trilhas ?? [];
  const baseDe = (linhaId: string) => base?.trilhas.find((t) => t.mo_linha_id === linhaId);
  // M.O. decidida cujo fornecedor mudou no rascunho volta a PENDENTE no Salvar (regra da R4): o requisito já a conta assim.
  const moEfetivo = (t: TrilhaPT): boolean | null => (fornecedorMudou(t, baseDe(t.mo_linha_id)) && t.mo_aprovado !== null ? null : t.mo_aprovado);
  const req = requisitoDoEstado(estado ?? { trilhas: [], outros: [] }, base);
  const rotuloConflito = (path: string) => {
    const p = lerPathPT(path);
    if (!p) return path;
    const t = trilhas.find((x) => x.mo_linha_id === p.linha);
    const campo = CAMPO_ROTULO[p.campo] ?? p.campo;
    return `Peça Teste${t ? ` — ${t.categoria_nome}` : ""}${p.numero ? ` (tentativa ${p.numero})` : ""} — ${campo}`;
  };
  const outros = estado?.outros ?? [];

  return (
    <ReadOnlyScope value={somenteLeitura}>
      <Secao id="peca_teste" titulo="Peça Teste" numero={numero} selo={selo} defaultOpen>
        {/* só a GRADE editável da tentativa atual fica sob `fieldset disabled` (por trilha, abaixo): o histórico colapsável e o
            "Tentar de novo" funcionam para quem só VÊ a seção (um <button> dentro de fieldset desabilitado não clica). */}
        <>
          {carregando && !estado ? (
            <p className="text-sm text-muted-foreground">Carregando a peça teste…</p>
          ) : erro && !estado ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-destructive">Não foi possível carregar a peça teste.</span>
              <button type="button" className="underline underline-offset-2" onClick={onTentarDeNovo}>Tentar de novo</button>
            </div>
          ) : (
            <>
              {trilhas.length > 0 && (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-sm font-semibold">
                      <b className="tabular-nums">{req.aprovadas} de {req.exigem}</b> serviços com peça teste aprovada
                    </span>
                    <span className="text-xs text-muted-foreground">Necessária para enviar à Explosão (requisito do kanban).</span>
                  </div>
                  {req.ok ? (
                    <Banner tone="ok" icon={<Check className="h-4 w-4" />}>
                      <b>Requisito “Peça teste aprovada” cumprido.</b> Todo serviço que exige peça teste está com a M.O. e a peça teste aprovadas.
                    </Banner>
                  ) : (
                    <Banner tone="info" icon={<Info className="h-4 w-4" />}>
                      <b>Falta para o requisito do kanban:</b> {req.faltas.map((f) => `${f.servico} (${f.motivo})`).join(", ")}. Cada serviço precisa da M.O. aprovada E da peça teste aprovada.
                    </Banner>
                  )}
                </>
              )}

              <ColabBanner presentes={[]} ultimoMerge={null} conflitos={conflitos} onResolver={onResolverConflito} rotulo={rotuloConflito} />

              {trilhas.map((t) => {
                const b = baseDe(t.mo_linha_id);
                if (bloqueadasPorTipo?.has(t.mo_linha_id)) {
                  return (
                    <p key={t.mo_linha_id} className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="peca-teste-bloqueada">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>Salve o card para atualizar a peça teste de {t.categoria_nome}.</span>
                    </p>
                  );
                }
                return (
                  <TrilhaCard
                    key={t.mo_linha_id}
                    trilha={t}
                    base={b}
                    moAprovado={moEfetivo(t)}
                    historicoAberto={historicoAberto}
                    fornecedores={fornecedores}
                    somenteLeitura={somenteLeitura}
                    onEditarAtual={onEditarAtual}
                    onAprovar={onAprovar}
                    onDesfazer={onDesfazer}
                    onTrocarFornecedor={onTrocarFornecedor}
                    onPedirReprovar={(at, fornecedorNome) =>
                      pedir({
                        ...textoReprovarTentativa({ numero: at.numero, servico: t.categoria_nome, fornecedor: fornecedorNome }),
                        onConfirmar: () => onReprovar(t.mo_linha_id),
                      })}
                  />
                );
              })}

              {linhasNovas.map((servico, i) => (
                <p key={`${servico}-${i}`} className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="peca-teste-linha-nova">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Salve o card para lançar a peça teste de {servico}.</span>
                </p>
              ))}

              {outros.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="peca-teste-fora">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {outros.map((o, i) => (
                      <span key={`${o.categoria_nome}-${i}`}>
                        {i > 0 && ", "}
                        <b>{o.categoria_nome}</b>{o.empresa_nome ? ` (${o.empresa_nome})` : ""}
                      </span>
                    ))}{" "}
                    {outros.length > 1 ? "não aparecem" : "não aparece"} aqui: o tipo de serviço não exige peça teste (Cadastro › Atributos › Categoria do Serviço).
                  </span>
                </p>
              )}
            </>
          )}
        </>
        {dialog}
      </Secao>
    </ReadOnlyScope>
  );
}

function Banner({ tone, icon, children }: { tone: "ok" | "info" | "warn"; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      role={tone === "warn" ? "status" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        tone === "ok" && "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
        tone === "info" && "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
        tone === "warn" && "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function TrilhaCard({
  trilha, base, moAprovado, historicoAberto, fornecedores, somenteLeitura, onEditarAtual, onAprovar, onDesfazer, onTrocarFornecedor, onPedirReprovar,
}: {
  trilha: TrilhaPT;
  base: TrilhaPT | undefined;
  moAprovado: boolean | null;
  historicoAberto: boolean;
  fornecedores: FornecedorServicoPT[];
  somenteLeitura: boolean;
  onEditarAtual: (linhaId: string, patch: { data_saida?: string | null; data_entrada?: string | null }) => void;
  onAprovar: (linhaId: string) => void;
  onDesfazer: (linhaId: string) => void;
  onTrocarFornecedor: (linhaId: string, empresaId: string | null, empresaNome: string | null) => void;
  onPedirReprovar: (at: TentativaPT, fornecedorNome: string | null) => void;
}) {
  const uid = useId();
  const [histAberto, setHistAberto] = useState(historicoAberto);
  const linha = trilha.mo_linha_id;
  const at = tentativaAtualPT(trilha);
  const hist = historico(trilha);
  const status = statusTrilha(trilha);
  const aprovada = at.aprovacao === "aprovado";
  const mudou = fornecedorMudou(trilha, base);
  const baseForn = base?.empresa_id ?? null;
  const motivo = motivoSemDecisao(at, baseForn, trilha.empresa_id ?? null);
  // Decidir: com a peça já aprovada a pessoa ainda pode DESFAZER (voltar a "Selecione…") ou reprovar; senão exige datas + fornecedor salvo.
  const aprovacaoDesabilitada = somenteLeitura || (!aprovada && motivo !== null);
  const nomeForn = (id: string | null, nome: string | null) => (id ? (fornecedores.find((f) => f.id === id)?.nome_fantasia ?? nome) : null);
  const fornAtualNome = nomeForn(trilha.empresa_id, trilha.empresa_nome);
  const caminho = (campo: string) => pathPT(linha, campo);
  const moPendente = moAprovado !== true;
  const opcoesForn = fornecedores.some((f) => f.id === trilha.empresa_id) || !trilha.empresa_id
    ? fornecedores
    : [{ id: trilha.empresa_id, nome_fantasia: trilha.empresa_nome ?? "Fornecedor" }, ...fornecedores];

  return (
    <div data-trilha={linha} className={cn("overflow-hidden rounded-lg border bg-card", aprovada && "border-emerald-300 dark:border-emerald-800")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b bg-muted/40 px-3 py-2.5">
        <span className="text-sm font-semibold">{trilha.categoria_nome}</span>
        <span className="text-xs text-muted-foreground">M.O.: {base?.empresa_nome ?? "sem fornecedor"}</span>
        {moPendente && (
          <StatusBadge tone="warning" className="gap-1 normal-case tracking-normal">
            <AlertTriangle className="h-3 w-3" />{moAprovado === false ? "M.O. reprovada" : "M.O. pendente"}
          </StatusBadge>
        )}
        <StatusBadge tone={TOM_STATUS[status]} className="ml-auto gap-1 normal-case tracking-normal">
          {status === "aprovada" && <Check className="h-3 w-3" />}
          {status === "reprovada_nova" && <X className="h-3 w-3" />}
          {ROTULO_STATUS_TRILHA[status]}
        </StatusBadge>
      </div>

      <div key={at.numero} className="flex flex-col gap-2.5 p-3">
        <div className="text-xs font-semibold text-muted-foreground">Tentativa {at.numero}{hist.length > 0 ? " (atual)" : ""}</div>
        <fieldset disabled={somenteLeitura} className="contents" data-testid="peca-teste-grade">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={`${uid}-forn`} className="text-xs">Fornecedor</Label>
            <Select
              value={trilha.empresa_id ?? ""}
              onValueChange={(v) => {
                const f = fornecedores.find((x) => x.id === v);
                onTrocarFornecedor(linha, v || null, f?.nome_fantasia ?? null);
              }}
              disabled={somenteLeitura || aprovada}
            >
              <SelectTrigger id={`${uid}-forn`} className="w-full" data-colab-path={caminho("fornecedor")}>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {opcoesForn.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome_fantasia}</SelectItem>)}
              </SelectContent>
            </Select>
            {aprovada && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="peca-teste-forn-travado">
                <Lock className="h-3 w-3 shrink-0" />{TEXTO_FORNECEDOR_TRAVADO}
              </span>
            )}
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label className="text-xs">Data de saída</Label>
            <DateField
              value={at.data_saida ?? ""}
              onChange={(e) => onEditarAtual(linha, { data_saida: e.target.value || null })}
              disabled={somenteLeitura || aprovada}
              aria-label="Data de saída"
              data-colab-path={caminho("data_saida")}
            />
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label className="text-xs">Data de entrada</Label>
            <DateField
              value={at.data_entrada ?? ""}
              onChange={(e) => onEditarAtual(linha, { data_entrada: e.target.value || null })}
              disabled={somenteLeitura || aprovada}
              aria-label="Data de entrada"
              data-colab-path={caminho("data_entrada")}
            />
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={`${uid}-apr`} className="text-xs">Aprovação</Label>
            <Select
              value={at.aprovacao ?? SEM_DECISAO}
              onValueChange={(v) => {
                if (v === "reprovado") { onPedirReprovar(at, nomeForn(baseForn, base?.empresa_nome ?? null) ?? fornAtualNome); return; }
                if (v === "aprovado") { onAprovar(linha); return; }
                if (aprovada) onDesfazer(linha);
              }}
              disabled={aprovacaoDesabilitada}
            >
              <SelectTrigger id={`${uid}-apr`} className={cn("w-full", !at.aprovacao && "text-muted-foreground")} data-colab-path={caminho("aprovacao")}>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_DECISAO}>Selecione…</SelectItem>
                <SelectItem value="aprovado" disabled={mudou}>Aprovado</SelectItem>
                <SelectItem value="reprovado">Reprovado</SelectItem>
              </SelectContent>
            </Select>
            {!somenteLeitura && !aprovada && motivo && (
              <span className="text-xs text-muted-foreground" data-testid="peca-teste-dica-decisao">{textoMotivoSemDecisao(motivo)}</span>
            )}
            {!somenteLeitura && !aprovada && !motivo && mudou && (
              <span className="text-xs text-muted-foreground" data-testid="peca-teste-dica-troca">{TEXTO_APROVAR_COM_TROCA}</span>
            )}
          </div>
        </div>
        </fieldset>

        {mudou && !somenteLeitura && (
          <Banner tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
            {base?.mo_aprovado != null ? TEXTO_TROCA_FORNECEDOR_REABRE : TEXTO_TROCA_FORNECEDOR}
          </Banner>
        )}
        {entradaAntesDaSaida(at) && (
          <p role="status" className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300" data-testid="peca-teste-dica-datas">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{TEXTO_ENTRADA_ANTES_DA_SAIDA}
          </p>
        )}
      </div>

      {hist.length > 0 && (
        <Collapsible open={histAberto} onOpenChange={setHistAberto} className="border-t">
          <CollapsibleTrigger className="flex min-h-9 w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted-foreground">
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", histAberto && "rotate-90")} />
            Tentativas anteriores ({hist.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col gap-1.5 px-3 pb-3" data-testid="peca-teste-historico">
              {[...hist].reverse().map((h) => (
                <li key={h.numero} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-dashed bg-muted/30 px-2.5 py-2 text-sm">
                  <span className="w-24 text-xs font-semibold text-muted-foreground">Tentativa {h.numero}</span>
                  <span className="min-w-0"><span className="block text-xs text-muted-foreground">Fornecedor</span>{h.empresa_nome ?? "—"}</span>
                  <span><span className="block text-xs text-muted-foreground">Data de saída</span><span className="tabular-nums">{dataBR(h.data_saida)}</span></span>
                  <span><span className="block text-xs text-muted-foreground">Data de entrada</span><span className="tabular-nums">{dataBR(h.data_entrada)}</span></span>
                  <StatusBadge tone="danger" className="ml-auto gap-1 normal-case tracking-normal"><X className="h-3 w-3" />Reprovado</StatusBadge>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
