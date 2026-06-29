import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, ArrowLeft, ChevronRight, ChevronDown } from "lucide-react";
import { format, parseISO } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterButton } from "@/components/shared/filters";
import { MobileActionBar } from "@/components/shared/MobileActionBar";

export const Route = createFileRoute("/_authenticated/admin/auditoria")({
  component: AuditoriaPage,
});

const PAGE = 50;

const ACAO_META: Record<string, { label: string; cls: string }> = {
  criar: { label: "Criou", cls: "bg-emerald-500 hover:bg-emerald-500" },
  editar: { label: "Editou", cls: "bg-amber-500 hover:bg-amber-500" },
  excluir: { label: "Excluiu", cls: "bg-red-500 hover:bg-red-500" },
};

const ENTIDADES = [
  "OC de Tecido", "OC de Aviamento", "Ordem de Saída (Tecido)", "Ordem de Saída (Aviamento)",
  "Modelo", "CAD", "Controle de Qualidade", "Baixa de Estoque", "Parcela (a pagar)",
  "Parcela de Serviço", "Lançamento", "Produção de Serviços", "Oficina", "Acabamento",
  "Direcionamento", "Tecido", "Aviamento", "Colaborador", "Empresa", "Representante",
  "Configuração da Loja", "Usuário", "Permissões de Usuário", "Loja", "Identidade do Sistema",
];

type AuditRow = {
  id: string; tenant_id: string | null; user_nome: string | null;
  acao: string; entidade: string; tabela: string; descricao: string | null;
  dados: Record<string, { de: unknown; para: unknown }> | null; created_at: string;
};

const fmtVal = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

function AuditoriaPage() {
  const { isSuperAdmin, isTenantAdmin, loading } = useAuth();
  const [page, setPage] = useState(0);
  const [acao, setAcao] = useState("all");
  const [entidade, setEntidade] = useState("all");
  const [usuario, setUsuario] = useState("");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [tenant, setTenant] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: lojas = [] } = useQuery({
    queryKey: ["audit-lojas"],
    enabled: isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("id, nome").order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["audit-log", page, acao, entidade, usuario, dataIni, dataFim, tenant, isSuperAdmin],
    queryFn: async () => {
      let q = supabase
        .from("audit_log")
        .select("id, tenant_id, user_nome, acao, entidade, tabela, descricao, dados, created_at")
        .order("created_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (acao !== "all") q = q.eq("acao", acao);
      if (entidade !== "all") q = q.eq("entidade", entidade);
      if (usuario.trim()) q = q.ilike("user_nome", `%${usuario.trim()}%`);
      if (dataIni) q = q.gte("created_at", dataIni);
      if (dataFim) q = q.lte("created_at", `${dataFim}T23:59:59`);
      if (isSuperAdmin && tenant !== "all") q = q.eq("tenant_id", tenant);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  if (loading) return null;
  if (!isSuperAdmin && !isTenantAdmin) return <Navigate to="/" replace />;

  const reset = () => {
    setAcao("all"); setEntidade("all"); setUsuario(""); setDataIni(""); setDataFim(""); setTenant("all"); setPage(0);
  };
  const onFilter = (fn: () => void) => { fn(); setPage(0); };
  const activeCount = [
    acao !== "all", entidade !== "all", usuario.trim() !== "",
    dataIni !== "", dataFim !== "", isSuperAdmin && tenant !== "all",
  ].filter(Boolean).length;

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <ScrollText className="h-7 w-7 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Auditoria</h1>
            <p className="text-sm text-muted-foreground">
              Registro automático de todos os eventos: criado, editado ou excluído, por quem e quando.
            </p>
          </div>
        </div>
        <FilterButton activeCount={activeCount} onClear={reset}>
          <div className="grid gap-1">
            <Label className="text-xs">Ação</Label>
            <Select value={acao} onValueChange={(v) => onFilter(() => setAcao(v))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="criar">Criou</SelectItem>
                <SelectItem value="editar">Editou</SelectItem>
                <SelectItem value="excluir">Excluiu</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Entidade</Label>
            <Select value={entidade} onValueChange={(v) => onFilter(() => setEntidade(v))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {ENTIDADES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Usuário</Label>
            <Input className="h-8 text-sm" value={usuario} onChange={(e) => onFilter(() => setUsuario(e.target.value))} placeholder="Nome ou e-mail" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">De</Label>
              <Input className="h-8 text-sm" type="date" value={dataIni} onChange={(e) => onFilter(() => setDataIni(e.target.value))} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Até</Label>
              <Input className="h-8 text-sm" type="date" value={dataFim} onChange={(e) => onFilter(() => setDataFim(e.target.value))} />
            </div>
          </div>
          {isSuperAdmin && (
            <div className="grid gap-1">
              <Label className="text-xs">Loja</Label>
              <Select value={tenant} onValueChange={(v) => onFilter(() => setTenant(v))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as lojas</SelectItem>
                  {lojas.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </FilterButton>
      </header>

      {/* Lista */}
      <div className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum evento encontrado.</p>
        ) : (
          rows.map((r) => {
            const meta = ACAO_META[r.acao] ?? { label: r.acao, cls: "bg-zinc-500" };
            const temDiff = r.dados && Object.keys(r.dados).length > 0;
            const open = expanded === r.id;
            return (
              <Card key={r.id} className="overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/50"
                  onClick={() => setExpanded(open ? null : r.id)}
                >
                  <Badge className={meta.cls + " shrink-0"}>{meta.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.descricao ?? `${meta.label} ${r.entidade}`}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.user_nome ?? "—"} · {format(parseISO(r.created_at), "dd/MM/yyyy HH:mm")}
                    </div>
                  </div>
                  {temDiff ? (open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />) : null}
                </button>
                {open && temDiff && (
                  <div className="border-t bg-muted/30 px-4 py-3 text-xs">
                    <p className="mb-1.5 font-semibold text-muted-foreground">Alterações</p>
                    <ul className="space-y-1">
                      {Object.entries(r.dados!).map(([campo, d]) => (
                        <li key={campo} className="flex flex-wrap items-baseline gap-1">
                          <span className="font-medium">{campo}:</span>
                          <span className="text-muted-foreground line-through">{fmtVal(d?.de)}</span>
                          <span>→</span>
                          <span>{fmtVal(d?.para)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* Paginação */}
      {(page > 0 || rows.length === PAGE) && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">Página {page + 1}</span>
          <Button variant="outline" size="sm" disabled={rows.length < PAGE} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}

      <MobileActionBar>
        <Button asChild variant="outline" size="icon" aria-label="Voltar">
          <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
      </MobileActionBar>
    </div>
  );
}
