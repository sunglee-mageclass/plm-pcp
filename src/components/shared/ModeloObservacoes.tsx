import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { corApelidoLabel } from "@/lib/variante";

type Obs = { id: string; ordem: number | null; descricao: string | null; observacao: string | null };
type BlocoComp = { label: string; composicao: string; variantes: string[] };

const tecLabel = (tipo: string, numero: number) => {
  const cap = tipo ? tipo.charAt(0).toUpperCase() + tipo.slice(1) : "Tecido";
  if (tipo === "tecido") return `Tecido ${numero}`;
  return numero > 1 ? `${cap} ${numero}` : cap;
};

// Ordem fixa dos blocos: Tecido → Forro → Entretela (depois, por número).
const TIPO_RANK: Record<string, number> = { tecido: 0, forro: 1, entretela: 2 };
const tipoRank = (t: string) => TIPO_RANK[t] ?? 99;

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

  // Composição automática a partir dos tecidos do modelo (+ variantes de cada um).
  const { data: blocos = [] } = useQuery<BlocoComp[]>({
    queryKey: ["modelo-composicao", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecidos")
        .select("numero, tipo, artigos:artigo_id(composicao), variantes:modelo_tecido_variantes(ordem, variantes_tecido:variante_tecido_id(cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
        .eq("modelo_id", modeloId);
      if (error) throw error;
      return (data ?? [])
        .map((t: any) => ({
          rank: tipoRank(t.tipo),
          numero: Number(t.numero) || 0,
          label: tecLabel(t.tipo, t.numero),
          composicao: (t.artigos?.composicao ?? "").replace(/\s+/g, " ").trim(),
          variantes: [...(t.variantes ?? [])]
            .sort((a: any, b: any) => (a.ordem ?? 0) - (b.ordem ?? 0))
            .map((v: any) => corApelidoLabel(v.variantes_tecido?.cor?.nome, v.variantes_tecido?.apelido?.nome))
            .filter((s: string) => s && s !== "—"),
        }))
        .filter((b: any) => b.composicao || b.variantes.length)
        // Ordem fixa: Tecido → Forro → Entretela → (outros), depois por número.
        .sort((a: any, b: any) => a.rank - b.rank || a.numero - b.numero)
        .map(({ label, composicao, variantes }: any) => ({ label, composicao, variantes }));
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
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao adicionar.")),
  });

  const updMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Obs> }) => {
      const { error } = await supabase.from("modelo_observacoes" as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("modelo_observacoes" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao remover.")),
  });

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
          <div className="text-sm space-y-1.5">
            {blocos.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              blocos.map((b, i) => (
                <div key={i}>
                  <div>
                    <span className="font-semibold">{b.label}:</span>
                    {b.composicao ? ` ${b.composicao}` : ""}
                  </div>
                  {b.variantes.map((v, j) => (
                    <div key={j} className="text-xs text-muted-foreground pl-2">{v}</div>
                  ))}
                </div>
              ))
            )}
          </div>
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
