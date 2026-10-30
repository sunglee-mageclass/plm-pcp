import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Lock, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { erroCotacaoEtapas } from "@/lib/importado-etapas";
import { fmtMoeda } from "@/lib/moeda";
import { motivosForaDoPedido, textoMotivos } from "@/lib/pedido-oc-lote";
import { somaPercentualPorBase, type EtapaDraft, type VarianteDraft } from "./shared";

// "Adicionar produto" da OC de Importado (R13, P-358/P-363): lista os produtos do MESMO fornecedor e da MESMA MOEDA da OC que ainda
// NÃO têm OC (embed dos itens `ocs_importado_itens(id)` — o ponteiro do cabeçalho saiu, R13) e devolve os escolhidos. A tela da OC
// manda, no Salvar, só `{produto_importado_id, do_produto: true}`: o servidor monta o item do produto SALVO e confere de novo
// (fornecedor, moeda, motivos). Quem não pode entrar aparece desabilitado COM o motivo (a mesma lista do assistente — `motivosForaDoPedido`
// + a regra de moeda). Espelha `oc-p-acabado/ProdutoAcabadoPicker.tsx`, trocando valor/desconto pelos campos de câmbio.

export type ProdutoImportadoSelecionado = {
  id: string;
  nome: string;
  ref: string | null;
  grupo_id: string | null;
  categoria_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  empresa_id: string | null;
  representante_id: string | null;
  ref_fornecedor: string | null;
  composicao: string | null;
  grade_proporcao: Record<string, number>;
  qtd_total: number;
  moeda_compra: string;
  moeda_intermediaria: string | null;
  valor_unitario_m1: number;
  cotacao_ref: number;
  peso_kg: number;
  transporte_m2: number;
  desconto_pct: number;
  cotacao_final: number;
  variantes: VarianteDraft[];
  etapas: EtapaDraft[];
  fotoPath: string | null;
};

type ProdutoRow = ProdutoImportadoSelecionado & { temOc: boolean; grupoNome: string };

