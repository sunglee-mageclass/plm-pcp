import { useMemo, useState } from "react";
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
  endereco_id: string | null; // linha em enderecamento_tecido (manual/OC) — p/ editar
  rolo_id: string | null; // ocs_tecido do rolo — p/ editar as colunas rolo_*
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

/** Agrupa endereços iguais (mesmo rua/prateleira) numa entrada, juntando as origens —
 *  para EXIBIR sem repetir o mesmo vão (o Cadastro já edita agrupado). */
export function agruparEnderecos(
  rows: { rua?: string | null; prateleira?: string | null; origem_label?: string }[],
): { label: string; origens: string[] }[] {
  const map = new Map<string, { label: string; origens: string[] }>();
  for (const e of rows) {
    const label = fmtEndereco(e);
    const g = map.get(label) ?? { label, origens: [] };
    if (e.origem_label && !g.origens.includes(e.origem_label)) g.origens.push(e.origem_label);
    map.set(label, g);
  }
  return Array.from(map.values());
}

/** Rollup consolidado (tabela manual+OC UNION colunas do rolo) por variante — leitura. */
export function useEnderecosRollup(enabled = true) {
  return useQuery({
    queryKey: ["end-tecido-rollup"],
    enabled,
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

/** Editor CONSOLIDADO (Cadastro): edita TODOS os endereços de uma variante — manual, por OC
 *  e por rolo — cada um roteado para o store certo (linha da tabela p/ manual+OC, colunas
 *  ocs_tecido.rolo_* p/ rolo). Recebe as linhas do rollup (com endereco_id/rolo_id). Remover
 *  um rolo = LIMPA as colunas (não apaga o rolo). "+ Endereço" cria um manual. */
export function EnderecoConsolidadoEditor({
  varianteId,
  rows,
  readOnly,
}: {
  varianteId: string;
  rows: EnderecoRollup[];
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, { rua: string; prateleira: string }>>({});

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["end-tecido-rollup"] });
    qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    qc.invalidateQueries({ queryKey: ["rolos"] });
    qc.invalidateQueries({ queryKey: ["end-tecido"] });
  };

  // Agrupa por ENDEREÇO (rua|prateleira). Mesmo vão com vários rolos/OCs vira UMA linha com
  // as origens listadas embaixo (em vez de repetir a linha). Endereços vazios (linha recém
  // adicionada) ficam individuais p/ poder digitar. Editar/remover age em TODOS os membros.
  type Grupo = { id: string; membros: EnderecoRollup[]; rua: string; prateleira: string; origens: string[] };
  const grupos: Grupo[] = useMemo(() => {
    const porEndereco = new Map<string, EnderecoRollup[]>();
    const vazios: EnderecoRollup[] = [];
    for (const r of rows) {
      const rua = (r.rua ?? "").trim();
      const prat = (r.prateleira ?? "").trim();
      if (!rua && !prat) { vazios.push(r); continue; }
      const k = `${rua}|${prat}`;
      porEndereco.set(k, [...(porEndereco.get(k) ?? []), r]);
    }
    const idDe = (ms: EnderecoRollup[]) => ms.map((m) => m.endereco_id ?? m.rolo_id ?? "").sort().join(",");
    const out: Grupo[] = [];
    for (const membros of porEndereco.values()) {
      out.push({
        id: idDe(membros),
        membros,
        rua: membros[0].rua ?? "",
        prateleira: membros[0].prateleira ?? "",
        origens: Array.from(new Set(membros.filter((m) => m.origem !== "manual" && m.origem_label).map((m) => m.origem_label))),
      });
    }
    for (const v of vazios) {
      out.push({ id: v.endereco_id ?? v.rolo_id ?? "", membros: [v], rua: v.rua ?? "", prateleira: v.prateleira ?? "", origens: [] });
    }
    return out;
  }, [rows]);

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("enderecamento_tecido" as any)
        .insert({ variante_tecido_id: varianteId, rua: "", prateleira: "" });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao adicionar endereço.")),
  });

  // Grava/remove em TODOS os membros do grupo (a mesma rua/prateleira física).
  const saveMut = useMutation({
    mutationFn: async (p: { membros: EnderecoRollup[]; rua: string; prat: string }) => {
      for (const m of p.membros) {
        if (m.endereco_id) {
          const { error } = await supabase.from("enderecamento_tecido" as any)
            .update({ rua: p.rua, prateleira: p.prat }).eq("id", m.endereco_id);
          if (error) throw error;
        } else if (m.rolo_id) {
          const { error } = await supabase.from("ocs_tecido")
            .update({ rolo_rua: p.rua.trim() || null, rolo_prateleira: p.prat.trim() || null }).eq("id", m.rolo_id);
          if (error) throw error;
        }
      }
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar endereço.")),
  });

  const delMut = useMutation({
    mutationFn: async (membros: EnderecoRollup[]) => {
      for (const m of membros) {
        if (m.endereco_id) {
          const { error } = await supabase.from("enderecamento_tecido" as any).delete().eq("id", m.endereco_id);
          if (error) throw error;
        } else if (m.rolo_id) {
          // remover endereço do rolo = limpar as colunas (NÃO apaga o rolo)
          const { error } = await supabase.from("ocs_tecido")
            .update({ rolo_rua: null, rolo_prateleira: null }).eq("id", m.rolo_id);
          if (error) throw error;
        }
      }
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao remover endereço.")),
  });

  const val = (g: Grupo) => draft[g.id] ?? { rua: g.rua, prateleira: g.prateleira };
  const setVal = (id: string, patch: Partial<{ rua: string; prateleira: string }>) =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? { rua: "", prateleira: "" }), ...patch } }));
  const commit = (g: Grupo) => {
    const v = val(g);
    if (v.rua !== g.rua || v.prateleira !== g.prateleira) saveMut.mutate({ membros: g.membros, rua: v.rua, prat: v.prateleira });
  };

  return (
    <div className="space-y-1.5">
      {grupos.length === 0 && <p className="text-xs text-muted-foreground">Sem endereço.</p>}
      {grupos.map((g) => {
        const v = val(g);
        return (
          <div key={g.id}>
            <div className="flex items-center gap-2">
              <Input className="flex-1" placeholder="Rua" value={v.rua} readOnly={readOnly}
                onChange={(e) => setVal(g.id, { rua: e.target.value })} onBlur={() => commit(g)} />
              <Input className="flex-1" placeholder="Prateleira" value={v.prateleira} readOnly={readOnly}
                onChange={(e) => setVal(g.id, { prateleira: e.target.value })} onBlur={() => commit(g)} />
              {!readOnly && (
                <Button size="iconSm" variant="ghost" onClick={() => delMut.mutate(g.membros)} aria-label="Remover endereço">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
            {g.origens.length > 0 && (
              <p className="ml-1 mt-0.5 text-[11px] text-muted-foreground">{g.origens.join(" · ")}</p>
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

/** Gatilho 📍 (Popover) para o endereço de UM ROLO (colunas ocs_tecido.rolo_rua/prateleira).
 *  Usado no recebimento por rolo e onde se endereça um rolo individual. Salva no blur. */
export function RoloEnderecoPopover({ roloId, readOnly }: { roloId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const [rua, setRua] = useState<string | null>(null);
  const [prat, setPrat] = useState<string | null>(null);

  const { data: rolo } = useQuery({
    queryKey: ["rolo-endereco", roloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido")
        .select("rolo_rua, rolo_prateleira")
        .eq("id", roloId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? { rolo_rua: null, rolo_prateleira: null }) as { rolo_rua: string | null; rolo_prateleira: string | null };
    },
  });

  const ruaV = rua ?? rolo?.rolo_rua ?? "";
  const pratV = prat ?? rolo?.rolo_prateleira ?? "";

  const saveMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("ocs_tecido")
        .update({ rolo_rua: ruaV.trim() || null, rolo_prateleira: pratV.trim() || null })
        .eq("id", roloId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rolo-endereco", roloId] });
      qc.invalidateQueries({ queryKey: ["end-tecido-rollup"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["rolos"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao endereçar rolo.")),
  });

  const filled = (rolo?.rolo_rua ?? "").trim() || (rolo?.rolo_prateleira ?? "").trim();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
          <MapPin className="h-3 w-3" />
          {filled ? (
            fmtEndereco({ rua: rolo?.rolo_rua, prateleira: rolo?.rolo_prateleira })
          ) : (
            <span className="text-muted-foreground">Endereço</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <p className="text-xs font-medium mb-2 flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> Endereço do rolo
        </p>
        <div className="flex items-center gap-2">
          <Input className="flex-1" placeholder="Rua" value={ruaV} readOnly={readOnly}
            onChange={(e) => setRua(e.target.value)}
            onBlur={() => { if (ruaV !== (rolo?.rolo_rua ?? "") || pratV !== (rolo?.rolo_prateleira ?? "")) saveMut.mutate(); }} />
          <Input className="flex-1" placeholder="Prateleira" value={pratV} readOnly={readOnly}
            onChange={(e) => setPrat(e.target.value)}
            onBlur={() => { if (ruaV !== (rolo?.rolo_rua ?? "") || pratV !== (rolo?.rolo_prateleira ?? "")) saveMut.mutate(); }} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
