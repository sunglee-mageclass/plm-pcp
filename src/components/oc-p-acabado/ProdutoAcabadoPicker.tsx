import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Lock, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cadeiaValores, ehGrupoAcessorio } from "@/lib/produto-acabado";
import { motivosForaDoPedido, textoMotivos } from "@/lib/pedido-oc-lote";
import { fmtMoney } from "./shared";
import type { VarianteDraft } from "./shared";

// "Adicionar produto" da OC (R13, P-358): lista os produtos do MESMO fornecedor da OC que ainda NÃO têm OC (embed dos itens
// `ocs_p_acabado_itens(id)` — o ponteiro do cabeçalho saiu, R13) e devolve os escolhidos. A tela da OC manda, no Salvar,
// só `{produto_acabado_id, do_produto: true}`: o servidor monta o item do produto SALVO e confere de novo (fornecedor, motivos).
// Quem não pode entrar aparece desabilitado COM o motivo (a mesma lista do assistente — `motivosForaDoPedido`).
// Foto = espelho `produtos_acabados.modelo_id -> modelos.fotos_modelo[0]` (padrão do `Thumb` de `ProdutoRelacionadoSetor.tsx`).

export type ProdutoAcabadoSelecionado = {
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
  valor_unitario: number;
  desconto_pct: number;
  variantes: VarianteDraft[];
  fotoPath: string | null;
};

type ProdutoRow = ProdutoAcabadoSelecionado & { temOc: boolean; grupoNome: string };

function Thumb({ path, alt }: { path: string | null; alt: string }) {
  const url = useSignedUrl(path, "modelos");
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
      {url ? <img src={url} alt={alt} className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

/** Motivos que o servidor recusaria (`_oc_produto_motivos`) — mesma função do assistente de pedido. */
export function motivosDoProdutoNaOc(p: Pick<ProdutoRow, "nome" | "empresa_id" | "valor_unitario" | "qtd_total" | "variantes" | "grade_proporcao" | "grupoNome" | "temOc">): string {
  const somaPesosGrade = Object.values(p.grade_proporcao).reduce((s, n) => s + (Number(n) > 0 ? Number(n) : 0), 0);
  return textoMotivos(motivosForaDoPedido({
    temOc: p.temOc, nome: p.nome, empresaId: p.empresa_id, valorUnitario: p.valor_unitario, qtdTotal: p.qtd_total,
    somaVariantes: p.variantes.reduce((s, v) => s + v.qtd, 0), nVariantes: p.variantes.length,
    precisaGrade: !ehGrupoAcessorio(p.grupoNome), somaPesosGrade, erroDaFamilia: null, conflitoDoProduto: false,
  }, { conflitoPendente: false }));
}

export function ProdutoAcabadoPicker({
  open, onOpenChange, onAdicionar, empresaId, empresaNome, numeroOc, excluirIds = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdicionar: (produtos: ProdutoAcabadoSelecionado[]) => void;
  /** Fornecedor da OC: só os produtos dele entram. `null` (OC nova sem fornecedor) = todos; o fornecedor da OC passa a ser o do produto. */
  empresaId: string | null;
  empresaNome?: string | null;
  numeroOc?: string | null;
  /** Produtos que a OC já tem (inclusive os pendentes de Salvar) — não são oferecidos de novo. */
  excluirIds?: ReadonlyArray<string>;
}) {
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  useEffect(() => { if (!open) { setMarcados(new Set()); setBusca(""); } }, [open]);

  const { data: produtos = [], isFetching } = useQuery({
    queryKey: ["produtos-acabados-picker-oc", empresaId, busca],
    enabled: open,
    queryFn: async () => {
      const q = busca.trim().replace(/[%,]/g, "");
      let query = supabase
        .from("produtos_acabados" as any)
        .select(
          "id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id, empresa_id, representante_id, ref_fornecedor, composicao, grade_proporcao, qtd_total, valor_unitario, desconto_pct, " +
            "grupo:grupo_id(nome), modelo:modelo_id(fotos_modelo), " +
            "produto_acabado_variantes(ordem,cor_id,cor_apelido_id,peso,qtd), " +
            "ocs_p_acabado_itens(id)",
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
        valor_unitario: Number(p.valor_unitario ?? 0),
        desconto_pct: Number(p.desconto_pct ?? 0),
        variantes: Array.isArray(p.produto_acabado_variantes)
          ? p.produto_acabado_variantes.map((v: any): VarianteDraft => ({
              ordem: v.ordem, cor_id: v.cor_id ?? null, cor_apelido_id: v.cor_apelido_id ?? null,
              peso: Number(v.peso ?? 0), qtd: Number(v.qtd ?? 0),
            }))
          : [],
        fotoPath: p.modelo?.fotos_modelo?.[0] ?? null,
        grupoNome: p.grupo?.nome ?? "",
        // 1 OC por produto (gatilho nos itens): quem já está em algum item não entra.
        temOc: Array.isArray(p.ocs_p_acabado_itens) && p.ocs_p_acabado_itens.length > 0,
      }));
    },
  });

  const jaNaOc = useMemo(() => new Set(excluirIds), [excluirIds]);
  const candidatos = useMemo(() => produtos.filter((p) => !p.temOc && !jaNaOc.has(p.id)), [produtos, jaNaOc]);
  const alternar = (id: string) =>
    setMarcados((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const confirmar = () => onAdicionar(candidatos.filter((p) => marcados.has(p.id) && !motivosDoProdutoNaOc(p)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{numeroOc ? `Adicionar produto à OC ${numeroOc}` : "Adicionar produto à OC"}</DialogTitle>
          <DialogDescription>
            {empresaId
              ? `Só aparecem produtos do mesmo fornecedor${empresaNome ? ` (${empresaNome})` : ""}, da mesma família (Produto Acabado) e sem OC.`
              : "Só aparecem produtos da família Produto Acabado e sem OC. O fornecedor da OC passa a ser o do produto escolhido."}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus placeholder="Buscar por nome ou REF…" className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {candidatos.map((p) => {
            const motivo = motivosDoProdutoNaOc(p);
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
                    <span className="shrink-0 text-xs text-muted-foreground">{p.qtd_total} pç · {fmtMoney(cadeiaValores(p.qtd_total, p.valor_unitario, p.desconto_pct).totalDesc)}</span>
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
