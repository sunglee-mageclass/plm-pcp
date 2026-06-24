import { SkeletonTableRow } from "@/components/shared/Skeletons";
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Wrench, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { RevisaoErroBadge } from "@/components/producao/RevisaoErro";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { EmptyState } from "@/components/shared/EmptyState";

export const Route = createFileRoute("/_authenticated/producao/oficina/")({
  component: OficinaListPage,
});

function OficinaListPage() {
  const fl = useFieldLabels();
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useState("all");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["producao-oficina-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select(
          "id, ref, versao, nome, colecao, mes_id, ano_id, revisao_pendente, categorias_produto:categoria_principal_id(nome), cad(enviado_corte)",
        )
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Só aparece após o CAD ser confirmado.
      return (data ?? []).filter((m: any) => m.cad?.[0]?.enviado_corte === true).map((m: any) => ({
        modelo_id: m.id,
        ref: m.ref,
        versao: m.versao,
        nome: m.nome,
        colecao: m.colecao,
        mes_id: m.mes_id,
        ano_id: m.ano_id,
        categoria_nome: m.categorias_produto?.nome ?? null,
        revisao_pendente: m.revisao_pendente,
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
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Wrench className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Oficina</h1>
          <p className="text-sm text-muted-foreground">Costura e montagem por REF.</p>
        </div>
      </header>

      <div className="flex items-center justify-end gap-2">
        <SearchToggle value={q} onChange={setQ} placeholder={`${fl("ref")} ou nome…`} />
        <FilterButton
          filters={[
            { label: "Coleção", value: fColecao, onChange: setFColecao, options: [{ id: "all", nome: "Todas coleções" }, ...colecoes.map((c) => ({ id: c, nome: c }))] },
            { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos meses" }, ...(meses as any[]).map((m) => ({ id: m.id, nome: m.nome }))] },
            { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos anos" }, ...(anos as any[]).map((a) => ({ id: a.id, nome: a.nome }))] },
          ]}
        />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm card-table">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2">{fl("ref")}</th>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Categoria</th>
              <th className="px-4 py-2">Coleção</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <SkeletonTableRow cols={4} />
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={4} className="p-0"><EmptyState icon={Wrench} title="Nenhum modelo disponível" description="Modelos enviados à oficina aparecerão aqui." className="border-0 rounded-none" /></td></tr>
            )}
            {filtered.map((r: any) => (
              <tr key={r.modelo_id} className="border-t hover:bg-muted/30">
                <td className="px-4 py-2">
                  <Link to="/producao/oficina/$modeloId" params={{ modeloId: r.modelo_id }} className="font-mono text-primary hover:underline">
                    {r.ref ?? "—"}
                  </Link>
                  <VersaoBadge versao={r.versao} className="ml-2 text-[10px]" />
                  <span className="ml-2"><RevisaoErroBadge revisao={r.revisao_pendente} etapa="oficina" /></span>
                </td>
                <td className="px-4 py-2" data-label="Nome">
                  <Link to="/producao/oficina/$modeloId" params={{ modeloId: r.modelo_id }} className="hover:underline">
                    {r.nome ?? "—"}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Categoria">{r.categoria_nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Coleção">{r.colecao ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
