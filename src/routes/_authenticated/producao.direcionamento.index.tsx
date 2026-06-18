import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Compass, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/producao/direcionamento/")({
  component: DirListPage,
});

function DirListPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useState("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["dir-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, versao, nome, colecao, categorias_produto:categoria_principal_id(nome), cad(controle_qualidade(status))")
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Só aparece após o Controle de Qualidade ser Confirmado.
      return (data ?? [])
        .filter((m: any) => (m.cad?.[0]?.controle_qualidade?.[0]?.status ?? "pendente") === "confirmado")
        .map((m: any) => ({
          modelo_id: m.id, ref: m.ref, versao: m.versao, nome: m.nome, colecao: m.colecao,
          categoria_nome: m.categorias_produto?.nome ?? null,
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
        <Compass className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Direcionamento</h1>
          <p className="text-sm text-muted-foreground">Distribuição entre E-commerce e Loja Física.</p>
        </div>
      </header>

      <Card className="p-4 grid gap-3 md:grid-cols-3">
        <div className="relative md:col-span-2">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="REF ou nome…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={fColecao} onValueChange={setFColecao}>
          <SelectTrigger><SelectValue placeholder="Coleção" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas coleções</SelectItem>
            {colecoes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2">REF</th>
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
              <tr
                key={r.modelo_id}
                className="border-t hover:bg-muted/30 cursor-pointer"
                onClick={() => navigate({ to: "/producao/direcionamento/$modeloId", params: { modeloId: r.modelo_id } })}
              >
                <td className="px-4 py-2">
                  <span className="font-mono text-primary">{r.ref ?? "—"}</span>
                  <VersaoBadge versao={r.versao} className="ml-2 text-[10px]" />
                </td>
                <td className="px-4 py-2">{r.nome ?? "—"}</td>
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
