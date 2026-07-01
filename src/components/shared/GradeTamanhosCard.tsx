import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DEFAULT_GRADE = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];

/**
 * Grade de tamanhos da loja (tenant_config.tamanhos_grade). Antes ficava na Config da Loja;
 * agora é cadastrada aqui (Cadastro > Atributos). Formato "Número|Sigla" (ex.: 38|P); a ordem
 * define as colunas das grades no desenvolvimento/CAD/CQ.
 */
export function GradeTamanhosCard() {
  const qc = useQueryClient();
  const tenantId = useActiveTenantId();
  const [draft, setDraft] = useState("");

  const gradeKey = ["tenant-config-grade", tenantId];
  const { data: items = [] } = useQuery({
    queryKey: gradeKey,
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from("tenant_config")
        .select("tamanhos_grade")
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      const g = (data as any)?.tamanhos_grade;
      return Array.isArray(g) ? (g as string[]) : DEFAULT_GRADE;
    },
  });

  const save = useMutation({
    mutationFn: async (next: string[]) => {
      const { error } = await supabase
        .from("tenant_config")
        .upsert({ tenant_id: tenantId, tamanhos_grade: next } as any, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onMutate: (next) => qc.setQueryData(gradeKey, next), // otimista
    onError: (e: any) => {
      toast.error(mensagemErro(e, "Erro ao salvar a grade."));
      qc.invalidateQueries({ queryKey: gradeKey });
    },
    // A grade é lida em várias telas sob prefixos diferentes (tenant_config, ...-grade).
    onSuccess: () => qc.invalidateQueries(),
  });

  const commit = (next: string[]) => save.mutate(next);
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) return toast.error("Tamanho já existe.");
    commit([...items, v]);
    setDraft("");
  };
  const remove = (i: number) => commit(items.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Formato <b>Número|Sigla</b> (ex.: <code>38|P</code>). A <b>ordem</b> define as colunas das grades.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="Ex: 38|P"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <Button type="button" variant="secondary" onClick={add}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
      </div>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={`${i}::${it}`} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <span className="flex-1 text-sm">{it}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Descer">
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(i)} aria-label="Remover">
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
        {items.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nenhum tamanho.</li>}
      </ul>
    </div>
  );
}
