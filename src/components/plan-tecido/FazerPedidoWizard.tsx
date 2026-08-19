import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { brl, fmtInt, fmtNum } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import { DateField } from "@/components/shared/DateField";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { Button } from "@/components/ui/button";
import { ResponsavelSelect } from "@/components/shared/ResponsavelSelect";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

export type PreviaItemRpc = {
  artigo_id: string; artigo_nome: string; unidade_medida: string; rendimento: number | null;
  variante_tecido_id: string; label: string; necessidade_m: number; estoque_m: number;
  deficit_m: number; qtd: number; unidade: string; preco: number;
};
export type PreviaFornecedorRpc = {
  empresa_id: string; representante_id: string | null; empresa_nome: string; representante_nome: string | null;
  itens: PreviaItemRpc[];
};
// Cobertura por variante (chave `cobertura`): TODAS as variantes reais da coleção, inclusive
// deficit 0 — base do "a comprar" AO VIVO (supply = nec_m − deficit_m). O wizard não usa, mas
// Resumo/Drawer sim (fonte única).
export type PreviaCoberturaRpc = {
  artigo_id: string; artigo_nome: string; variante_tecido_id: string | null; label: string | null;
  nec_m: number; estoque_m: number; deficit_m: number;
};
export type PreviaRpc = {
  fornecedores: PreviaFornecedorRpc[];
  sem_fornecedor: { artigo_id: string; artigo_nome: string }[];
  bloqueios: { artigo_nome: string; motivo: string }[];
  cobertura?: PreviaCoberturaRpc[];
};

type Pagina = { fornecedor: PreviaFornecedorRpc; itens: PreviaItemRpc[] };
type Resposta = {
  dataPedido: string; data: string; prazo: string; qtd: Record<string, number>;
  responsavel: string; responsavelId: string | null; obs: string; qtdReceb: number; // qtd de parcelas de recebimento (datas vêm no recebimento)
  incluida: boolean; // desmarcar PULA a OC inteira (antes era zerar item por item — laudo jul/2026)
};

const keyItem = (it: PreviaItemRpc) => `${it.artigo_id}|${it.variante_tecido_id}`;
const nParcelas = (prazo: string) => Math.max(1, prazo.split(/[/\s]+/).filter(Boolean).length);

// 1 página por OC = fornecedor × grupos de ≤2 tecidos (mesma regra do servidor)
function paginasDe(previa: PreviaRpc): Pagina[] {
  const pgs: Pagina[] = [];
  for (const f of previa.fornecedores) {
    const arts = [...new Set(f.itens.filter((i) => i.deficit_m > 0).map((i) => i.artigo_id))];
    for (let i = 0; i < arts.length; i += 2) {
      const grupo = arts.slice(i, i + 2);
      pgs.push({ fornecedor: f, itens: f.itens.filter((it) => grupo.includes(it.artigo_id) && it.deficit_m > 0) });
    }
  }
  return pgs;
}