function Thumb({ path, alt }: { path: string | null; alt: string }) {
  const url = useSignedUrl(path, "oc-tecido");
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
      {url ? <img src={url} alt={alt} className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

const moedaNorm = (c: string | null | undefined): string => (c ?? "").trim().toUpperCase();
/** Mesma regra do servidor: compra `coalesce(moeda_compra,'RMB')`, intermediária `nullif(…,'')` (vazia = direta). */
export function mesmaMoeda(
  a: { moeda_compra: string | null; moeda_intermediaria: string | null },
  b: { moeda_compra: string | null; moeda_intermediaria: string | null },
): boolean {
  return (moedaNorm(a.moeda_compra) || "RMB") === (moedaNorm(b.moeda_compra) || "RMB")
    && moedaNorm(a.moeda_intermediaria) === moedaNorm(b.moeda_intermediaria);
}

/** Motivos que o servidor recusaria (`_oc_produto_motivos`, moeda, e a validação das etapas do card) — mesma função do assistente. */
export function motivosDoProdutoNaOc(
  p: Pick<ProdutoRow, "nome" | "empresa_id" | "valor_unitario_m1" | "qtd_total" | "variantes" | "grade_proporcao" | "grupoNome" | "temOc" | "etapas" | "moeda_compra" | "moeda_intermediaria">,
  oc?: { moeda_compra: string | null; moeda_intermediaria: string | null } | null,
): string {
  const somaPesosGrade = Object.values(p.grade_proporcao).reduce((s, n) => s + (Number(n) > 0 ? Number(n) : 0), 0);
  let erroDaFamilia: string | null = null;
  const somaMerc = somaPercentualPorBase(p.etapas, "mercadoria");
  const somaFrete = somaPercentualPorBase(p.etapas, "frete");
  if (p.etapas.some((e) => e.base === "mercadoria") && somaMerc !== 100) erroDaFamilia = `Σ% das etapas de mercadoria (${somaMerc}%) precisa fechar 100%.`;
  else if (p.etapas.some((e) => e.base === "frete") && somaFrete !== 100) erroDaFamilia = `Σ% das etapas de frete (${somaFrete}%) precisa fechar 100%.`;
  else erroDaFamilia = erroCotacaoEtapas(p.etapas, p.valor_unitario_m1);
  const base = textoMotivos(motivosForaDoPedido({
    temOc: p.temOc, nome: p.nome, empresaId: p.empresa_id, valorUnitario: p.valor_unitario_m1, qtdTotal: p.qtd_total,
    somaVariantes: p.variantes.reduce((s, v) => s + v.qtd, 0), nVariantes: p.variantes.length,
    precisaGrade: !ehGrupoAcessorio(p.grupoNome), somaPesosGrade, erroDaFamilia, conflitoDoProduto: false,
  }, { conflitoPendente: false }));
  if (oc && !mesmaMoeda(p, oc)) {
    const mp = `${moedaNorm(p.moeda_compra) || "RMB"}${moedaNorm(p.moeda_intermediaria) ? ` → ${moedaNorm(p.moeda_intermediaria)}` : ""}`;
    const mo = `${moedaNorm(oc.moeda_compra) || "RMB"}${moedaNorm(oc.moeda_intermediaria) ? ` → ${moedaNorm(oc.moeda_intermediaria)}` : ""}`;
    return `${base}${base ? " " : ""}Moeda diferente da OC (${mp}; a OC é ${mo}).`;
  }
  return base;
}

export function ProdutoImportadoPicker({
  open, onOpenChange, onAdicionar, empresaId, empresaNome, numeroOc, excluirIds = [], moedaDaOc = null,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdicionar: (produtos: ProdutoImportadoSelecionado[]) => void;
  /** Fornecedor da OC: só os produtos dele entram. `null` (OC nova sem fornecedor) = todos; o fornecedor da OC passa a ser o do produto. */
  empresaId: string | null;
  empresaNome?: string | null;
  numeroOc?: string | null;
  /** Produtos que a OC já tem (inclusive os pendentes de Salvar) — não são oferecidos de novo. */
  excluirIds?: ReadonlyArray<string>;
  /** Moeda da OC. Só vale quando a OC JÁ TEM produto (salva ou pendente) — a OC sem produto ainda herda a moeda do 1º que entrar. */
  moedaDaOc?: { moeda_compra: string | null; moeda_intermediaria: string | null } | null;
}) {
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  useEffect(() => { if (!open) { setMarcados(new Set()); setBusca(""); } }, [open]);

  const { data: produtos = [], isFetching } = useQuery({
    queryKey: ["produtos-importados-picker-oc", empresaId, busca],
    enabled: open,
    queryFn: async () => {
      const q = busca.trim().replace(/[%,]/g, "");
      let query = supabase
        .from("produtos_importados" as any)
        .select(
          "id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id, empresa_id, representante_id, ref_fornecedor, composicao, grade_proporcao, qtd_total, " +
            "moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2, desconto_pct, cotacao_final, foto_url, " +
            "grupo:grupo_id(nome), " +
            "produto_importado_variantes(ordem,cor_id,cor_apelido_id,peso,qtd), " +
            "produto_importado_etapas(ordem,rotulo,base,percentual,data_vencimento,cotacao), " +
            "ocs_importado_itens(id)",
        )
        .order("nome")
        .limit(60);
      if (empresaId) query = query.eq("empresa_id", empresaId);
      if (q) query = query.or(`nome.ilike.%${q}%,ref.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as any[]).map((p): ProdutoRow => ({
        id: p.id,
        nome: p.nome,
        ref: p.ref ?? null,
        grupo_id: p.grupo_id ?? null,
        categoria_id: p.categoria_id ?? null,
        subcategoria1_id: p.subcategoria1_id ?? null,
        subcategoria2_id: p.subcategoria2_id ?? null,
        empresa_id: p.empresa_id ?? null,
        representante_id: p.representante_id ?? null,
        ref_fornecedor: p.ref_fornecedor ?? null,
        composicao: p.composicao ?? null,
        grade_proporcao: p.grade_proporcao ?? {},
        qtd_total: p.qtd_total ?? 0,
        moeda_compra: p.moeda_compra ?? "RMB",
        moeda_intermediaria: p.moeda_intermediaria ?? null,
        valor_unitario_m1: Number(p.valor_unitario_m1 ?? 0),
        cotacao_ref: Number(p.cotacao_ref ?? 0),
        peso_kg: Number(p.peso_kg ?? 0),
        transporte_m2: Number(p.transporte_m2 ?? 0),
        desconto_pct: Number(p.desconto_pct ?? 0),
        cotacao_final: Number(p.cotacao_final ?? 0),
        variantes: Array.isArray(p.produto_importado_variantes)
          ? p.produto_importado_variantes.map((v: any): VarianteDraft => ({
              ordem: v.ordem, cor_id: v.cor_id ?? null, cor_apelido_id: v.cor_apelido_id ?? null,
              peso: Number(v.peso ?? 0), qtd: Number(v.qtd ?? 0),
            }))
          : [],
        // Etapas de pagamento do produto — a OC NOVA herda o cronograma do 1º produto (como o servidor faz no "Fazer pedido").
        etapas: Array.isArray(p.produto_importado_etapas)
          ? [...p.produto_importado_etapas].sort((a: any, b: any) => a.ordem - b.ordem).map((e: any): EtapaDraft => ({
              ordem: e.ordem, rotulo: e.rotulo ?? "", base: e.base, percentual: Number(e.percentual ?? 0),
              data_vencimento: e.data_vencimento ?? null, cotacao: Number(e.cotacao ?? 0),
            }))
          : [],
        fotoPath: p.foto_url ?? null,
        grupoNome: p.grupo?.nome ?? "",
        // 1 OC por produto (gatilho nos itens): quem já está em algum item não entra.
        temOc: Array.isArray(p.ocs_importado_itens) && p.ocs_importado_itens.length > 0,
      }));
    },
  });

  const jaNaOc = useMemo(() => new Set(excluirIds), [excluirIds]);
  const candidatos = useMemo(() => produtos.filter((p) => !p.temOc && !jaNaOc.has(p.id)), [produtos, jaNaOc]);
  const alternar = (id: string) =>
    setMarcados((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const confirmar = () => onAdicionar(candidatos.filter((p) => marcados.has(p.id) && !motivosDoProdutoNaOc(p, moedaDaOc)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{numeroOc ? `Adicionar produto à OC ${numeroOc}` : "Adicionar produto à OC"}</DialogTitle>
          <DialogDescription>
            {empresaId
              ? `Só aparecem produtos do mesmo fornecedor${empresaNome ? ` (${empresaNome})` : ""}, da mesma família (Produto Importado), da mesma moeda e sem OC.`
              : "Só aparecem produtos da família Produto Importado e sem OC. O fornecedor e a moeda da OC passam a ser os do produto escolhido."}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus placeholder="Buscar por nome ou REF…" className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {candidatos.map((p) => {
            const motivo = motivosDoProdutoNaOc(p, moedaDaOc);
            return (
              <li key={p.id}>
                {motivo ? (
                  <div className="flex items-center gap-3 rounded-md bg-muted p-2 text-muted-foreground">
                    <Thumb path={p.fotoPath} alt={p.ref ?? p.nome} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 truncate text-sm"><Lock className="h-3.5 w-3.5 shrink-0" />{p.nome}</p>
                      <p className="text-xs">{motivo}</p>
                    </div>
                  </div>
                ) : (
                  <label className="flex w-full cursor-pointer items-center gap-3 rounded-md border p-2 hover:bg-muted">
                    <Checkbox checked={marcados.has(p.id)} onCheckedChange={() => alternar(p.id)} aria-label={`Adicionar ${p.nome}`} />
                    <Thumb path={p.fotoPath} alt={p.ref ?? p.nome} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-primary">{p.ref ?? "—"}</p>
                      <p className="truncate text-sm">{p.nome}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{p.qtd_total} pç · {fmtMoeda(p.valor_unitario_m1, p.moeda_compra)}</span>
                  </label>
                )}
              </li>
            );
          })}
          {!isFetching && candidatos.length === 0 && (
            <li className="p-2 text-sm text-muted-foreground">
              {busca.trim() ? "Nenhum produto encontrado." : "Nenhum produto disponível."}
            </li>
          )}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" disabled={marcados.size === 0} onClick={confirmar}>
            {marcados.size > 0 ? `Adicionar ${marcados.size} ${marcados.size === 1 ? "produto" : "produtos"}` : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
