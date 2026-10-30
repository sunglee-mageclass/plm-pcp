import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, Link2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { brl, fmtInt } from "@/lib/format";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  EMBED_OC_ITEM_PA, EMBED_OC_ITEM_PI, TEXTO_ABRA_A_OC, TEXTO_IDENTIDADE_TRAVADA, TEXTO_TIRAR_DA_OC,
  TEXTO_VINCULAR_SO_MESMO_FORNECEDOR, TEXTO_VINCULAR_SO_MESMO_FORNECEDOR_E_MOEDA,
  ocInfoDeItens, ocsParaVincular, podeDesvincularDireto, textoChipOc, textoDivideOc,
  type FamiliaOc, type OcCandidata, type OcItemEmbedRow, type OcProdutoInfo, type ProdutoParaVincular,
} from "@/lib/oc-produto-vinculo";

/**
 * [urg R13 T6] A OC do produto (Produto Acabado e Produto Importado): o CHIP do card ("Na OC BELDIV-00123 (com 3 produtos)") e a
 * SEÇÃO "3 · OC vinculada" (mockup aprovado): status/pedida/recebida DO ITEM, "divide a OC com N", "Identidade travada enquanto
 * estiver na OC", Abrir a OC, Vincular a uma OC existente (só encomendadas do mesmo fornecedor; Importado: e da mesma moeda),
 * Desvincular (só OC de 1 produto — em 2+ "Abra a OC para tirar o produto") e Fazer pedido deste produto.
 *
 * Quem grava é o SERVIDOR (`vincular_oc_p_acabado` / `vincular_oc_importado`): aqui só se evita oferecer o que ele recusaria. Sem
 * permissão de ver custos, R$ vira "—". A OC lida por aqui NUNCA entra no `chaveDirty` do produto.
 */

const ROTA_OC: Record<FamiliaOc, string> = { acabado: "/entrada-saida/oc-p-acabado", importado: "/entrada-saida/oc-p-importado" };
const RPC_VINCULAR: Record<FamiliaOc, string> = { acabado: "vincular_oc_p_acabado", importado: "vincular_oc_importado" };
const TABELA_PRODUTO: Record<FamiliaOc, string> = { acabado: "produtos_acabados", importado: "produtos_importados" };

/** Chaves de cache a invalidar quando a OC de um produto muda (a lista de produtos, as OCs e a contagem das abas). */
export function chavesCacheOcDoProduto(familia: FamiliaOc): ReadonlyArray<readonly string[]> {
  return familia === "acabado"
    ? [["produtos-acabados"], ["ocs_p_acabado"], ["oc-p-acabado"], ["sidebar-badges"]]
    : [["produtos-importados"], ["ocs_importado"], ["oc-importado"], ["sidebar-badges"]];
}

type InfoMinima = Pick<OcProdutoInfo, "id" | "numero"> & { nProdutos?: number };

/** O chip do card. Fica FORA do botão do cabeçalho do card (um botão dentro de outro não existe em HTML). */
export function OcChipProduto({ oc, familia, className }: { oc: InfoMinima | null | undefined; familia: FamiliaOc; className?: string }) {
  const navigate = useNavigate();
  if (!oc) return null;
  const texto = textoChipOc(oc.numero, oc.nProdutos ?? 1);
  return (
    <button
      type="button"
      title={`Abrir a OC ${oc.numero ?? ""}`.trim()}
      data-testid="oc-chip-produto"
      className={`inline-flex max-w-full ${className ?? ""}`}
      onClick={(e) => { e.stopPropagation(); navigate({ to: ROTA_OC[familia], search: { oc: oc.id } as any }); }}
    >
      <StatusBadge tone="info" className="max-w-full gap-1 whitespace-normal text-left normal-case tracking-normal text-xs">
        <Link2 className="h-3 w-3 shrink-0" /> {texto}
      </StatusBadge>
    </button>
  );
}

type SomaGrade = Record<string, Record<string, { pedida?: number; recebida?: number }>> | null | undefined;
function somaCampo(grade: SomaGrade, campo: "pedida" | "recebida"): number {
  let s = 0;
  for (const linha of Object.values(grade ?? {})) for (const cel of Object.values(linha ?? {})) s += Number(cel?.[campo] ?? 0);
  return s;
}

/** Ação do "Vincular": escolher UMA OC; "null" = Desvincular. Lança o erro da RPC. */
async function chamarVincular(familia: FamiliaOc, ocId: string, produtoId: string | null): Promise<void> {
  const { error } = await supabase.rpc(RPC_VINCULAR[familia] as any, { _oc_id: ocId, _produto_id: produtoId });
  if (error) throw error;
}

