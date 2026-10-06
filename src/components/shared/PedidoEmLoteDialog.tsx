import { useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { brl } from "@/lib/format";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  alternarMarca, elegivel, executarPedidosEmSequencia, itensDoPedido, marcadosIniciais, marcarTodos, pedidosTexto,
  resumoDoLote, textoMotivos, textoResumoResultado,
  type ItemPedidoLote, type OcCriada, type ResultadoLote, type ResultadoPedidoItem,
} from "@/lib/pedido-em-lote";

/**
 * [urg R13] Pedido em lote — UM diálogo "Fazer pedido" para o Produto Acabado e o Produto Importado.
 *
 * Aberto por 2 caminhos (quem monta a lista é o Sheet): (1) rodapé = compra total (todos os produtos da subcoleção SEM OC,
 * todos marcados); (2) barra de selecionados (só os escolhidos marcados). Cada produto mostra checkbox, peças e (com permissão
 * de ver custos) o valor do pedido; quem não pode entrar aparece desmarcado e desabilitado com o motivo em PT.
 *
 * Confirmar = AlertDialog (gera compra). Depois, para cada produto marcado EM SEQUÊNCIA, `criar(item)` — que o Sheet monta com
 * as MESMAS funções do "Fazer pedido" do card (salvar o produto sujo + `criarOc…`). A falha de um produto NÃO para os outros;
 * ao fim, o resultado fica NESTE diálogo ("X pedidos criados · Y falharam" + motivo de cada falha). Não navega para a OC.
 *
 * Monte só quando aberto (`{payload && <PedidoEmLoteDialog …/>}`): o estado nasce limpo a cada abertura.
 */
export type PedidoEmLoteDialogProps = {
  /** Produto Acabado ou Importado — só muda o texto (a regra vem pronta nos `itens`). */
  familia: "acabado" | "importado";
  /** De onde veio: rodapé (compra total da subcoleção) ou barra de selecionados. */
  origem: "rodape" | "selecionados";
  /** Nome da subcoleção (subtítulo) — opcional. */
  contexto?: string | null;
  /** Linhas do diálogo, já avaliadas (`itemPedidoAcabado`/`itemPedidoImportado`): `motivos` vazio = elegível. */
  itens: ItemPedidoLote[];
  /** Rodapé: quantos produtos da subcoleção já têm OC (não entram na lista; só aparece como aviso). */
  jaTemOc?: number;
  /** Permissão de ver custos — `false` = sem R$ em lugar nenhum. */
  mostrarValor: boolean;
  /** Cria o pedido de UM produto (salva se sujo + cria a OC). Lança em caso de erro — o lote segue com os demais. */
  criar: (item: { id: string; nome: string }) => Promise<OcCriada>;
  /** Fecha o diálogo (só chamado fora da criação). */
  onFechar: () => void;
  /** Depois do ÚLTIMO pedido (com ou sem falhas) — o Sheet invalida as queries, limpa a seleção e mostra o toast. */
  onConcluido: (r: ResultadoLote) => void;
};

type Fase = "revisao" | "executando" | "resultado";

