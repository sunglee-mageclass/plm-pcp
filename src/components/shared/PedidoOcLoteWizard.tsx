import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Lock, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DateField } from "@/components/shared/DateField";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { brl, fmtInt, fmtPct } from "@/lib/format";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  agruparPorFornecedor, alternarProdutoNaOc, aplicarCabecalhoATodas, avancarHerdando, chavesCacheDoPedido, criarPedidosDoLote, errosDoLote,
  numeroPrevia, SalvarProdutoError, ocEntra, pedidosTexto, previewSiglaOcLote, produtosASalvar, produtosDaOc, produtosTexto,
  respostasIniciais, textoMotivos, textoOcsCriadas, textoParcelas, totalDoProduto, totaisDaOc, totaisDoLote,
  type FamiliaPedido, type GrupoFornecedor, type OcCriadaLote, type PedidoOc, type ProdutoPedido, type RespostaOc,
  type CabecalhoOc, type ContextoPedido, type ProdutoBloqueado,
} from "@/lib/pedido-oc-lote";

/**
 * [urg R13] Assistente "Fazer pedido" — UMA OC por fornecedor com VÁRIOS produtos (Produto Acabado e Produto Importado).
 *
 * Mesmo modelo do `FazerPedidoWizard` do Plan. Tecido: passo 0 = prévia por fornecedor (contagens, produtos com checkbox, nº que
 * será gerado, aviso de OC encomendada do mesmo fornecedor, "Sem fornecedor" e "Não entram" com o motivo); depois 1 página por
 * OC (incluir/excluir a OC, cabeçalho com herança e "aplicar a todas", tabela de produtos); no fim, AlertDialog "Criar N
 * pedidos?" → salva os produtos com edição pendente (`onSalvarProduto`, como o card) → UMA chamada (`onCriar` = `fazer_pedido_*`,
 * tudo ou nada) → resultado com "Abrir OC".
 *
 * A família entra por ADAPTADOR (props): quem monta `produtos` (rascunhos vivos do canvas), `onCriar` e `onSalvarProduto` é o
 * Sheet de cada família. Sem permissão de ver custos (`mostrarValor=false`) não há R$ em lugar nenhum.
 *
 * Monte só quando aberto (`{aberto && <PedidoOcLoteWizard …/>}`): a lista é "congelada" na abertura, o estado nasce limpo.
 */
export type PedidoOcLoteWizardProps = {
  familia: FamiliaPedido;
  /** De onde veio: rodapé (compra total da subcoleção), barra de selecionados ou o "Fazer pedido" de um card (1 produto, P-363). */
  origem: "rodape" | "selecionados" | "card";
  /** Nome da subcoleção (subtítulo) — opcional. */
  contexto?: string | null;
  /** Produtos candidatos (já filtrados pela origem), com o rascunho VIVO do canvas. */
  produtos: ProdutoPedido[];
  /** Há conflito de edição pendente em qualquer produto do canvas (mesma trava do botão do card). */
  conflitoPendente?: boolean;
  /** Rodapé: quantos produtos da subcoleção já têm OC (só aparece como aviso). */
  jaTemOc?: number;
  /** Permissão de ver custos — `false` = sem R$ em lugar nenhum. */
  mostrarValor: boolean;
  /** OCs ENCOMENDADAS (select leve do Sheet) — só para o aviso "já tem a OC X encomendada". */
  ocsEncomendadas?: ReadonlyArray<{ id: string; numero: string; empresaId: string }>;
  /** Data de hoje ISO (fuso da loja). Ausente = data local do navegador. */
  hoje?: string;
  /** `fazer_pedido_*(_pedidos)`: cria TODAS as OCs numa transação. Lança em caso de erro (nada é criado). */
  onCriar: (pedidos: PedidoOc[]) => Promise<OcCriadaLote[]>;
  /** Salva um produto com edição pendente (mesma função do "Fazer pedido" do card). Lança em caso de erro. */
  onSalvarProduto: (produto: ProdutoPedido) => Promise<unknown>;
  /** "Abrir OC" do resultado. Ausente = o botão não aparece. */
  onAbrirOc?: (ocId: string) => void;
  /** Depois de criar (OCs criadas): o Sheet tira os produtos da seleção. O cache já é invalidado aqui. */
  onConcluido?: (criadas: OcCriadaLote[]) => void;
  onFechar: () => void;
};