/** Relê a OC do produto depois de vincular/desvincular (item + cabeçalho + nº de produtos) — o patch local do card. */
async function lerOcDoProduto(familia: FamiliaOc, produtoId: string): Promise<OcProdutoInfo | null> {
  const embed = familia === "acabado" ? EMBED_OC_ITEM_PA : EMBED_OC_ITEM_PI;
  const { data, error } = await supabase.from(TABELA_PRODUTO[familia] as any).select(`id, ${embed}`).eq("id", produtoId).maybeSingle();
  if (error) throw error;
  return ocInfoDeItens((data as unknown as { oc_item?: OcItemEmbedRow[] | null } | null)?.oc_item, familia);
}

export function OcVinculadaSecao({
  familia, produto, oc, podeVerValor, conflitoPendente, fazendoPedido, mostrarIdentidadeTravada = true, onFazerPedido, onVinculada,
}: {
  familia: FamiliaOc;
  produto: ProdutoParaVincular;
  /** A OC do produto (adaptada do embed `oc_item`); `null` = sem OC. */
  oc: (Pick<OcProdutoInfo, "id" | "numero" | "status" | "valor_unitario_real"> & Partial<Pick<OcProdutoInfo, "nProdutos" | "grade_detalhe">>) | null;
  /** `false` (sem permissão de ver custos) = R$ vira "—". */
  podeVerValor: boolean;
  /** Há conflito de edição pendente na coleção — barra o "Fazer pedido" (a mesma trava do card). */
  conflitoPendente?: boolean;
  fazendoPedido?: boolean;
  /** "Identidade travada enquanto estiver na OC." — vale no Produto Acabado (o servidor recusa mexer na identidade com OC). */
  mostrarIdentidadeTravada?: boolean;
  /** "Fazer pedido deste produto" — abre o assistente com 1 produto (P-363). */
  onFazerPedido: () => void;
  /** Depois de vincular/desvincular: a OC relida (`null` = sem OC) para o card/Sheet atualizarem o rascunho. */
  onVinculada: (oc: OcProdutoInfo | null) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [vincularOpen, setVincularOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const nProdutos = oc?.nProdutos ?? 1;
  // Rascunho local ("novo-…", ainda sem linha no banco) não tem como vincular: o servidor precisa do produto salvo.
  const salvo = !!produto.id && !produto.id.startsWith("novo-");

  const aposMudar = async () => {
    for (const chave of chavesCacheOcDoProduto(familia)) qc.invalidateQueries({ queryKey: [...chave] });
    let nova: OcProdutoInfo | null = null;
    try { nova = await lerOcDoProduto(familia, produto.id); } catch { /* o refetch geral cobre */ }
    return nova;
  };

  const vincularMut = useMutation({
    mutationFn: async (ocId: string) => { await chamarVincular(familia, ocId, produto.id); },
    onSuccess: async () => {
      toast.success("OC vinculada.");
      setVincularOpen(false);
      onVinculada(await aposMudar());
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao vincular OC.")),
  });
  const desvincularMut = useMutation({
    mutationFn: async () => {
      // O servidor recusa em OC de 2+ produtos (`oc_varios_produtos`); a tela já nem oferece, mas a trava síncrona vale mesmo assim.
      if (!podeDesvincularDireto(nProdutos)) throw Object.assign(new Error(TEXTO_ABRA_A_OC), { code: "P0001", erroValidacao: true });
      await chamarVincular(familia, oc!.id, null);
    },
    onSuccess: async () => {
      toast.success("OC desvinculada.");
      onVinculada(await aposMudar());
    },
    onError: (e: any) => toast.error(e?.erroValidacao ? e.message : mensagemErro(e, "Erro ao desvincular OC.")),
  });

  // Candidatas: só quando o diálogo abre, e só se o produto não tem OC (1 OC por produto).
  const empresaId = produto.empresaId;
  const candidatasQ = useQuery({
    queryKey: ["oc-candidatas-vincular", familia, produto.id, empresaId, produto.moedaCompra ?? null, produto.moedaIntermediaria ?? null],
    enabled: vincularOpen && !oc && !!empresaId,
    queryFn: async () => {
      const q = familia === "acabado"
        ? supabase.from("ocs_p_acabado" as any)
            .select("id, numero, status, empresa_id, representante_id, valor_total_desconto, itens:ocs_p_acabado_itens(produto_acabado_id, nome_produto)")
        : supabase.from("ocs_importado" as any)
            .select("id, numero, status, empresa_id, representante_id, moeda_compra, moeda_intermediaria, itens:ocs_importado_itens(produto_importado_id, nome_produto)");
      const { data, error } = await q.eq("status", "encomendado").eq("empresa_id", empresaId as string).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Array<OcCandidata & { valor_total_desconto?: number | null }>;
    },
  });
  const candidatas = ocsParaVincular(candidatasQ.data ?? [], produto, familia) as Array<OcCandidata & { valor_total_desconto?: number | null }>;
  const filtradas = candidatas.filter((o) => !busca || (o.numero ?? "").toLowerCase().includes(busca.toLowerCase()));
  const textoSoMesmoFornecedor = familia === "importado" ? TEXTO_VINCULAR_SO_MESMO_FORNECEDOR_E_MOEDA : TEXTO_VINCULAR_SO_MESMO_FORNECEDOR;

  return (
    <div className="space-y-3" data-testid="oc-vinculada-secao">
      {oc ? (
        <>
          <InfoStrip itens={[
            {
              label: "Nº",
              valor: (
                <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={() => navigate({ to: ROTA_OC[familia], search: { oc: oc.id } as any })}>
                  {oc.numero ?? "—"} <ExternalLink className="h-3 w-3" />
                </button>
              ),
            },
            { label: "Status", valor: <StatusBadge tone={oc.status === "recebido" ? "success" : "warning"}>{oc.status === "recebido" ? "Recebido" : "Encomendado"}</StatusBadge> },
            { label: "Produtos na OC", valor: nProdutos },
            { label: "Pedida", valor: fmtInt(somaCampo(oc.grade_detalhe, "pedida")) },
            { label: "Recebida", valor: fmtInt(somaCampo(oc.grade_detalhe, "recebida")) },
            { label: "V. unit. real", valor: podeVerValor ? brl(oc.valor_unitario_real) : "—", hi: true },
          ]} />
          <p className="text-xs text-muted-foreground" data-testid="oc-vinculada-aviso">
            {[textoDivideOc(nProdutos), mostrarIdentidadeTravada ? TEXTO_IDENTIDADE_TRAVADA : null, nProdutos > 1 ? TEXTO_TIRAR_DA_OC : null].filter(Boolean).join(" ")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => navigate({ to: ROTA_OC[familia], search: { oc: oc.id } as any })}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Abrir a OC
            </Button>
            {podeDesvincularDireto(nProdutos) ? (
              <Button type="button" variant="outline" size="sm" disabled={desvincularMut.isPending} onClick={() => desvincularMut.mutate()}>
                {desvincularMut.isPending ? "Desvinculando…" : "Desvincular OC"}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground" data-testid="oc-vinculada-abra-a-oc">{TEXTO_ABRA_A_OC}</span>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Nenhuma OC vinculada ainda.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!salvo}
              title={salvo ? undefined : "Salve o produto antes de vincular uma OC."} onClick={() => setVincularOpen(true)}>
              <Link2 className="mr-1 h-3.5 w-3.5" /> Vincular a uma OC existente
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!!fazendoPedido || !!conflitoPendente}
              title={conflitoPendente ? "Resolva os conflitos de edição pendentes antes de fazer o pedido." : undefined}
              onClick={onFazerPedido}
            >
              <ShoppingCart className="mr-1 h-3.5 w-3.5" /> {fazendoPedido ? "Criando…" : "Fazer pedido deste produto"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{textoSoMesmoFornecedor}</p>
        </>
      )}

      {/* Vincular a uma OC existente — novo = Dialog. Só encomendadas do mesmo fornecedor (Importado: e da mesma moeda). */}
      {vincularOpen && (
        <Dialog open onOpenChange={(o) => { if (!o && !vincularMut.isPending) setVincularOpen(false); }}>
          <DialogContent className="max-w-md" data-testid="oc-vincular-dialog">
            <DialogHeader>
              <DialogTitle>Vincular OC existente</DialogTitle>
              <DialogDescription>{textoSoMesmoFornecedor}</DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-2">
              <Input placeholder="Buscar por nº…" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-md:h-11 max-md:text-base" />
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {!empresaId && <p className="p-2 text-sm text-muted-foreground">Escolha o fornecedor do produto para ver as OCs.</p>}
                {empresaId && candidatasQ.isLoading && <p className="p-2 text-sm text-muted-foreground">Carregando…</p>}
                {empresaId && candidatasQ.isError && <p className="p-2 text-sm text-destructive">Não foi possível carregar as OCs.</p>}
                {empresaId && candidatasQ.isSuccess && filtradas.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground" data-testid="oc-vincular-vazio">
                    {familia === "importado" ? "Nenhuma OC encomendada deste fornecedor e moeda." : "Nenhuma OC encomendada deste fornecedor."}
                  </p>
                )}
                {filtradas.map((o) => {
                  const n = (o.itens ?? []).length;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      data-testid={`oc-vincular-${o.id}`}
                      disabled={vincularMut.isPending}
                      onClick={() => vincularMut.mutate(o.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-muted disabled:opacity-50 max-md:min-h-11"
                    >
                      <span className="min-w-0 truncate"><b>{o.numero ?? "—"}</b> · {n === 1 ? "1 produto" : `${n} produtos`}</span>
                      {familia === "acabado" && (
                        <span className="shrink-0 tabular-nums text-muted-foreground">{podeVerValor ? brl(o.valor_total_desconto ?? 0) : "—"}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