export function PedidoEmLoteDialog({
  familia, origem, contexto, itens, jaTemOc = 0, mostrarValor, criar, onFechar, onConcluido,
}: PedidoEmLoteDialogProps) {
  const [marcados, setMarcados] = useState<Set<string>>(() => marcadosIniciais(itens));
  const [fase, setFase] = useState<Fase>("revisao");
  const [confirmando, setConfirmando] = useState(false);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number; atual: string | null }>({ feitos: 0, total: 0, atual: null });
  const [feitos, setFeitos] = useState<ResultadoPedidoItem[]>([]);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  // Guarda SÍNCRONA contra 2 cliques em "Criar" antes do re-render (o `disabled` do botão é assíncrono).
  const rodandoRef = useRef(false);

  const elegiveis = useMemo(() => itens.filter(elegivel), [itens]);
  const fora = useMemo(() => itens.filter((i) => !elegivel(i)), [itens]);
  const resumo = useMemo(() => resumoDoLote(itens, marcados, mostrarValor), [itens, marcados, mostrarValor]);
  const todosMarcados = elegiveis.length > 0 && elegiveis.every((i) => marcados.has(i.id));
  const algumMarcado = marcados.size > 0;
  const bloqueado = fase !== "revisao";

  const titulo = origem === "rodape" ? "Fazer pedido" : `Fazer pedido dos ${itens.length} selecionado${itens.length === 1 ? "" : "s"}`;
  const subject = familia === "acabado" ? "Produto Acabado" : "Produto Importado";

  async function rodar() {
    if (rodandoRef.current) return;
    const sel = itensDoPedido(itens, marcados);
    if (sel.length === 0) return;
    rodandoRef.current = true;
    setConfirmando(false);
    setFase("executando");
    setFeitos([]);
    setProgresso({ feitos: 0, total: sel.length, atual: sel[0]?.nome ?? null });
    try {
      const r = await executarPedidosEmSequencia(
        sel.map((i) => ({ id: i.id, nome: i.nome })),
        criar,
        {
          mensagemDoErro: (e) => mensagemErro(e, "Falha ao criar o pedido."),
          onProgresso: (f, total, atual) => setProgresso({ feitos: f, total, atual: atual.nome }),
          onResultado: (res) => setFeitos((l) => [...l, res]),
        },
      );
      setResultado(r);
      setFase("resultado");
      onConcluido(r);
    } finally {
      rodandoRef.current = false;
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o && fase !== "executando") onFechar(); }}>
        <DialogContent fixedFooter mobileFull className="max-w-2xl" data-testid="pedido-lote-dialogo"
          // Criando: nem Esc nem clique fora fecham (o laço está rodando; fechar não pararia nada e esconderia o resultado).
          onEscapeKeyDown={(e) => { if (fase === "executando") e.preventDefault(); }}
          onPointerDownOutside={(e) => { if (fase === "executando") e.preventDefault(); }}
          onInteractOutside={(e) => { if (fase === "executando") e.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" /> {titulo}</DialogTitle>
            <DialogDescription>
              {fase === "resultado"
                ? "O resultado de cada produto está abaixo. Você continua nesta tela — os cards já mostram a OC."
                : `${subject}${contexto ? ` · ${contexto}` : ""} — cria uma OC por produto marcado. O produto com alteração não salva é salvo antes; você continua nesta tela.`}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
            {fase === "revisao" && (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="pedido-lote-resumo">
                  <span><b>{pedidosTexto(resumo.pedidos)}</b></span>
                  <span className="text-muted-foreground">{resumo.pecas} pç</span>
                  {resumo.total != null && <span className="ml-auto font-semibold tabular-nums">{brl(resumo.total)}</span>}
                </div>

                {origem === "rodape" && jaTemOc > 0 && (
                  <p className="text-xs text-muted-foreground">{jaTemOc} produto{jaTemOc === 1 ? "" : "s"} desta subcoleção já {jaTemOc === 1 ? "tem" : "têm"} OC e não {jaTemOc === 1 ? "entra" : "entram"} aqui.</p>
                )}

                {itens.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="pedido-lote-vazio">
                    {origem === "rodape" ? "Todos os produtos desta subcoleção já têm OC vinculada." : "Nenhum produto para pedir."}
                  </p>
                ) : (
                  <>
                    {elegiveis.length > 0 && (
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={todosMarcados ? true : algumMarcado ? "indeterminate" : false}
                          onCheckedChange={() => setMarcados(marcarTodos(itens, !todosMarcados))}
                          aria-label="Marcar todos os produtos que podem ser pedidos"
                          className="max-md:h-6 max-md:w-6"
                        />
                        <span>Marcar todos <span className="text-muted-foreground">({marcados.size} de {elegiveis.length})</span></span>
                      </label>
                    )}

                    <ul className="space-y-1.5" data-testid="pedido-lote-lista">
                      {elegiveis.map((i) => (
                        <LinhaPedido key={i.id} item={i} marcado={marcados.has(i.id)} mostrarValor={mostrarValor}
                          onToggle={() => setMarcados((m) => alternarMarca(itens, m, i.id))} />
                      ))}
                    </ul>

                    {fora.length > 0 && (
                      <div className="space-y-1.5" data-testid="pedido-lote-fora">
                        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ficam de fora ({fora.length})</p>
                        <ul className="space-y-1.5">
                          {fora.map((i) => (
                            <LinhaPedido key={i.id} item={i} marcado={false} mostrarValor={mostrarValor} onToggle={() => {}} />
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {fase === "executando" && (
              <div className="space-y-3" role="status" aria-live="polite" data-testid="pedido-lote-progresso">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Criando pedido {Math.min(progresso.feitos + 1, progresso.total)} de {progresso.total}{progresso.atual ? ` — ${progresso.atual}` : ""}…
                </p>
                <p className="text-xs text-muted-foreground">Não feche esta janela até terminar.</p>
                <ListaResultado itens={feitos} />
              </div>
            )}

            {fase === "resultado" && resultado && (
              <div className="space-y-3" data-testid="pedido-lote-resultado">
                <p className="flex items-center gap-2 text-sm font-semibold" role="status">
                  {resultado.falhas === 0
                    ? <CheckCircle2 className="h-4 w-4 text-[var(--tone-success-fg)]" />
                    : <AlertCircle className="h-4 w-4 text-[var(--tone-warning-fg)]" />}
                  {textoResumoResultado(resultado)}
                </p>
                <ListaResultado itens={resultado.itens} />
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            {fase === "resultado" ? (
              <Button className="ml-auto max-sm:h-11" onClick={onFechar}>Fechar</Button>
            ) : (
              <>
                <Button variant="outline" className="max-sm:h-11" disabled={bloqueado} onClick={onFechar}>Cancelar</Button>
                <Button
                  className="ml-auto max-sm:h-11"
                  disabled={bloqueado || resumo.pedidos === 0}
                  onClick={() => setConfirmando(true)}
                >
                  {fase === "executando" ? "Criando…" : resumo.pedidos === 0 ? "Criar pedidos" : `Criar ${pedidosTexto(resumo.pedidos)}`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ação sensível (gera compra): AlertDialog com o resumo. Cancelar/Esc/clique fora NUNCA criam nada. */}
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent data-testid="pedido-lote-confirmar">
          <AlertDialogHeader>
            <AlertDialogTitle>Criar {pedidosTexto(resumo.pedidos)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai gerar {pedidosTexto(resumo.pedidos)} de compra ({resumo.pedidos === 1 ? "uma OC" : "uma OC por produto"}),
              {" "}{resumo.pecas} pç{resumo.total != null ? <> no valor de <b>{brl(resumo.total)}</b></> : null}.
              {" "}Cada OC fica vinculada ao produto; para desfazer, exclua a OC na tela da OC.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void rodar(); }}>
              Criar {pedidosTexto(resumo.pedidos)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LinhaPedido({ item, marcado, mostrarValor, onToggle }: {
  item: ItemPedidoLote; marcado: boolean; mostrarValor: boolean; onToggle: () => void;
}) {
  const ok = elegivel(item);
  return (
    <li className={`rounded-md border px-3 py-2 ${ok ? "" : "bg-muted/30"}`} data-testid={`pedido-lote-item-${item.id}`} data-elegivel={ok ? "sim" : "nao"}>
      <label className={`flex items-start gap-2 ${ok ? "cursor-pointer" : "cursor-not-allowed opacity-80"}`}>
        <Checkbox
          checked={marcado}
          disabled={!ok}
          onCheckedChange={onToggle}
          aria-label={`Pedir ${item.nome}`}
          className="mt-0.5 shrink-0 max-md:h-6 max-md:w-6"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0 truncate text-sm font-medium">{item.nome}</span>
            {item.ref && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.ref}</span>}
          </span>
          {!ok && <span className="mt-0.5 block text-xs text-[var(--tone-warning-fg)]" data-testid={`pedido-lote-motivo-${item.id}`}>{textoMotivos(item.motivos)}</span>}
        </span>
        <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          <span className="block">{item.pecas} pç</span>
          {mostrarValor && item.valor != null && <span className="block font-medium text-foreground">{brl(item.valor)}</span>}
        </span>
      </label>
    </li>
  );
}

function ListaResultado({ itens }: { itens: ResultadoPedidoItem[] }) {
  if (itens.length === 0) return null;
  return (
    <ul className="space-y-1.5" data-testid="pedido-lote-resultado-lista">
      {itens.map((r) => (
        <li key={r.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm" data-resultado={r.ok ? "ok" : "falha"}>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{r.nome}</span>
            {r.ok
              ? <span className="block text-xs text-muted-foreground">{r.ocNumero ? `OC ${r.ocNumero} criada.` : "OC criada."}</span>
              : <span className="block text-xs text-[var(--tone-danger-fg)]">{r.erro}</span>}
          </span>
          <StatusBadge tone={r.ok ? "success" : "danger"} className="shrink-0">{r.ok ? "Criado" : "Falhou"}</StatusBadge>
        </li>
      ))}
    </ul>
  );
}