type Passo = number | "res";

const hojeLocal = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function PedidoOcLoteWizard({
  familia, origem, contexto, produtos, conflitoPendente = false, jaTemOc = 0, mostrarValor, ocsEncomendadas = [],
  hoje, onCriar, onSalvarProduto, onAbrirOc, onConcluido, onFechar,
}: PedidoOcLoteWizardProps) {
  const qc = useQueryClient();
  // Congelado na abertura: a prévia, as páginas e as respostas andam juntas (se o canvas mudar por baixo, nada desalinha).
  const [agrup] = useState(() => agruparPorFornecedor(produtos, familia, { conflitoPendente } satisfies ContextoPedido));
  const { grupos, semFornecedor, bloqueados } = agrup;
  const nomePorId = useMemo(() => new Map(produtos.map((p) => [p.id, p.nome])), [produtos]);

  const [passo, setPasso] = useState<Passo>(0);
  const [respostas, setRespostas] = useState<RespostaOc[]>(() => respostasIniciais(grupos, hoje ?? hojeLocal()));
  const [mostrarErros, setMostrarErros] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [criadas, setCriadas] = useState<OcCriadaLote[]>([]);
  const rodandoRef = useRef(false); // guarda SÍNCRONA contra 2 cliques em "Criar" antes do re-render
  const salvosRef = useRef<Set<string>>(new Set()); // produtos já salvos (uma falha na criação não os salva de novo)

  const n = grupos.length;
  const totais = useMemo(() => totaisDoLote(grupos, respostas, familia, mostrarValor), [grupos, respostas, familia, mostrarValor]);
  const erros = useMemo(() => errosDoLote(grupos, respostas), [grupos, respostas]);
  const sujos = useMemo(() => produtosASalvar(grupos, respostas), [grupos, respostas]);
  const bloqueado = criando || passo === "res";
  const indice = typeof passo === "number" && passo > 0 ? passo - 1 : -1; // OC da página atual
  const g = indice >= 0 ? grupos[indice] : null;
  const r = indice >= 0 ? respostas[indice] : null;

  const setResposta = (i: number, patch: Partial<RespostaOc>) =>
    setRespostas((prev) => prev.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const setCabecalho = (i: number, patch: Partial<CabecalhoOc>) =>
    setRespostas((prev) => prev.map((x, k) => (k === i ? { ...x, cabecalho: { ...x.cabecalho, ...patch } } : x)));

  const proxima = () => {
    if (typeof passo !== "number" || passo >= n) return;
    // "Próxima" herda o que está vazio na página seguinte (a página 1 herda do passo 0 = nada).
    if (passo >= 1) setRespostas((prev) => avancarHerdando(prev, passo - 1));
    setPasso(passo + 1);
  };
  const anterior = () => { if (typeof passo === "number" && passo > 0) setPasso(passo - 1); };

  const aplicarATodas = () => {
    if (indice < 0) return;
    setRespostas((prev) => aplicarCabecalhoATodas(prev, indice));
    toast.success("Cabeçalho aplicado a todas as OCs.");
  };

  // Clicou em "Criar": confere o que falta (Data prevista) ANTES de perguntar; leva à 1ª OC com problema.
  const pedirConfirmacao = () => {
    if (erros.length > 0) {
      setMostrarErros(true);
      setPasso(erros[0].indice + 1);
      toast.error(`${erros[0].mensagem} (OC ${erros[0].indice + 1}).`);
      return;
    }
    setConfirmando(true);
  };

  async function criar() {
    if (rodandoRef.current) return;
    rodandoRef.current = true;
    setConfirmando(false);
    setCriando(true);
    try {
      // salva os produtos com edição pendente (como o card) e cria TUDO numa chamada; falhou um dos dois = nada é criado.
      let res: OcCriadaLote[];
      try {
        res = await criarPedidosDoLote({ grupos, respostas, familia, jaSalvos: salvosRef.current, onSalvarProduto, onCriar });
      } catch (e) {
        if (e instanceof SalvarProdutoError) toast.error(`${e.produto.nome}: ${mensagemErro(e.causa, "não foi possível salvar o produto antes do pedido.")}`);
        else toast.error(mensagemErro(e, "Não foi possível criar os pedidos."));
        return;
      }
      setCriadas(res);
      setPasso("res");
      for (const chave of chavesCacheDoPedido(familia)) qc.invalidateQueries({ queryKey: [...chave] });
      toast.success(textoOcsCriadas(res.length) + ".");
      onConcluido?.(res);
    } finally {
      rodandoRef.current = false;
      setCriando(false);
    }
  }

  const titulo = passo === "res"
    ? textoOcsCriadas(criadas.length)
    : passo === 0
      ? (origem === "selecionados" ? `Fazer pedido dos ${produtos.length} selecionado${produtos.length === 1 ? "" : "s"} — prévia` : "Fazer pedido — prévia por fornecedor")
      : `Fazer pedido — OC ${passo} de ${n}`;
  const assunto = familia === "acabado" ? "Produto Acabado" : "Produto Importado";
  const descricao = passo === "res"
    ? "Cada produto ficou vinculado à sua OC. Você continua nesta tela."
    : passo === 0
      ? (n > 0 ? `${assunto}${contexto ? ` · ${contexto}` : ""} — ${n} fornecedor${n === 1 ? "" : "es"} → ${n} OC${n === 1 ? "" : "s"}` : "Nada a pedir")
      : `Fornecedor: ${g?.fornecedorNome ?? ""} · ${produtosTexto(g ? produtosDaOc(g, r!).length : 0)}`;

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o && !criando) onFechar(); }}>
        <DialogContent fixedFooter mobileFull className="max-w-3xl" data-testid="pedido-oc-lote"
          onEscapeKeyDown={(e) => { if (criando) e.preventDefault(); }}
          onPointerDownOutside={(e) => { if (criando) e.preventDefault(); }}
          onInteractOutside={(e) => { if (criando) e.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" /> {titulo}</DialogTitle>
            <DialogDescription>{descricao}</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
            {passo === 0 && (
              <Previa
                familia={familia} origem={origem} grupos={grupos} respostas={respostas} semFornecedor={semFornecedor}
                bloqueados={bloqueados} totais={totais} mostrarValor={mostrarValor} jaTemOc={jaTemOc} sujos={sujos}
                ocsEncomendadas={ocsEncomendadas} nTotal={produtos.length}
                onAlternarOc={(i, v) => setResposta(i, { incluida: v })}
                onAlternarProduto={(i, id) => setRespostas((prev) => alternarProdutoNaOc(prev, i, id))}
              />
            )}

            {g && r && indice >= 0 && (
              <PaginaOc
                familia={familia} grupo={g} resposta={r} mostrarValor={mostrarValor} mostrarErros={mostrarErros}
                onIncluida={(v) => setResposta(indice, { incluida: v })}
                onCabecalho={(patch) => setCabecalho(indice, patch)}
                onProduto={(id) => setRespostas((prev) => alternarProdutoNaOc(prev, indice, id))}
                onAplicarATodas={aplicarATodas} nOcs={n}
              />
            )}

            {passo === "res" && (
              <Resultado criadas={criadas} nomePorId={nomePorId} onAbrirOc={onAbrirOc} />
            )}
          </DialogBody>

          <DialogFooter>
            {passo === "res" ? (
              <Button className="ml-auto max-sm:h-11" onClick={onFechar}>Concluir</Button>
            ) : (
              <>
                <Button variant="ghost" className="max-sm:h-11" disabled={passo === 0 || bloqueado} onClick={anterior}>Anterior</Button>
                {typeof passo === "number" && passo < n && (
                  <Button variant="outline" className="max-sm:h-11" disabled={bloqueado} onClick={proxima}>
                    {passo === 0 ? "Próxima: OC 1" : "Próxima"}
                  </Button>
                )}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {n > 0 ? `${typeof passo === "number" ? passo : 0}/${n} · ${totais.ocs} incluída${totais.ocs === 1 ? "" : "s"}${totais.total != null && totais.total > 0 ? ` · Σ ${brl(totais.total)}` : ""}` : ""}
                </span>
                <Button className="max-sm:h-11" disabled={bloqueado || totais.ocs === 0} onClick={pedirConfirmacao}>
                  {criando ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Criando…</> : totais.ocs === 0 ? "Criar pedidos" : `Criar ${pedidosTexto(totais.ocs)}`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ação sensível (gera compra): AlertDialog com o resumo. Cancelar/Esc/clique fora NUNCA criam nada. */}
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent data-testid="pedido-oc-lote-confirmar">
          <AlertDialogHeader>
            <AlertDialogTitle>Criar {pedidosTexto(totais.ocs)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Serão criadas {totais.ocs} OC{totais.ocs === 1 ? "" : "s"} de {assunto} com {produtosTexto(totais.produtos)}, {fmtInt(totais.pecas)} peças
              {totais.total != null ? <> e total de <b>{brl(totais.total)}</b></> : null}.
              {" "}Cada produto fica vinculado à sua OC e deixa de aparecer como &ldquo;sem OC&rdquo;.
              {sujos.length > 0 ? ` ${sujos.length === 1 ? "1 produto com alteração não salva será salvo" : `${sujos.length} produtos com alteração não salva serão salvos`} antes.` : ""}
              {semFornecedor.length + bloqueados.length > 0 ? ` ${semFornecedor.length} sem fornecedor e ${bloqueados.length} que não entram ficam de fora.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void criar(); }}>Criar {pedidosTexto(totais.ocs)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Passo 0: prévia por fornecedor ───────────────────────────────────────────────────────────────────────────────

function Previa({
  familia, origem, grupos, respostas, semFornecedor, bloqueados, totais, mostrarValor, jaTemOc, sujos, ocsEncomendadas, nTotal,
  onAlternarOc, onAlternarProduto,
}: {
  familia: FamiliaPedido; origem: "rodape" | "selecionados" | "card"; grupos: GrupoFornecedor[]; respostas: RespostaOc[];
  semFornecedor: ProdutoPedido[]; bloqueados: ProdutoBloqueado[];
  totais: ReturnType<typeof totaisDoLote>; mostrarValor: boolean; jaTemOc: number; sujos: ProdutoPedido[];
  ocsEncomendadas: ReadonlyArray<{ id: string; numero: string; empresaId: string }>; nTotal: number;
  onAlternarOc: (i: number, v: boolean) => void; onAlternarProduto: (i: number, id: string) => void;
}) {
  return (
    <>
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="pedido-oc-lote-intro">
        {origem === "rodape" ? `Compra total da subcoleção: ${produtosTexto(nTotal)} sem OC.` : origem === "card" ? "Pedido de 1 produto." : `${produtosTexto(nTotal)} selecionado${nTotal === 1 ? "" : "s"}.`}
        {" "}Um pedido (OC) por fornecedor{familia === "importado" ? " e moeda" : ""}, com vários produtos.
        {!mostrarValor && <b> Seu perfil não vê custos: os valores em R$ ficam ocultos; o pedido usa os valores dos cards normalmente.</b>}
      </div>

      {origem === "rodape" && jaTemOc > 0 && (
        <p className="text-xs text-muted-foreground">{jaTemOc} produto{jaTemOc === 1 ? "" : "s"} desta subcoleção já {jaTemOc === 1 ? "tem" : "têm"} OC e não {jaTemOc === 1 ? "entra" : "entram"} aqui.</p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="pedido-oc-lote-resumo">
        <Contagem rotulo="OCs a criar" valor={String(totais.ocs)} />
        <Contagem rotulo="Produtos" valor={String(totais.produtos)} />
        <Contagem rotulo="Peças" valor={fmtInt(totais.pecas)} />
        {totais.total != null && <Contagem rotulo="Total" valor={brl(totais.total)} destaque />}
      </div>

      {sujos.length > 0 && (
        <div className="rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] px-3 py-2 text-xs text-[var(--tone-warning-fg)]" data-testid="pedido-oc-lote-sujos">
          <b>{sujos.map((p) => p.nome).join(", ")}</b> {sujos.length === 1 ? "tem" : "têm"} alterações não salvas — {sujos.length === 1 ? "ela é salva" : "elas são salvas"} antes de criar o pedido (igual ao &ldquo;Fazer pedido&rdquo; do card).
        </div>
      )}

      {grupos.length === 0 && (
        <div className="rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] px-3 py-2 text-sm text-[var(--tone-warning-fg)]" data-testid="pedido-oc-lote-vazio">
          Nenhum produto elegível para pedido.
        </div>
      )}

      {grupos.map((g, i) => {
        const resp = respostas[i];
        const t = totaisDaOc(g, resp, familia, mostrarValor);
        const sigla = previewSiglaOcLote(g.empresaNome, produtosDaOc(g, resp).length > 0 ? produtosDaOc(g, resp) : g.produtos);
        const enc = ocsEncomendadas.filter((o) => o.empresaId === g.empresaId);
        return (
          <section key={g.chave} className={`rounded-md border ${resp.incluida ? "" : "opacity-60"}`} data-testid={`pedido-oc-lote-grupo-${i}`}>
            <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
              <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm font-semibold">
                <Checkbox checked={resp.incluida} onCheckedChange={(v) => onAlternarOc(i, v === true)} aria-label={`Incluir a OC de ${g.fornecedorNome}`} className="max-md:h-6 max-md:w-6" />
                <span className="truncate">{g.fornecedorNome}</span>
              </label>
              <div className="ml-auto flex flex-wrap gap-1">
                <StatusBadge tone="neutral">{produtosTexto(t.produtos)}</StatusBadge>
                <StatusBadge tone="neutral">{fmtInt(t.pecas)} peças</StatusBadge>
                {t.total != null && <StatusBadge tone="info">{brl(t.total)}</StatusBadge>}
              </div>
            </div>
            <ul className="space-y-1 px-3 py-2">
              {g.produtos.map((p) => {
                const dentro = !resp.produtosForaIds.has(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={dentro} onCheckedChange={() => onAlternarProduto(i, p.id)} aria-label={`Incluir ${p.nome}`} className="max-md:h-6 max-md:w-6" />
                    <span className={`min-w-0 flex-1 truncate ${dentro ? "" : "text-muted-foreground line-through"}`}>
                      {p.nome}{p.ref ? <span className="ml-2 font-mono text-xs text-muted-foreground">{p.ref}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fmtInt(p.pecas)} pç{mostrarValor ? ` · ${brl(totalDoProduto(p, familia))}` : ""}
                    </span>
                  </li>
                );
              })}
              <li className="pt-1 text-xs text-muted-foreground">Nº gerado ao criar: {numeroPrevia(sigla)}</li>
              {enc.length > 0 && (
                <li className="text-xs text-[var(--tone-warning-fg)]" data-testid={`pedido-oc-lote-encomendada-${i}`}>
                  {g.fornecedorNome} já tem a OC {enc.map((o) => o.numero).join(", ")} encomendada — este pedido cria uma OC nova.
                </li>
              )}
            </ul>
          </section>
        );
      })}

      {semFornecedor.length > 0 && (
        <div className="rounded-md border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] px-3 py-2 text-xs text-[var(--tone-warning-fg)]" data-testid="pedido-oc-lote-sem-fornecedor">
          <b>Sem fornecedor (não geram OC):</b> {semFornecedor.map((p) => p.nome).join(", ")} — escolha o fornecedor no card do produto.
        </div>
      )}

      {bloqueados.length > 0 && (
        <div className="space-y-1.5" data-testid="pedido-oc-lote-fora">
          <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Não entram no pedido ({bloqueados.length})</p>
          <ul className="space-y-1.5">
            {bloqueados.map(({ produto, motivos }) => (
              <li key={produto.id} className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm" data-testid={`pedido-oc-lote-fora-${produto.id}`}>
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{produto.nome}{produto.ref ? <span className="ml-2 font-mono text-xs text-muted-foreground">{produto.ref}</span> : null}</span>
                  <span className="block text-xs text-[var(--tone-warning-fg)]">{textoMotivos(motivos)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Contagem({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${destaque ? "bg-muted/40" : ""}`}>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="text-base font-semibold tabular-nums">{valor}</div>
    </div>
  );
}

// ── Páginas 1..N: uma OC por página ──────────────────────────────────────────────────────────────────────────────

function PaginaOc({
  familia, grupo, resposta, mostrarValor, mostrarErros, nOcs, onIncluida, onCabecalho, onProduto, onAplicarATodas,
}: {
  familia: FamiliaPedido; grupo: GrupoFornecedor; resposta: RespostaOc; mostrarValor: boolean; mostrarErros: boolean; nOcs: number;
  onIncluida: (v: boolean) => void; onCabecalho: (patch: Partial<CabecalhoOc>) => void; onProduto: (id: string) => void; onAplicarATodas: () => void;
}) {
  const dentro = produtosDaOc(grupo, resposta);
  const sigla = previewSiglaOcLote(grupo.empresaNome, dentro.length > 0 ? dentro : grupo.produtos);
  const totais = totaisDaOc(grupo, resposta, familia, mostrarValor);
  const c = resposta.cabecalho;
  const semData = mostrarErros && ocEntra(grupo, resposta) && !c.dataPrevista;
  return (
    <div className={`space-y-3 ${resposta.incluida ? "" : "opacity-55"}`} data-testid="pedido-oc-lote-pagina">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox checked={resposta.incluida} onCheckedChange={(v) => onIncluida(v === true)} aria-label="Incluir esta OC no pedido" className="max-md:h-6 max-md:w-6" />
          incluir esta OC no pedido
        </label>
        {nOcs > 1 && (
          <button type="button" onClick={onAplicarATodas} className="ml-auto text-xs font-medium text-primary hover:underline"
            title="Copia as datas e o prazo desta página para todas as OCs">
            aplicar este cabeçalho a todas
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Campo rotulo="Nº do pedido"><div className="flex h-9 items-center rounded border bg-muted/40 px-2 text-sm text-muted-foreground max-md:h-11">Automático — {numeroPrevia(sigla)}</div></Campo>
        <Campo rotulo="Fornecedor"><div className="flex h-9 items-center rounded border bg-muted/40 px-2 text-sm max-md:h-11">{grupo.fornecedorNome}</div></Campo>
        <Campo rotulo="Data do pedido">
          <DateField value={c.dataPedido} onChange={(e) => onCabecalho({ dataPedido: e.target.value })} />
        </Campo>
        <Campo rotulo="Data prevista de entrega *">
          <DateField value={c.dataPrevista} onChange={(e) => onCabecalho({ dataPrevista: e.target.value })} />
          {semData && <p className="mt-0.5 text-xs text-destructive" role="alert" data-testid="pedido-oc-lote-erro-data">Preencha a data de entrega</p>}
        </Campo>
        <Campo rotulo="Prazo de pagamento (ex.: 30/60/90)">
          <Input value={c.prazo} onChange={(e) => onCabecalho({ prazo: e.target.value })} placeholder="30/60/90" className="max-md:h-11 max-md:text-base" />
        </Campo>
        <Campo rotulo="Parcelas a pagar (derivado)">
          <div className="flex h-9 items-center rounded border bg-muted/40 px-2 text-sm max-md:h-11" data-testid="pedido-oc-lote-parcelas">{textoParcelas(c.prazo)}</div>
        </Campo>
      </div>

      {familia === "importado" && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" data-testid="pedido-oc-lote-moeda">
          Moeda de compra: <b className="text-foreground">{grupo.moedaCompra || "—"}</b>
          {grupo.moedaIntermediaria ? <> · intermediária: <b className="text-foreground">{grupo.moedaIntermediaria}</b></> : null}
          {" "}— cotações e etapas vêm do 1º produto da OC; edite na OC depois de criada.
        </div>
      )}

      <div className="overflow-x-auto rounded border">
        <table className="w-full min-w-[34rem] text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="w-8 p-1.5" aria-label="Incluir" />
              <th className="p-1.5 text-left">Produto</th>
              <th className="p-1.5 text-left">Cores</th>
              <th className="p-1.5 text-right">Peças</th>
              <th className="p-1.5 text-right">V. unit.</th>
              <th className="p-1.5 text-right">Desc.</th>
              <th className="p-1.5 text-right">Total c/ desc.</th>
            </tr>
          </thead>
          <tbody>
            {grupo.produtos.map((p) => {
              const marcado = !resposta.produtosForaIds.has(p.id);
              return (
                <tr key={p.id} className={`border-t ${marcado ? "" : "text-muted-foreground line-through"}`}>
                  <td className="p-1.5"><Checkbox checked={marcado} onCheckedChange={() => onProduto(p.id)} aria-label={`Incluir ${p.nome}`} className="max-md:h-6 max-md:w-6" /></td>
                  <td className="p-1.5"><b>{p.nome}</b>{p.ref ? <><br /><span className="font-mono text-muted-foreground">{p.ref}</span></> : null}</td>
                  <td className="p-1.5">{p.cores.length > 0 ? p.cores.join(", ") : "—"}</td>
                  <td className="p-1.5 text-right tabular-nums">{fmtInt(p.pecas)}</td>
                  <td className="p-1.5 text-right tabular-nums">{mostrarValor ? brl(p.valorUnitario) : "—"}</td>
                  <td className="p-1.5 text-right tabular-nums">{mostrarValor && familia === "acabado" ? fmtPct(p.descontoPct) : "—"}</td>
                  <td className="p-1.5 text-right tabular-nums">{mostrarValor ? brl(totalDoProduto(p, familia)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td colSpan={3} className="p-1.5">Total desta OC</td>
              <td className="p-1.5 text-right tabular-nums">{fmtInt(totais.pecas)}</td>
              <td colSpan={2} />
              <td className="p-1.5 text-right tabular-nums">{totais.total != null ? brl(totais.total) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs text-muted-foreground">{rotulo}</div>
      {children}
    </div>
  );
}

// ── Resultado ────────────────────────────────────────────────────────────────────────────────────────────────────

function Resultado({ criadas, nomePorId, onAbrirOc }: {
  criadas: OcCriadaLote[]; nomePorId: Map<string, string>; onAbrirOc?: (ocId: string) => void;
}) {
  return (
    <div className="space-y-3" data-testid="pedido-oc-lote-resultado">
      <p className="flex items-center gap-2 text-sm font-semibold" role="status">
        {criadas.length > 0
          ? <CheckCircle2 className="h-4 w-4 text-[var(--tone-success-fg)]" />
          : <AlertCircle className="h-4 w-4 text-[var(--tone-warning-fg)]" />}
        {criadas.length > 0 ? `${textoOcsCriadas(criadas.length)}. Cada produto ficou vinculado à sua OC.` : "Nenhuma OC foi criada."}
      </p>
      <ul className="space-y-2">
        {criadas.map((oc) => (
          <li key={oc.oc_id} className="rounded-md border px-3 py-2" data-testid={`pedido-oc-lote-oc-${oc.oc_id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-sm">{oc.numero}</b>
              <StatusBadge tone="success">{produtosTexto(oc.produto_ids.length)}</StatusBadge>
              {onAbrirOc && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onAbrirOc(oc.oc_id)}>
                  Abrir OC <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{oc.produto_ids.map((id) => nomePorId.get(id) ?? "produto").join(", ")}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
