import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

// Endereçamento de tecido (rua/prateleira). Fonte = tabela enderecamento_tecido.
// O endereço mora no FÍSICO: manual da variante (ocItemId nulo) OU de um item de OC recebido
// (ocItemId setado). O rolo tem endereço próprio (colunas ocs_tecido.rolo_*, não este componente).

export type EnderecoRow = { id: string; rua: string | null; prateleira: string | null };

export type EnderecoRollup = {
  variante_tecido_id: string;
  rua: string | null;
  prateleira: string | null;
  origem: "manual" | "oc" | "rolo";
  origem_label: string;
};

/** "Rua/Prateleira" compacto (— quando vazio). */
export function fmtEndereco(e: { rua?: string | null; prateleira?: string | null }): string {
  const r = (e.rua ?? "").trim();
  const p = (e.prateleira ?? "").trim();
  if (r && p) return `${r}/${p}`;
  return r || p || "—";
}

/** Rollup consolidado (tabela manual+OC UNION colunas do rolo) por variante — leitura. */
export function useEnderecosRollup() {
  return useQuery({
    queryKey: ["end-tecido-rollup"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("enderecos_tecido" as any);
      if (error) throw error;
      const map = new Map<string, EnderecoRollup[]>();
      for (const r of ((data ?? []) as EnderecoRollup[])) {
        const arr = map.get(r.variante_tecido_id) ?? [];
        arr.push(r);
        map.set(r.variante_tecido_id, arr);
      }
      return map;
    },
  });
}

/** Lista editável de endereços de um ESCOPO (manual da variante ou de um item de OC),
 *  persistida em enderecamento_tecido. Add / editar (onBlur) / remover por linha. */
export function EnderecoLista({
  varianteId,
  ocItemId,
  readOnly,
  onChanged,
}: {
  varianteId: string;
  ocItemId?: string | null; // undefined/null = escopo MANUAL da variante
  readOnly?: boolean;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const scopeKey = ocItemId ?? "manual";
  const listKey = ["end-tecido", varianteId, scopeKey];
  const [draft, setDraft] = useState<Record<string, { rua: string; prateleira: string }>>({});

  const { data: rows = [], isLoading } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      let q = supabase
        .from("enderecamento_tecido" as any)
        .select("id, rua, prateleira")
        .eq("variante_tecido_id", varianteId)
        .order("created_at");
      q = ocItemId ? q.eq("oc_tecido_item_id", ocItemId) : q.is("oc_tecido_item_id", null).is("rolo_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as EnderecoRow[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: listKey });
    qc.invalidateQueries({ queryKey: ["end-tecido-rollup"] });
    qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    onChanged?.();
  };

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("enderecamento_tecido" as any)
        .insert({ variante_tecido_id: varianteId, oc_tecido_item_id: ocItemId ?? null, rua: "", prateleira: "" });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao adicionar endereço.")),
  });

  const saveMut = useMutation({
    mutationFn: async (r: { id: string; rua: string; prateleira: string }) => {
      const { error } = await supabase
        .from("enderecamento_tecido" as any)
        .update({ rua: r.rua, prateleira: r.prateleira })
        .eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar endereço.")),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("enderecamento_tecido" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao remover endereço.")),
  });

  const val = (r: EnderecoRow) => draft[r.id] ?? { rua: r.rua ?? "", prateleira: r.prateleira ?? "" };
  const setVal = (id: string, patch: Partial<{ rua: string; prateleira: string }>) =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? { rua: "", prateleira: "" }), ...patch } }));
  const commit = (r: EnderecoRow) => {
    const v = val(r);
    if (v.rua !== (r.rua ?? "") || v.prateleira !== (r.prateleira ?? "")) saveMut.mutate({ id: r.id, ...v });
  };

  return (
    <div className="space-y-1.5">
      {isLoading && (
        <p className="text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> Carregando…
        </p>
      )}
      {!isLoading && rows.length === 0 && <p className="text-xs text-muted-foreground">Sem endereço.</p>}
      {rows.map((r) => {
        const v = val(r);
        return (
          <div key={r.id} className="flex items-center gap-2">
            <Input
              className="flex-1"
              placeholder="Rua"
              value={v.rua}
              readOnly={readOnly}
              onChange={(e) => setVal(r.id, { rua: e.target.value })}
              onBlur={() => commit(r)}
            />
            <Input
              className="flex-1"
              placeholder="Prateleira"
              value={v.prateleira}
              readOnly={readOnly}
              onChange={(e) => setVal(r.id, { prateleira: e.target.value })}
              onBlur={() => commit(r)}
            />
            {!readOnly && (
              <Button size="iconSm" variant="ghost" onClick={() => delMut.mutate(r.id)} aria-label="Remover endereço">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <Button size="sm" variant="outline" onClick={() => addMut.mutate()} disabled={addMut.isPending}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Endereço
        </Button>
      )}
    </div>
  );
}

/** Gatilho 📍 (Popover) que abre a lista editável de endereços de um item de OC (ou manual).
 *  Mostra a contagem no botão. Usado em OC Recebidos e onde o espaço da linha é curto. */
export function EnderecoPopover({
  varianteId,
  ocItemId,
  readOnly,
  label = "Endereço",
}: {
  varianteId: string;
  ocItemId?: string | null;
  readOnly?: boolean;
  label?: string;
}) {
  const scopeKey = ocItemId ?? "manual";
  const { data: rows = [] } = useQuery({
    queryKey: ["end-tecido", varianteId, scopeKey],
    queryFn: async () => {
      let q = supabase
        .from("enderecamento_tecido" as any)
        .select("id, rua, prateleira")
        .eq("variante_tecido_id", varianteId)
        .order("created_at");
      q = ocItemId ? q.eq("oc_tecido_item_id", ocItemId) : q.is("oc_tecido_item_id", null).is("rolo_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as EnderecoRow[];
    },
  });
  const preenchidos = rows.filter((r) => (r.rua ?? "").trim() || (r.prateleira ?? "").trim());
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1">
          <MapPin className="h-3.5 w-3.5" />
          {preenchidos.length > 0 ? (
            <>
              {fmtEndereco(preenchidos[0])}
              {preenchidos.length > 1 && <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">+{preenchidos.length - 1}</Badge>}
            </>
          ) : (
            <span className="text-muted-foreground">{label}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <p className="text-xs font-medium mb-2 flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> Endereços deste item
        </p>
        <EnderecoLista varianteId={varianteId} ocItemId={ocItemId} readOnly={readOnly} />
      </PopoverContent>
    </Popover>
  );
}
