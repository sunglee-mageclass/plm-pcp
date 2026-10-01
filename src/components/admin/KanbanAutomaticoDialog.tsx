import { Fragment, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Hand, Loader2, Save, Tag, Undo2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { KanbanStatus } from "@/lib/kanban-status";
import { labelDaColuna, labelsCondicoes, type PreviaRecalculo, type PreviaRestauracao } from "@/lib/kanban-auto-ui";
import { agruparMovimentos, avisosRestauracaoVisiveis, formatarDataHora, nCards, resumirFixados } from "@/lib/kanban-auto-config";
import { kanbanDefinirAutomatico, kanbanPreviaRecalculo, kanbanPreviaRestauracao, kanbanRestaurar } from "@/lib/kanban-auto-rpc";

/**
 * KANBAN AUTOMÁTICO — F2, Config da Loja.
 *  - `KanbanAutomaticoBloco`: o switch da chave (controlado pelo valor do BANCO; mexer abre o diálogo).
 *  - Ligar: prévia (`kanban_previa_recalculo({kanban_automatico:true})`) → "Ligar e mover N cards" →
 *    `kanban_definir_automatico(true)` (a F1 grava o lote p/ desfazer e recalcula na mesma transação).
 *  - Desligar: prévia de restauração (lote NULL = o último 'ligar') → opcional "Restaurar as colunas de antes"
 *    → `kanban_definir_automatico(false)` e, se marcado, `kanban_restaurar(lote)` (exige a chave desligada).
 *  - `KanbanSalvarDialog`: "Salvar e mover N cards" ao salvar requisitos/ordem com a chave ligada.
 * A F1 não confere se a prévia foi vista (D19): a garantia "prévia antes de confirmar" é ESTE arquivo.
 */

/** Kanban #9 — aviso âmbar (não bloqueia): revenda sem requisitos no Fluxo de Revenda. `mostrar` vem de
 *  `revendaSemRequisitos(módulo produto_acabado ligado, requisitos)`. O atalho leva ao card "Fluxo de Revenda". */
export function AvisoRevendaSemRequisitos({ mostrar, onIrParaFluxo }: { mostrar: boolean; onIrParaFluxo?: () => void }) {
  if (!mostrar) return null;
  return (
    <div className="flex gap-2 rounded-md bg-[var(--tone-warning-bg)] px-3 py-2 text-sm text-[var(--tone-warning-fg)]" data-testid="kanban-aviso-revenda">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <span className="font-semibold">Revenda sem requisitos.</span> O Fluxo de Revenda não tem nenhum requisito configurado; com o kanban
        automático, todo produto de revenda anda até a última coluna sem exigir nada.{" "}
        {onIrParaFluxo && (
          <button type="button" className="font-semibold underline underline-offset-2" onClick={onIrParaFluxo}>
            Ir para o Fluxo de Revenda
          </button>
        )}
      </span>
    </div>
  );
}

const RODAPE = "border-t bg-background -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3 flex-row flex-wrap items-center gap-2";

// Important (fix round 1, revisão Opus): decisão 8 do dono, já aprovada — restaurar só é oferecido
// no momento do Desligar; depois disso, só por psql (suporte). O texto do diálogo e o toast de
// "desligado sem restaurar" precisam deixar isso claro, senão o usuário acha que pode voltar
// depois pela própria tela.
const AVISO_SO_AGORA = "Se não marcar agora, as colunas de antes não poderão ser restauradas depois por esta tela (só pelo suporte).";

// Nits pré-Task 8 (F2): a versão do aviso usada nos TOASTS (depois da ação já ter acontecido) precisa
// estar no PASSADO — "se não marcar agora" ficava estranho quando a chance já passou. O texto do
// diálogo (ANTES da ação, linhas ~169/284) mantém `AVISO_SO_AGORA` como está.
const AVISO_SO_AGORA_TOAST = "As colunas de antes não foram restauradas e não poderão ser restauradas depois por esta tela (só pelo suporte).";

// Minor 4 (fix round 1): `colsDe` rotula a coluna de ORIGEM ("De") e `colsPara` a de DESTINO ("Para"
// e tudo o resto — fixados, REFs reveladas, que são posições ATUAIS/futuras, não "antes"). No caso
// comum (Ligar/Desligar, sem mudança de colunas pendente) os dois boards são o mesmo; só o
// `KanbanSalvarDialog` (colunas renomeadas/reordenadas ainda não salvas) passa `colsDe` diferente —
// senão uma coluna renomeada/excluída no rascunho aparece com a key crua em vez do rótulo antigo.
function PreviaMovimentos({ previa, colsDe, colsPara }: { previa: PreviaRecalculo; colsDe: KanbanStatus[]; colsPara: KanbanStatus[] }) {
  const ordem = colsPara.map((c) => c.key);
  const grupos = agruparMovimentos(previa.cards, ordem);
  const fixados = resumirFixados(previa.cards_fixados, ordem);
  const lblDe = (k: string | null) => labelDaColuna(k, colsDe);
  const lbl = (k: string | null) => labelDaColuna(k, colsPara);
  return (
    <div className="space-y-3">
      {grupos.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="kanban-previa-tabela">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">De</th>
                <th aria-hidden className="w-6" />
                <th className="px-3 py-2 text-left font-medium">Para</th>
                <th className="px-3 py-2 text-right font-medium">Cards</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <Fragment key={`${g.de ?? ""}→${g.para ?? ""}`}>
                  <tr className="border-t">
                    <td className="px-3 py-2">{lblDe(g.de)}</td>
                    <td className="px-1 py-2 text-muted-foreground"><ArrowRight className="h-3.5 w-3.5" /></td>
                    <td className="px-3 py-2">{lbl(g.para)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{g.cards.length}</td>
                    <td className="px-3 py-2 text-right">
                      <StatusBadge tone={g.recua ? "warning" : "success"} className="normal-case tracking-normal">{g.recua ? "voltam" : "avançam"}</StatusBadge>
                    </td>
                  </tr>
                  {g.recua && (
                    <tr className="bg-muted/40">
                      <td colSpan={5} className="px-3 py-2">
                        <ul className="space-y-0.5 text-xs">
                          {g.cards.map((c) => (
                            <li key={c.modelo_id}>
                              {c.nome ?? "Sem nome"} {c.ref && <span className="font-mono text-muted-foreground">{c.ref}</span>}
                              {c.faltando.length > 0 && <span className="text-muted-foreground"> — falta {labelsCondicoes(c.faltando).join(", ")}</span>}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="border-t font-semibold">
                <td colSpan={3} className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{previa.mudam}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {fixados.length > 0 && (
        <div className="flex gap-2 rounded-md bg-[var(--tone-warning-bg)] px-3 py-2 text-sm text-[var(--tone-warning-fg)]">
          <Hand className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">{nCards(previa.fixados)} {previa.fixados === 1 ? "fica onde está" : "ficam onde estão"}</span>, em colunas
            manuais ({fixados.map((f) => `${lbl(f.coluna)} ${f.n}`).join(" · ")}), até alguém tirar.
          </span>
        </div>
      )}
      {previa.refs_reveladas.length > 0 && (
        <div className="space-y-1 rounded-md border px-3 py-2 text-sm" data-testid="kanban-previa-refs">
          <p className="flex items-center gap-1.5 font-medium">
            <Tag className="h-4 w-4" />
            {previa.revelam_ref === 1 ? "1 REF será revelada" : `${previa.revelam_ref} REFs serão reveladas`}
          </p>
          <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs">
            {previa.refs_reveladas.map((r) => (
              <li key={r.modelo_id}>
                {r.nome ?? "Sem nome"} <span className="font-mono text-muted-foreground">{r.ref_auto}</span>
                <span className="text-muted-foreground"> — etapa {lbl(r.posicao_derivada)}</span>
              </li>
            ))}
          </ul>
          {previa.avisos.map((a) => (
            <p key={a} className="text-xs text-[var(--tone-warning-fg)]">{a}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function RestaurarOpcao({ previa, cols, timezone, restaurar, onRestaurar }: {
  previa: PreviaRestauracao; cols: KanbanStatus[]; timezone: string; restaurar: boolean; onRestaurar: (v: boolean) => void;
}) {
  const [verLista, setVerLista] = useState(false);
  const avisos = avisosRestauracaoVisiveis(previa.avisos);
  if (!previa.lote_id) {
    return <p className="text-sm text-muted-foreground">{avisos[0] ?? "Não há colunas guardadas para restaurar."}</p>;
  }
  const primeira = cols[0]?.key ?? null;
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Checkbox id="kanban-restaurar" data-testid="kanban-restaurar-check" checked={restaurar} onCheckedChange={(v) => onRestaurar(!!v)} className="mt-0.5" />
      <div className="min-w-0 space-y-1">
        <label htmlFor="kanban-restaurar" className="cursor-pointer text-sm font-medium">Restaurar as colunas de antes de ligar</label>
        <p className="text-xs text-muted-foreground">
          Guardadas em {formatarDataHora(previa.criado_at, timezone)} · <span className="font-medium text-foreground">{nCards(previa.voltam)}</span>{" "}
          {previa.voltam === 1 ? "voltaria" : "voltariam"} de coluna
          {previa.voltam > 0 && (
            <>
              {" · "}
              <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setVerLista((v) => !v)}>
                {verLista ? "esconder lista" : "ver lista"}
              </button>
            </>
          )}
        </p>
        {avisos.map((a) => (
          <p key={a} className="text-xs text-muted-foreground">{a}</p>
        ))}
        {previa.voltam > 0 && (
          <p className="flex items-center gap-1 text-xs text-[var(--tone-warning-fg)]">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Desfaz também os avanços feitos depois dessa data
            {previa.movidos_depois > 0
              ? ` (${nCards(previa.movidos_depois)} ${previa.movidos_depois === 1 ? "foi movido" : "foram movidos"} à mão depois).`
              : "."}
          </p>
        )}
        {!restaurar && (
          <p className="flex items-center gap-1 text-xs text-[var(--tone-warning-fg)]">
            <AlertTriangle className="h-3 w-3 shrink-0" />{AVISO_SO_AGORA}
          </p>
        )}
        {verLista && (
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs" data-testid="kanban-restaurar-lista">
            {previa.cards.map((c) => (
              <li key={c.modelo_id}>
                {c.nome ?? "Sem nome"} {c.ref && <span className="font-mono text-muted-foreground">{c.ref}</span>}
                <span className="text-muted-foreground">
                  {" "}— {labelDaColuna(c.de ?? primeira, cols)} → {labelDaColuna(c.para ?? primeira, cols)}
                  {c.movido_manual_depois ? " (movido à mão depois)" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KanbanChaveDialog({ modo, cols, timezone, onClose, onMudou, avisoRevenda, onIrParaFluxoRevenda }: {
  modo: "ligar" | "desligar"; cols: KanbanStatus[]; timezone: string; onClose: () => void; onMudou: () => void;
  avisoRevenda?: boolean; onIrParaFluxoRevenda?: () => void;
}) {
  const [restaurar, setRestaurar] = useState(false);
  const prevLigar = useQuery({
    queryKey: ["kanban-previa-ligar"],
    enabled: modo === "ligar",
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false,
    queryFn: () => kanbanPreviaRecalculo({ kanban_automatico: true }),
  });
  const prevDesligar = useQuery({
    queryKey: ["kanban-previa-restauracao"],
    enabled: modo === "desligar",
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false,
    queryFn: () => kanbanPreviaRestauracao(null),
  });
  const ligar = useMutation({
    mutationFn: () => kanbanDefinirAutomatico(true),
    onSuccess: (r) => {
      toast.success(r.mudou
        ? `Kanban automático ligado — ${nCards(r.cards_movidos)} ${r.cards_movidos === 1 ? "mudou" : "mudaram"} de coluna.`
        : "O Kanban automático já estava ligado.");
      onMudou();
      onClose();
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao ligar o Kanban automático.")),
  });
  const desligar = useMutation({
    mutationFn: async () => {
      await kanbanDefinirAutomatico(false);
      const lote = prevDesligar.data?.lote_id ?? null;
      if (!restaurar || !lote) return { restaurados: null as number | null, erroRestaurar: null as string | null };
      try {
        const rr = await kanbanRestaurar(lote);
        return { restaurados: rr.restaurados, erroRestaurar: null };
      } catch (e) {
        return { restaurados: null, erroRestaurar: mensagemErro(e, "Erro ao restaurar as colunas.") };
      }
    },
    onSuccess: (r) => {
      // Important (fix round 1): a chave FOI desligada nos 3 casos (o `kanbanDefinirAutomatico(false)`
      // já rodou antes de tentar restaurar) — a mensagem de erro precisa deixar isso explícito, e não
      // deixar o usuário achar que ainda dá pra restaurar depois por esta tela (decisão 8: só agora).
      // Nit pré-Task 8: o aviso "só agora" só faz sentido quando HAVIA um lote pra restaurar e o
      // usuário optou por não marcar — sem lote nenhum, não há nada a restaurar, então o aviso mentia
      // ("Não há colunas guardadas" também dispararia o aviso antes desta correção).
      const haviaLotePraRestaurar = (prevDesligar.data?.lote_id ?? null) != null;
      if (r.erroRestaurar) toast.error(`O Kanban automático foi desligado, mas as colunas NÃO foram restauradas: ${r.erroRestaurar} ${AVISO_SO_AGORA_TOAST}`);
      else if (r.restaurados != null) toast.success(`Kanban automático desligado. ${nCards(r.restaurados)} ${r.restaurados === 1 ? "voltou" : "voltaram"} às colunas de antes.`);
      else if (haviaLotePraRestaurar) toast.success(`Kanban automático desligado. Os cards ficaram onde estavam. ${AVISO_SO_AGORA_TOAST}`);
      else toast.success("Kanban automático desligado. Os cards ficaram onde estavam.");
      onMudou();
      onClose();
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao desligar o Kanban automático.")),
  });
  const pendente = ligar.isPending || desligar.isPending;
  const q = modo === "ligar" ? prevLigar : prevDesligar;
  const mudam = prevLigar.data?.mudam ?? 0;
  const descricao = modo === "ligar"
    ? prevLigar.data
      ? mudam > 0
        ? `Com os requisitos atuais, ${nCards(mudam)} ${mudam === 1 ? "muda" : "mudam"} de coluna agora. Depois disso, os cards andam sozinhos conforme os campos salvos.`
        : "Com os requisitos atuais, nenhum card muda de coluna agora. Depois disso, os cards andam sozinhos conforme os campos salvos."
      : "Os cards passam a andar sozinhos entre as colunas conforme os campos salvos."
    : "Os cards param onde estão e o kanban volta a funcionar como hoje: mudança de coluna à mão (arraste ou “Status no fluxo”) com a trava de requisitos, e volta automática só em alguns casos (mão de obra reprovada, CQ desmarcado, envio desfeito).";
  const rotulo = modo === "ligar"
    ? mudam > 0 ? `Ligar e mover ${nCards(mudam)}` : "Ligar"
    : restaurar && prevDesligar.data?.lote_id ? "Desligar e restaurar" : "Desligar";
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pendente) onClose(); }}>
      <DialogContent fixedFooter mobileFull className="max-w-2xl" data-testid={`kanban-dialogo-${modo}`}>
        <DialogHeader>
          <DialogTitle>{modo === "ligar" ? "Ligar o kanban automático?" : "Desligar o kanban automático?"}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {q.isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calculando a prévia…</p>
          )}
          {q.isError && modo === "ligar" && (
            <p className="text-sm text-destructive">{mensagemErro(q.error, "Erro ao calcular a prévia.")}</p>
          )}
          {modo === "ligar" && (
            <AvisoRevendaSemRequisitos mostrar={!!avisoRevenda} onIrParaFluxo={onIrParaFluxoRevenda && (() => { onClose(); onIrParaFluxoRevenda(); })} />
          )}
          {modo === "ligar" && prevLigar.data && (
            <>
              <PreviaMovimentos previa={prevLigar.data} colsDe={cols} colsPara={cols} />
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Undo2 className="h-3.5 w-3.5 shrink-0" />As colunas de hoje ficam guardadas: ao desligar, dá para voltar a elas.
              </p>
            </>
          )}
          {modo === "desligar" && prevDesligar.data && (
            <RestaurarOpcao previa={prevDesligar.data} cols={cols} timezone={timezone} restaurar={restaurar} onRestaurar={setRestaurar} />
          )}
          {/* Minor 2 (fix round 1): a prévia de restauração indisponível NÃO deve travar o Desligar —
              só a opção de restaurar. Checkbox desabilitado (nada pra oferecer sem a prévia) + o
              aviso "só agora" (Important), já que sem ela é impossível marcar "Restaurar" mesmo. */}
          {modo === "desligar" && prevDesligar.isError && (
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Checkbox checked={false} disabled className="mt-0.5" aria-label="Restaurar as colunas de antes (indisponível)" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Restaurar as colunas de antes de ligar</p>
                <p className="text-xs text-destructive">{mensagemErro(prevDesligar.error, "Erro ao calcular a prévia de restauração.")}</p>
                <p className="flex items-center gap-1 text-xs text-[var(--tone-warning-fg)]">
                  <AlertTriangle className="h-3 w-3 shrink-0" />{AVISO_SO_AGORA}
                </p>
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter className={RODAPE}>
          <Button variant="outline" onClick={onClose} disabled={pendente}><ArrowLeft className="mr-1 h-4 w-4" />Voltar</Button>
          <Button
            className="ml-auto"
            data-testid="kanban-dialogo-confirmar"
            disabled={pendente || (modo === "ligar" ? !q.isSuccess : !(q.isSuccess || q.isError))}
            onClick={() => (modo === "ligar" ? ligar.mutate() : desligar.mutate())}
          >
            {pendente ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : modo === "ligar" ? <Zap className="mr-1 h-4 w-4" /> : null}
            {rotulo}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Switch "Kanban automático" (topo do card "Status do Kanban" da Config). */
export function KanbanAutomaticoBloco({ ligado, disponivel, travadoMotivo, cols, timezone, onMudou, avisoRevenda, onIrParaFluxoRevenda }: {
  avisoRevenda?: boolean;
  onIrParaFluxoRevenda?: () => void;
  ligado: boolean;
  disponivel: boolean;
  travadoMotivo: string | null;
  cols: KanbanStatus[];
  timezone: string;
  onMudou: () => void;
}) {
  const [dialogo, setDialogo] = useState<null | "ligar" | "desligar">(null);
  return (
    <div data-testid="kanban-auto-bloco" className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <Switch
        data-testid="kanban-auto-switch"
        checked={ligado}
        disabled={!disponivel || !!travadoMotivo}
        onCheckedChange={(v) => setDialogo(v ? "ligar" : "desligar")}
        aria-label="Kanban automático"
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-1">
        {/* div (não <p>): o StatusBadge renderiza <div> — <div> dentro de <p> é HTML inválido (aviso de hidratação). */}
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          <Zap className="h-4 w-4" />Kanban automático
          <StatusBadge tone={ligado ? "info" : "neutral"} className="normal-case tracking-normal">{ligado ? "ligado" : "desligado"}</StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          Ligado, os cards andam sozinhos entre as colunas conforme os campos salvos. Coluna{" "}
          <span className="font-semibold text-foreground">com requisito</span> = automática (em cascata: só entra quem cumpre esta e todas as
          anteriores). Coluna <span className="font-semibold text-foreground">sem requisito</span> = manual: o card entra e sai dela arrastado.
        </p>
        <p className="text-xs text-muted-foreground">
          Desligado: funciona como hoje — o card muda de coluna arrastado ou pelo “Status no fluxo”, com a trava de requisitos, e volta sozinho só
          em alguns casos (mão de obra reprovada, CQ desmarcado, envio desfeito).
        </p>
        {!disponivel && <p className="text-xs text-[var(--tone-warning-fg)]">Ainda não disponível nesta loja — aguarda a atualização do banco.</p>}
        {disponivel && travadoMotivo && <p className="text-xs text-[var(--tone-warning-fg)]">{travadoMotivo}</p>}
      </div>
      {dialogo && (
        <KanbanChaveDialog modo={dialogo} cols={cols} timezone={timezone} onClose={() => setDialogo(null)} onMudou={onMudou}
          avisoRevenda={avisoRevenda} onIrParaFluxoRevenda={onIrParaFluxoRevenda} />
      )}
    </div>
  );
}

/** "Salvar e mover N cards?" — salvar requisitos/ordem com a chave ligada (mockup "Prévia", 3º diálogo). */
export function KanbanSalvarDialog({ previa, colsDe, colsPara, mudancas, salvando, onConfirmar, onClose, avisoRevenda, onIrParaFluxoRevenda }: {
  avisoRevenda?: boolean; onIrParaFluxoRevenda?: () => void;
  previa: PreviaRecalculo;
  // Minor 4 (fix round 1): board de ANTES da edição pendente ("De") e o board ATUAL/rascunho ("Para" +
  // fixados/REFs). Quando idênticos (chamador sem essa distinção), passe o mesmo array nos dois.
  colsDe: KanbanStatus[]; colsPara: KanbanStatus[];
  mudancas: string; salvando: boolean; onConfirmar: () => void; onClose: () => void;
}) {
  const titulo = previa.mudam > 0 ? `Salvar e mover ${nCards(previa.mudam)}?` : "Salvar as alterações do kanban?";
  // Minor 3 (fix round 1): este diálogo só abre com `mudam===0` quando há REF revelada (`prepararSalvar`
  // só o abre se `mudam>0 || revelam_ref>0`) — "os cards abaixo mudam de coluna" ficava incoerente
  // sem nenhum card na tabela de movimentos.
  const descricaoMovimento = previa.mudam > 0
    ? "os cards abaixo mudam de coluna ao salvar."
    : "nenhum card muda de coluna ao salvar.";
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !salvando) onClose(); }}>
      <DialogContent fixedFooter mobileFull className="max-w-2xl" data-testid="kanban-dialogo-salvar">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Você mudou {mudancas}. Com o kanban automático ligado, {descricaoMovimento}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <AvisoRevendaSemRequisitos mostrar={!!avisoRevenda} onIrParaFluxo={onIrParaFluxoRevenda && (() => { onClose(); onIrParaFluxoRevenda(); })} />
          <PreviaMovimentos previa={previa} colsDe={colsDe} colsPara={colsPara} />
        </DialogBody>
        <DialogFooter className={RODAPE}>
          <Button variant="outline" onClick={onClose} disabled={salvando}><ArrowLeft className="mr-1 h-4 w-4" />Voltar</Button>
          <Button className="ml-auto" onClick={onConfirmar} disabled={salvando}>
            {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {previa.mudam > 0 ? `Salvar e mover ${nCards(previa.mudam)}` : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
