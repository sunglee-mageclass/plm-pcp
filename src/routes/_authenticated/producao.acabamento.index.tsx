import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { RevisaoErroBadge } from "@/components/producao/RevisaoErro";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/producao/acabamento/")({
  component: AcabListPage,
});

function AcabListPage() {
  const fl = useFieldLabels();
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useState("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["producao-acab-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, versao, nome, colecao, revisao_pendente, categorias_produto:categoria_principal_id(nome), cad(enviado_corte)")
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Só aparece após o CAD ser confirmado.
      return (data ?? []).filter((m: any) => m.cad?.[0]?.enviado_corte === true).map((m: any) => ({
        modelo_id: m.id, ref: m.ref, versao: m.versao, nome: m.nome, colecao: m.colecao,
        categoria_nome: m.categorias_produto?.nome ?? null,
        revisao_pendente: m.revisao_pendente,
      }));
    },
  });

  const colecoes = useMemo(
    () => Array.from(new Set(rows.map((r: any) => r.colecao).filter(Boolean))) as string[],
    [rows],
  );
  const filtered = (rows as any[]).filter((r) => {
    if (q && !`${r.ref ?? ""} ${r.nome ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (fColecao !== "all" && r.colecao !== fColecao) return false;
    return true;
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Sparkles className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Acabamento</h1>
          <p className="text-sm text-muted-foreground">Etapas de acabamento por REF.</p>
        </div>
      </header>

      <Card className="p-4 grid gap-3 md:grid-cols-3">
        <div className="relative md:col-span-2">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder={`${fl("ref")} ou nome…`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={fColecao} onValueChange={setFColecao}>
          <SelectTrigger><SelectValue placeholder="Coleção" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas coleções</SelectItem>
            {colecoes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2">{fl("ref")}</th>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Categoria</th>
              <th className="px-4 py-2">Coleção</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={4}>Carregando…</td></tr>}
            {!isLoading && filtered.length === 0 && (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={4}>Nenhum modelo disponível.</td></tr>
            )}
            {filtered.map((r: any) => (
              <tr key={r.modelo_id} className="border-t hover:bg-muted/30">
                <td className="px-4 py-2">
                  <Link to="/producao/acabamento/$modeloId" params={{ modeloId: r.modelo_id }} className="font-mono text-primary hover:underline">
                    {r.ref ?? "—"}
                  </Link>
                  <VersaoBadge versao={r.versao} className="ml-2 text-[10px]" />
                  <span className="ml-2"><RevisaoErroBadge revisao={r.revisao_pendente} etapa="acabamento" /></span>
                </td>
                <td className="px-4 py-2">
                  <Link to="/producao/acabamento/$modeloId" params={{ modeloId: r.modelo_id }} className="hover:underline">
                    {r.nome ?? "—"}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{r.categoria_nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.colecao ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
