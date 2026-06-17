import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type Obs = { id: string; ordem: number | null; descricao: string | null; observacao: string | null };

const tecLabel = (tipo: string, numero: number) => {
  const cap = tipo ? tipo.charAt(0).toUpperCase() + tipo.slice(1) : "Tecido";
  if (tipo === "tecido") return `Tecido ${numero}`;
  return numero > 1 ? `${cap} ${numero}` : cap;
};

/**
 * Observações do modelo (descrição | observação), editáveis no Desenvolvimento
 * e em Serviços. A 1ª linha é automática: "Composição" com a composição de cada
 * tecido (um por linha), derivada em tempo real (read-only).
 */
export function ModeloObservacoes({ modeloId, readOnly = false }: { modeloId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const key = ["modelo-observacoes", modeloId];

  const { data: obs = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_observacoes" as any)
        .select("id, ordem, descricao, observacao")
        .eq("modelo_id", modeloId)
        .order("ordem")
        .order("created_at");
      if (error) throw error;
      return ((data ?? []) as unknown) as Obs[];
    },
  });

  // Composição automática a partir dos tecidos do modelo.
  const { data: composicao = "" } = useQuery({
    queryKey: ["modelo-composicao", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecidos")
        .select("numero, tipo, artigos:artigo_id(composicao)")
        .eq("modelo_id", modeloId)
        .order("tipo")
        .order("numero");
      if (error) throw error;
      const linhas = (data ?? [])
        .map((t: any) => {
          const c = (t.artigos?.composicao ?? "").trim();
          // % na mesma linha separadas por " | "; cada linha = um tecido.
          return c ? `${tecLabel(t.tipo, t.numero)}: ${c.replace(/\s*[,;]\s*/g, " | ")}` : null;
        })
        .filter(Boolean);
      return linhas.join("\n");
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const addMut = useMutation({
    mutationFn: async () => {
      const ordem = (obs.reduce((m, o) => Math.max(m, o.ordem ?? 0), 0) || 0) + 1;
      const { error } = await supabase.from("modelo_observacoes" as any).insert({ modelo_id: modeloId, ordem, descricao: "", observacao: "" });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message ?? "Erro ao adicionar."),
  });

  const updMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Obs> }) => {
      const { error } = await supabase.from("modelo_observacoes" as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar."),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("modelo_observacoes" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message ?? "Erro ao remover."),
  });

  const composicaoText = useMemo(() => composicao || "—", [composicao]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Observações</CardTitle>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => addMut.mutate()} disabled={addMut.isPending}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Linha automática: Composição */}
        <div className="grid gap-2 sm:grid-cols-[200px_1fr] items-start rounded-md border bg-muted/30 p-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Composição</span>
            <Badge variant="secondary" className="text-[10px]">auto</Badge>
          </div>
          <div className="text-sm whitespace-pre-wrap">{composicaoText}</div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…</div>
        ) : (
          obs.map((o) => (
            <div key={o.id} className="grid gap-2 sm:grid-cols-[200px_1fr_auto] items-start">
              <Input
                defaultValue={o.descricao ?? ""}
                placeholder="Descrição"
                readOnly={readOnly}
                onBlur={(e) => { if (e.target.value !== (o.descricao ?? "")) updMut.mutate({ id: o.id, patch: { descricao: e.target.value } }); }}
              />
              <Textarea
                defaultValue={o.observacao ?? ""}
                placeholder="Observação"
                rows={2}
                readOnly={readOnly}
                onBlur={(e) => { if (e.target.value !== (o.observacao ?? "")) updMut.mutate({ id: o.id, patch: { observacao: e.target.value } }); }}
              />
              {!readOnly && (
                <Button size="icon" variant="ghost" onClick={() => delMut.mutate(o.id)} aria-label="Remover observação">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
