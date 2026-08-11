import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { VarianteDraft } from "./shared";

// Refino onda 2, item 3: seletor de produto EXISTENTE (catálogo = `produtos_acabados`,
// decisão do dono) direto no form/dialog da OC — antes só dava pra vincular indo em
// "Fazer pedido" a partir do card do Planejamento (`ProdutoCard.tsx`). Mesmo mapeamento
// de campos daquele fluxo (nome/grupo/categoria/subcats/fornecedor/REF forn/composição/
// proporção/variantes/qtd/valor/desconto), só que disparado de dentro da própria OC.
// Foto = espelho `produtos_acabados.modelo_id -> modelos.fotos_modelo[0]` (mesmo padrão
// do `Thumb`/`useSignedUrl(path,"modelos")` de `ProdutoRelacionadoSetor.tsx`).

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

type ProdutoRow = ProdutoAcabadoSelecionado & {
  temOc: boolean;
};

function Thumb({ path, alt }: { path: string | null; alt: string }) {
  const url = useSignedUrl(path, "modelos");
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
      {url ? <img src={url} alt={alt} className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

export function ProdutoAcabadoPicker({
  open, onOpenChange, onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (p: ProdutoAcabadoSelecionado) => void;
}) {
  const [busca, setBusca] = useState("");

  const { data: produtos = [], isFetching } = useQuery({
    queryKey: ["produtos-acabados-picker", busca],
    enabled: open,
    queryFn: async () => {
      const q = busca.trim().replace(/[%,]/g, "");
      let query = supabase
        .from("produtos_acabados" as any)
        .select(
          "id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id, empresa_id, representante_id, ref_fornecedor, composicao, grade_proporcao, qtd_total, valor_unitario, desconto_pct, " +
            "modelo:modelo_id(fotos_modelo), " +
            "produto_acabado_variantes(ordem,cor_id,cor_apelido_id,peso,qtd), " +
            "ocs_p_acabado(id)",
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
        valor_unitario: Number(p.valor_unitario ?? 0),
        desconto_pct: Number(p.desconto_pct ?? 0),
        variantes: Array.isArray(p.produto_acabado_variantes)
          ? p.produto_acabado_variantes.map((v: any): VarianteDraft => ({
              ordem: v.ordem, cor_id: v.cor_id ?? null, cor_apelido_id: v.cor_apelido_id ?? null,
              peso: Number(v.peso ?? 0), qtd: Number(v.qtd ?? 0),
            }))
          : [],
        fotoPath: p.modelo?.fotos_modelo?.[0] ?? null,
        // Informativo (não trava a escolha — a trava real é o trigger `enforce_oc_pa_
        // vinculo_unico` no servidor, capturada via mensagemErro no Salvar).
        temOc: Array.isArray(p.ocs_p_acabado) && p.ocs_p_acabado.length > 0,
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
