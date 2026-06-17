import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/producao/cq/")({
  component: CqListPage,
});

function CqListPage() {
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useState("all");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["producao-cq-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, versao, nome, colecao, mes_id, ano_id, categorias_produto:categoria_principal_id(nome), cad(enviado_corte, producao_terceirizados(data_entregue, ativo))")
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // CQ só ativa quando o Status Geral dos Serviços é "Finalizado"
      // (todos os serviços ativos entregues, e há ao menos um).
      return (data ?? [])
        .filter((m: any) => {
          const tercs = (m.cad?.[0]?.producao_terceirizados ?? []).filter((t: any) => t.ativo !== false);
          return tercs.length > 0 && tercs.every((t: any) => !!t.data_entregue);
        })
        .map((m: any) => ({
        modelo_id: m.id, ref: m.ref, versao: m.versao, nome: m.nome, colecao: m.colecao,
        mes_id: m.mes_id, ano_id: m.ano_id,
        categoria_nome: m.categorias_produto?.nome ?? null,
      }));
    },
  });

  const { data: meses = [] } = useQuery({
    queryKey: ["opt", "meses"],
    queryFn: async () => (await supabase.from("meses").select("id, nome:mes").order("mes")).data ?? [],
  });
  const { data: anos = [] } = useQuery({
    queryKey: ["opt", "anos"],
    queryFn: async () => (await supabase.from("anos").select("id, nome:ano").order("ano")).data ?? [],
  });
  const colecoes = useMemo(
    () => Array.from(new Set(rows.map((r: any) => r.colecao).filter(Boolean))) as string[],
    [rows],
  );

  const filtered = (rows as any[]).filter((r) => {
    if (q && !`${r.ref ?? ""} ${r.nome ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (fColecao !== "all" && r.colecao !== fColecao) return false;
    if (fMes !== "all" && r.mes_id !== fMes) return false;
    if (fAno !== "all" && r.ano_id !== fAno) return false;
    return true;
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <ClipboardCheck className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Controle de Qualidade</h1>
          <p className="text-sm text-muted-foreground">Recebimento, conserto, lavagem e defeito por REF.</p>
        </div>
      </header>

      <Card className="p-4 grid gap-3 md:grid-cols-5">
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
        <Select value={fMes} onValueChange={setFMes}>
          <SelectTrigger><SelectValue placeholder="Mês" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos meses</SelectItem>
            {(meses as any[]).map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fAno} onValueChange={setFAno}>
          <SelectTrigger><SelectValue placeholder="Ano" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos anos</SelectItem>
            {(anos as any[]).map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
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
            {isLoading && (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={4}>Carregando…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={4}>Nenhum modelo disponível.</td></tr>
            )}
            {filtered.map((r: any) => (
              <tr key={r.modelo_id} className="border-t hover:bg-muted/30">
                <td className="px-4 py-2">
                  <Link to="/producao/cq/$modeloId" params={{ modeloId: r.modelo_id }} className="font-mono text-primary hover:underline">
                    {r.ref ?? "—"}
                  </Link>
                  <VersaoBadge versao={r.versao} className="ml-2 text-[10px]" />
                </td>
                <td className="px-4 py-2">
                  <Link to="/producao/cq/$modeloId" params={{ modeloId: r.modelo_id }} className="hover:underline">
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