export function FazerPedidoWizard({ previa, colecaoId, onClose }: { previa: PreviaRpc; colecaoId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const paginas = useMemo(() => paginasDe(previa), [previa]);
  const [passo, setPasso] = useState(0);
  const [respostas, setRespostas] = useState<Record<number, Resposta>>(() => {
    const hoje = new Date().toISOString().slice(0, 10); // data do pedido = hoje por padrão
    const r: Record<number, Resposta> = {};
    paginas.forEach((pg, i) => {
      r[i] = { dataPedido: hoje, data: "", prazo: "", responsavel: "", responsavelId: null, obs: "", qtdReceb: 1, incluida: true, qtd: Object.fromEntries(pg.itens.map((it) => [keyItem(it), it.qtd])) };
    });
    return r;
  });

  const total = paginas.length;
  const pg = paginas[passo];
  const resp = respostas[passo];
  const setResp = (patch: Partial<Resposta>) => setRespostas((prev) => ({ ...prev, [passo]: { ...prev[passo], ...patch } }));
  const setQtd = (k: string, v: number) => setResp({ qtd: { ...resp.qtd, [k]: v } });

  // Cabeçalho (datas/prazo/responsável/obs) repetido 8× era carga pura (laudo, uso expert):
  // "Próxima" HERDA nos campos ainda vazios da página seguinte; "aplicar a todas" copia já.
  const CAMPOS_HERDA = ["data", "prazo", "responsavel", "responsavelId", "obs"] as const;
  const proxima = () => {
    setRespostas((prev) => {
      const cur = prev[passo]; const nx = { ...prev[passo + 1] };
      for (const k of CAMPOS_HERDA) if (!nx[k]) (nx as any)[k] = cur[k];
      if (nx.qtdReceb === 1 && cur.qtdReceb !== 1) nx.qtdReceb = cur.qtdReceb;
      return { ...prev, [passo + 1]: nx };
    });
    setPasso((p) => p + 1);
  };
  const aplicarATodas = () => {
    setRespostas((prev) => {
      const cur = prev[passo]; const out = { ...prev };
      paginas.forEach((_, i) => { if (i !== passo) out[i] = { ...out[i], data: cur.data, prazo: cur.prazo, responsavel: cur.responsavel, responsavelId: cur.responsavelId, obs: cur.obs, qtdReceb: cur.qtdReceb, dataPedido: cur.dataPedido }; });
      return out;
    });
    toast.success("Cabeçalho aplicado a todas as OCs.");
  };

  // Σ por página e geral (compromisso financeiro visível antes do Gerar — laudo Miller)
  const somaPagina = (i: number) => {
    const rr = respostas[i]; const p = paginas[i];
    let qtdT = 0, rs = 0;
    for (const it of p.itens) { const q = rr?.qtd[keyItem(it)] ?? 0; qtdT += q; rs += q * (Number(it.preco) || 0); }
    return { qtdT, rs };
  };
  const somaGeral = paginas.reduce((a, _, i) => {
    if (!respostas[i]?.incluida) return a;
    const { qtdT, rs } = somaPagina(i); return { qtdT: a.qtdT + qtdT, rs: a.rs + rs };
  }, { qtdT: 0, rs: 0 });

  const gerar = useMutation({
    mutationFn: async () => {
      const _pedidos = paginas.map((p, i) => {
        const rr = respostas[i];
        if (!rr.incluida) return { itens: [] } as any; // página desmarcada = pulada inteira
        return {
          empresa_id: p.fornecedor.empresa_id,
          representante_id: p.fornecedor.representante_id,
          data_pedido: rr.dataPedido || null,
          data_prevista_entrega: rr.data || null,
          prazo_pagamento: rr.prazo || null,
          quantidade_prazos: rr.prazo ? nParcelas(rr.prazo) : 1,
          responsavel_nome: rr.responsavel || null,
          responsavel_id: rr.responsavelId || null,
          observacoes_entrega: rr.obs || null,
          parcelas_recebimento: Array.from({ length: Math.max(1, rr.qtdReceb) }, () => ({ data: "", recebido: false })),
          itens: p.itens
            .map((it) => ({ artigo_id: it.artigo_id, variante_tecido_id: it.variante_tecido_id, quantidade_pedida: rr.qtd[keyItem(it)] ?? 0, preco: it.preco, rendimento: it.rendimento }))
            .filter((it) => it.quantidade_pedida > 0),
        };
      }).filter((p) => p.itens.length > 0);
      const { data, error } = await supabase.rpc("plan_tecido_fazer_pedido" as any, { _colecao_id: colecaoId, _pedidos });
      if (error) throw error;
      return data as { criadas: number; ocs: string[] };
    },
    onSuccess: (r) => {
      toast.success(`${r.criadas} OC(s) criada(s).`);
      onClose();
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-status-pedidos"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-oc-aplicada-lista", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-situacao-ocs", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-previa", colecaoId] }); // "a comprar" do Resumo cai após o pedido
      qc.invalidateQueries({ queryKey: ["plan-tecido-cobertura", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-cobertura-ocs", colecaoId] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível gerar os pedidos.")),
  });

  // nº de OCs que serão de fato geradas (páginas com alguma qtd > 0)
  const nOcs = paginas.filter((p, i) => respostas[i]?.incluida && p.itens.some((it) => (respostas[i]?.qtd[keyItem(it)] ?? 0) > 0)).length;
  const ultima = passo >= total - 1;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !gerar.isPending) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fazer pedido {total > 0 ? `— OC ${passo + 1} de ${total}` : ""}</DialogTitle>
          <DialogDescription>
            {total === 0
              ? (previa.sem_fornecedor.length > 0
                  ? "Há tecido a pedir, mas sem fornecedor cadastrado — defina o fornecedor do tecido no cadastro para gerar a OC."
                  : previa.bloqueios.length > 0
                    ? "Há tecido a pedir, mas bloqueado (ver abaixo)."
                    : "Nada a pedir — sem déficit de tecido nesta coleção.")
              : `Fornecedor: ${pg.fornecedor.empresa_nome}${pg.fornecedor.representante_nome ? " · " + pg.fornecedor.representante_nome : ""}`}
          </DialogDescription>
        </DialogHeader>

        {total > 0 && pg && (
          <div className={`space-y-3 ${resp.incluida ? "" : "opacity-50"}`}>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={resp.incluida}
                  onChange={(e) => setResp({ incluida: e.target.checked })} />
                incluir esta OC no pedido
              </label>
              <button type="button" onClick={aplicarATodas}
                className="ml-auto text-xs font-medium text-primary hover:underline"
                title="Copia datas, prazo, responsável, obs e parcelas desta página para todas as OCs">
                aplicar este cabeçalho a todas
              </button>
            </div>
            {/* campos a preencher desta OC */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-muted-foreground">Data do pedido</div>
                <DateField value={resp.dataPedido} onChange={(e) => setResp({ dataPedido: e.target.value })} />
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">Data prevista de entrega</div>
                <DateField value={resp.data} onChange={(e) => setResp({ data: e.target.value })} />
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">Prazo de pagamento (ex.: 30/60/90)</div>
                <input className="h-9 w-full rounded border bg-background px-2 text-sm max-md:h-11 max-md:text-base" value={resp.prazo}
                  onChange={(e) => setResp({ prazo: e.target.value })} placeholder="30/60/90" />
                <div className="mt-0.5 text-[10px] text-muted-foreground">{nParcelas(resp.prazo)} parcela(s) de pagamento</div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] text-muted-foreground">Responsável pelo pedido</div>
                <ResponsavelSelect nome={resp.responsavel} id={resp.responsavelId}
                  onChange={(n, cid) => setResp({ responsavel: n ?? "", responsavelId: cid ?? null })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-muted-foreground">Qtd. parcelas de recebimento</div>
                <NumberInput integer className="h-9 w-full text-right" value={resp.qtdReceb}
                  onChange={(e) => setResp({ qtdReceb: Math.max(1, Math.min(24, Number(e.target.value) || 1)) })} />
                <div className="mt-0.5 text-[10px] text-muted-foreground">as datas de cada entrega são preenchidas no recebimento</div>
              </div>
            </div>

            <div>
              <div className="text-[10px] text-muted-foreground">Observações de entrega</div>
              <textarea className="min-h-[48px] w-full rounded border bg-background px-2 py-1 text-sm max-md:text-base" value={resp.obs}
                onChange={(e) => setResp({ obs: e.target.value })} placeholder="Ex.: entregar na portaria, horário, etc." />
            </div>

            {/* itens (pré-preenchidos) + qtd editável */}
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground">
                  <tr>
                    <th className="p-1.5 text-left">Tecido / variante</th>
                    <th className="p-1.5 text-right">Necessidade</th>
                    <th className="p-1.5 text-right">Estoque</th>
                    <th className="p-1.5 text-right">Déficit</th>
                    <th className="p-1.5 text-right">Qtd a pedir</th>
                    <th className="p-1.5 text-left">Un.</th>
                    <th className="p-1.5 text-right">Preço</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.itens.map((it) => {
                    // artigo em kg → mostra "N m / K kg" (kg = metros ÷ rendimento)
                    const emKg = it.unidade_medida === "kg" && (it.rendimento ?? 0) > 0;
                    const mkg = (m: number) => emKg ? `${fmtInt(m)} m / ${fmtInt(m / (it.rendimento || 1))} kg` : `${fmtInt(m)} m`;
                    return (
                    <tr key={keyItem(it)} className="border-t">
                      <td className="p-1.5">
                        <div className="font-medium">{it.artigo_nome}</div>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <VarianteSwatch nome={it.label} /> {it.label || "—"}
                        </span>
                      </td>
                      <td className="p-1.5 text-right whitespace-nowrap">{mkg(it.necessidade_m)}</td>
                      <td className="p-1.5 text-right whitespace-nowrap">{mkg(it.estoque_m)}</td>
                      <td className="p-1.5 text-right whitespace-nowrap text-red-600">{mkg(it.deficit_m)}</td>
                      <td className="p-1.5 text-right">
                        <NumberInput blankZero placeholder="0" className="h-7 w-20 text-right max-md:h-11 max-md:text-base" value={resp.qtd[keyItem(it)] ?? 0}
                          onChange={(e) => setQtd(keyItem(it), Number(e.target.value) || 0)}
                          title={emKg ? "Déficit arredondado p/ cima em lotes de 5 kg" : "Déficit arredondado p/ cima em lotes de 10 m"} />
                      </td>
                      <td className="p-1.5">{it.unidade}</td>
                      <td className="p-1.5 text-right">{it.preco > 0 ? fmtNum(it.preco) : "—"}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {(() => { const { qtdT, rs } = somaPagina(passo); return (
                <div className="flex items-center gap-2 border-t bg-muted/30 px-2 py-1.5 text-xs">
                  <span className="text-muted-foreground">Total desta OC</span>
                  <b className="ml-auto tabular-nums">{qtdT.toLocaleString("pt-BR")} {pg.itens[0]?.unidade ?? "m"}{rs > 0 ? ` · ${brl(rs)}` : ""}</b>
                </div>
              ); })()}
            </div>
          </div>
        )}

        {/* avisos em TODAS as páginas — quem está na 5ª também precisa saber o que fica de fora */}
        {previa.sem_fornecedor.length > 0 && (
          <div className="rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
            Sem fornecedor (não geram OC): {previa.sem_fornecedor.map((s) => s.artigo_nome).join(", ")}.
          </div>
        )}
        {previa.bloqueios.length > 0 && (
          <div className="rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
            Bloqueios: {previa.bloqueios.map((b) => `${b.artigo_nome} (${b.motivo})`).join("; ")}.
          </div>
        )}

        <DialogFooter className="flex-row flex-wrap items-center gap-2 sm:justify-between sticky bottom-0 z-10 -mx-4 -mb-4 mt-2 border-t bg-background px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
          <Button variant="ghost" disabled={passo === 0 || gerar.isPending} onClick={() => setPasso((p) => p - 1)}>
            Anterior
          </Button>
          {!ultima && <Button variant="outline" disabled={gerar.isPending} onClick={proxima}>Próxima</Button>}
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground" title="Só as OCs incluídas (checkbox) e com quantidade entram">
            {total > 0 ? `${passo + 1}/${total} · ${nOcs} incluída(s)${somaGeral.rs > 0 ? ` · Σ ${brl(somaGeral.rs)}` : ""}` : ""}
          </span>
          {/* Gerar disponível de QUALQUER página (antes só na última: 7 cliques até poder gerar — laudo) */}
          <Button disabled={nOcs === 0 || gerar.isPending} onClick={() => gerar.mutate()}>
            {gerar.isPending ? "Gerando…" : `Gerar ${nOcs} OC(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
