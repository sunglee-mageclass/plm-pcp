import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { VarianteDraft, EtapaDraft } from "./shared";

// Seletor de produto EXISTENTE (catálogo = `produtos_importados`) direto no form/dialog da OC —
// espelha `ProdutoAcabadoPicker.tsx` (oc-p-acabado), trocando o mapeamento de campos pelos de
// câmbio (moeda/cotação/frete) em vez de valor_unitario/desconto_pct da revenda.

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

type ProdutoRow = ProdutoImportadoSelecionado & {
  temOc: boolean;
};

function Thumb({ path, alt }: { path: string | null; alt: string }) {
  const url = useSignedUrl(path, "oc-tecido");
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
      {url ? <img src={url} alt={alt} className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

export function ProdutoImportadoPicker({
  open, onOpenChange, onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (p: ProdutoImportadoSelecionado) => void;
}) {
  const [busca, setBusca] = useState("");

  const { data: produtos = [], isFetching } = useQuery({
    queryKey: ["produtos-importados-picker", busca],
    enabled: open,
    queryFn: async () => {
      const q = busca.trim().replace(/[%,]/g, "");
      let query = supabase
        .from("produtos_importados" as any)
        .select(
          "id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id, empresa_id, representante_id, ref_fornecedor, composicao, grade_proporcao, qtd_total, " +
            "moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2, desconto_pct, cotacao_final, foto_url, " +
            "produto_importado_variantes(ordem,cor_id,cor_apelido_id,peso,qtd), " +
            "produto_importado_etapas(ordem,rotulo,base,percentual,data_vencimento,cotacao), " +
            "ocs_importado(id)",
        )
        .order("nome")
        .limit(30);
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
        // Etapas de pagamento — copiadas p/ o preview de custo landed bater com o que será
        // persistido (ordenadas por `ordem`). Sem elas o preview usaria só o fallback de frete.
        etapas: Array.isArray(p.produto_importado_etapas)
          ? [...p.produto_importado_etapas].sort((a: any, b: any) => a.ordem - b.ordem).map((e: any): EtapaDraft => ({
              ordem: e.ordem, rotulo: e.rotulo ?? "", base: e.base, percentual: Number(e.percentual ?? 0),
              data_vencimento: e.data_vencimento ?? null, cotacao: Number(e.cotacao ?? 0),
            }))
          : [],
        fotoPath: p.foto_url ?? null,
        // Informativo (não trava a escolha — a trava real é o trigger
        // `enforce_oc_importado_vinculo_unico` no servidor, capturada via mensagemErro no Salvar).
        temOc: Array.isArray(p.ocs_importado) && p.ocs_importado.length > 0,
      }));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Selecionar produto existente</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus placeholder="Buscar por nome ou REF…" className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {produtos.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p)}
                className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted"
              >
                <Thumb path={p.fotoPath} alt={p.ref ?? p.nome} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-primary">{p.ref ?? "—"}</p>
                  <p className="truncate text-sm">{p.nome}</p>
                </div>
                {p.temOc && <span className="shrink-0 text-[10px] text-amber-600">já tem OC</span>}
              </button>
            </li>
          ))}
          {!isFetching && produtos.length === 0 && (
            <li className="p-2 text-sm text-muted-foreground">
              {busca.trim() ? "Nenhum produto encontrado." : "Nenhum produto cadastrado ainda."}
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
