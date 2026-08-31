import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, ArrowLeft, ChevronRight, ChevronDown } from "lucide-react";
import { format, parseISO } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { Label } from "@/components/ui/label";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterButton, filtroAtivoClass } from "@/components/shared/filters";
import { MobileActionBar } from "@/components/shared/MobileActionBar";

export const Route = createFileRoute("/_authenticated/admin/auditoria")({
  component: AuditoriaPage,
});

const PAGE = 50;

// Tom §Q9 por tipo de ação (campanha StatusBadge, ago/2026). "Resetou" (reset de loja,
// bem mais destrutivo que um "editou" comum) fica no mesmo tom danger de "Excluiu" — a
// paleta tem 5 tons só, sem um 6º pra diferenciar as duas ações destrutivas; o LABEL
// segue distinguindo ("Excluiu" vs "Resetou").
const ACAO_META: Record<string, { label: string; tone: StatusTone }> = {
  criar: { label: "Criou", tone: "success" },
  editar: { label: "Editou", tone: "warning" },
  excluir: { label: "Excluiu", tone: "danger" },
  resetar: { label: "Resetou", tone: "danger" },
};

// Rótulos PT p/ os campos do diff (nomes crus de coluna são incompreensíveis p/ o leigo).
// Fallback: prettify (tira _id, troca _ por espaço, capitaliza).
const CAMPO_LABEL: Record<string, string> = {
  nome: "Nome", codigo_nome: "Nome", ref: "Referência", numero_pedido: "Nº do pedido",
  numero_os: "Nº da OS", numero: "Número", preco: "Preço", preco_venda: "Preço de venda",
  quantidade: "Quantidade", status: "Status", ativo: "Ativo", role: "Papel",
  observacoes: "Observações", composicao: "Composição", ncm: "NCM",
  categoria_principal_id: "Categoria", categoria_secundaria_id: "Categoria secundária",
  subcategoria1_id: "Subcategoria 1", subcategoria2_id: "Subcategoria 2",
  grupo_id: "Grupo", linha_id: "Linha", cor_id: "Cor", cor_apelido_id: "Cor apelido",
  cor_base_id: "Cor base", empresa_id: "Fornecedor", representante_id: "Representante",
  material_aviamento_id: "Material", categoria_aviamento_id: "Categoria",
  modo_oc_rolo: "Modo OC/Rolo", modo_baixa_estoque: "Modo de baixa", timezone: "Fuso horário",
  data_prevista_entrega: "Data prevista", data_entrega: "Data de entrega",
  data_vencimento: "Vencimento", data_pagamento: "Pagamento", valor: "Valor", pago: "Pago",
  markup: "Markup", sla_oficina: "SLA (dias)", lancado: "Lançado", foto_url: "Foto",
};
const campoLabel = (k: string) =>
  CAMPO_LABEL[k] ??
  k.replace(/_id$/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const ENTIDADES = [
  "OC de Tecido", "OC de Aviamento", "Ordem de Saída (Tecido)", "Ordem de Saída (Aviamento)",
  "Item de Ordem de Saída (Aviamento)",
  "Modelo", "CAD", "Controle de Qualidade", "Baixa de Estoque", "Parcela (a pagar)",
  "Parcela de Serviço", "Lançamento", "Produção de Serviços", "Oficina",
  "Direcionamento", "Tecido", "Aviamento", "Colaborador", "Empresa", "Representante",
  "Configuração da Loja", "Usuário", "Permissões de Usuário", "Papel de Usuário",
  "Loja", "Identidade do Sistema",
];

type AuditRow = {
  id: string; tenant_id: string | null; user_nome: string | null;
  acao: string; entidade: string; tabela: string; descricao: string | null;
  dados: Record<string, { de: unknown; para: unknown }> | null; created_at: string;
};

// ── Legibilidade do diff (ago/2026): UUID→nome, fotos, arrays ──────────────
// O audit guarda valores CRUS. Sem tratamento a tela mostra UUID
// ("Estilista: — → 301cb509-…"), path de storage e JSON — indecifrável.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Campos que o RPC audit_resolver_referencias sabe resolver (FK → nome). Os de
// array (tecidos_planejados) são achatados item a item. Mantido em sincronia com
// o _map do RPC (migration 20260831190000).
const CAMPOS_FK = new Set([
  "estilista_id", "modelista_id", "piloteiro1_id", "piloteiro2_id", "piloteiro3_id",
  "recebimento_responsavel_id", "linha_id", "subcategoria1_id", "subcategoria2_id",
  "categoria_principal_id", "categoria_secundaria_id", "categoria_tecido_id",
  "categoria_aviamento_id", "subcategoria_aviamento_id", "colecao_id", "cor_id",
  "cor_apelido_id", "empresa_id", "representante_id", "material_aviamento_id",
  "conjunto_id", "mes_id", "ano_id", "tecidos_planejados",
]);

// Campos que guardam path(s) de storage — mostrar rótulo amigável, nunca o path.
const CAMPOS_FOTO = new Set([
  "croqui_url", "desenho_tecnico_url", "logo_url", "foto_url", "anexo_pedido_url",
  "comprovante_url", "nf_url", "fotos_modelo", "fotos_referencia",
  "etiqueta_lavagem_urls", "nfs", "nf_historico", "fotografado_variantes",
]);

// Ruído técnico — não mostrar no diff (decisão do dono: só ruído puro).
const CAMPOS_OCULTOS = new Set(["tenant_id", "rev", "ref_auto"]);
const ehCampoOculto = (k: string) => CAMPOS_OCULTOS.has(k) || /_at$/.test(k);

// Coleta os pares {campo, id} de UUID (escalar OU dentro de array) de um diff,
// só p/ campos FK — alimenta a chamada única do RPC por página.
function coletarPares(dados: Record<string, { de: unknown; para: unknown }>): { campo: string; id: string }[] {
  const out: { campo: string; id: string }[] = [];
  for (const [campo, d] of Object.entries(dados)) {
    if (!CAMPOS_FK.has(campo)) continue;
    for (const v of [d?.de, d?.para]) {
      if (typeof v === "string" && UUID_RE.test(v)) out.push({ campo, id: v });
      else if (Array.isArray(v)) for (const it of v) if (typeof it === "string" && UUID_RE.test(it)) out.push({ campo, id: it });
    }
  }
  return out;
}

// Um valor cru → texto legível. `nomes` = mapa UUID→nome do RPC.
function valLegivel(campo: string, v: unknown, nomes: Record<string, string>): string {
  if (v === null || v === undefined || v === "") return "—";

  // Fotos / arquivos: nunca mostrar path.
  if (CAMPOS_FOTO.has(campo)) {
    if (Array.isArray(v)) return v.length === 0 ? "—" : `📷 ${v.length} arquivo(s)`;
    return "📷 Arquivo";
  }

  // Array: FK → nomes; senão → contagem.
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    if (CAMPOS_FK.has(campo)) {
      const labels = v.map((it) => (typeof it === "string" && nomes[it]) || (typeof it === "string" && UUID_RE.test(it) ? "(removido)" : String(it)));
      return labels.join(", ");
    }
    return `${v.length} item(s)`;
  }

  // Objeto (JSON) → contagem de chaves (ininteligível cru).
  if (typeof v === "object") {
    const n = Object.keys(v as object).length;
    return n ? `${n} item(s)` : "—";
  }

  // Escalar: UUID de FK → nome; senão o próprio valor.
  const s = String(v);
  if (CAMPOS_FK.has(campo) && UUID_RE.test(s)) return nomes[s] ?? "(removido)";
  return s;
}

// Filtro de data no FUSO DA LOJA (created_at é timestamptz; string crua era lida em UTC →
// perdia eventos do fim do dia local). Converte o início do dia local para instante UTC.
function tzOffsetMin(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}
function utcStartOfLocalDay(dateStr: string, tz: string): string {
  const guess = new Date(`${dateStr}T00:00:00Z`);
  return new Date(guess.getTime() - tzOffsetMin(tz, guess) * 60000).toISOString();
}
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

  const tz = useStoreTimezone();
  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", page, acao, entidade, usuario, dataIni, dataFim, tenant, isSuperAdmin, tz],
    queryFn: async () => {
      let q = supabase
        .from("audit_log")
        .select("id, tenant_id, user_nome, acao, entidade, tabela, descricao, dados, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (acao !== "all") q = q.eq("acao", acao);
      if (entidade !== "all") q = q.eq("entidade", entidade);
      if (usuario.trim()) q = q.ilike("user_nome", `%${usuario.trim()}%`);
      // Limites no fuso da loja: [início do dia De, início do dia seguinte a Até).
      if (dataIni) q = q.gte("created_at", utcStartOfLocalDay(dataIni, tz));
      if (dataFim) q = q.lt("created_at", utcStartOfLocalDay(addDaysStr(dataFim, 1), tz));
      if (isSuperAdmin && tenant !== "all") q = q.eq("tenant_id", tenant);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as AuditRow[], total: count ?? 0 };
    },
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE));

  // Resolve os UUID de FK (escalar ou em array) de TODA a página → nome, numa
  // única chamada ao RPC. Fallback = "(removido)" p/ registro apagado.
  const { data: nomes = {} } = useQuery({
    queryKey: ["audit-nomes", rows.map((r) => r.id).join(",")],
    enabled: rows.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const pares = rows.flatMap((r) => (r.dados ? coletarPares(r.dados) : []));
      if (pares.length === 0) return {};
      // dedup
      const seen = new Set<string>();
      const uniq = pares.filter((p) => {
        const k = `${p.campo}|${p.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const { data, error } = await supabase.rpc("audit_resolver_referencias" as any, { _pares: uniq });
      if (error) throw error;
      return (data ?? {}) as Record<string, string>;
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
      <Button asChild variant="ghost" size="sm" className="max-sm:hidden -ml-2 w-fit text-muted-foreground">
        <Link to="/admin"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao Admin</Link>
      </Button>
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <ScrollText className="h-7 w-7 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-tight">Auditoria</h1>
            <p className="text-sm text-muted-foreground">
              Registro automático de todos os eventos: criado, editado ou excluído, por quem e quando.
            </p>
          </div>
        </div>
        <FilterButton activeCount={activeCount} onClear={reset}>
          <div className="grid gap-1">
            <Label className="text-xs">Ação</Label>
            <Select value={acao} onValueChange={(v) => onFilter(() => setAcao(v))}>
              <SelectTrigger className={`h-8 max-md:h-11 text-sm ${filtroAtivoClass(acao !== "all")}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="criar">Criou</SelectItem>
                <SelectItem value="editar">Editou</SelectItem>
                <SelectItem value="excluir">Excluiu</SelectItem>
                <SelectItem value="resetar">Resetou</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Entidade</Label>
            <Select value={entidade} onValueChange={(v) => onFilter(() => setEntidade(v))}>
              <SelectTrigger className={`h-8 max-md:h-11 text-sm ${filtroAtivoClass(entidade !== "all")}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {ENTIDADES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Usuário</Label>
            <Input className={`h-8 max-md:h-11 text-sm ${filtroAtivoClass(!!usuario)}`} value={usuario} onChange={(e) => onFilter(() => setUsuario(e.target.value))} placeholder="Nome ou e-mail" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">De</Label>
              <DateField className="text-sm" value={dataIni} onChange={(e) => onFilter(() => setDataIni(e.target.value))} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Até</Label>
              <DateField className="text-sm" value={dataFim} onChange={(e) => onFilter(() => setDataFim(e.target.value))} />
            </div>
          </div>
          {isSuperAdmin && (
            <div className="grid gap-1">
              <Label className="text-xs">Loja</Label>
              <Select value={tenant} onValueChange={(v) => onFilter(() => setTenant(v))}>
                <SelectTrigger className={`h-8 max-md:h-11 text-sm ${filtroAtivoClass(tenant !== "all")}`}><SelectValue /></SelectTrigger>
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
        {!isLoading && total > 0 && (
          <p className="text-xs text-muted-foreground">{total} evento{total === 1 ? "" : "s"}</p>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum evento encontrado.</p>
        ) : (
          rows.map((r) => {
            const meta = ACAO_META[r.acao] ?? { label: r.acao, tone: "neutral" as StatusTone };
            // Campos visíveis = todos menos o ruído técnico (tenant_id, rev, ref_auto, *_at).
            const campos = r.dados ? Object.entries(r.dados).filter(([k]) => !ehCampoOculto(k)) : [];
            const temDiff = campos.length > 0;
            const open = expanded === r.id;
            const head = (
              <>
                <StatusBadge tone={meta.tone} className="shrink-0">{meta.label}</StatusBadge>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium">{r.descricao ?? `${meta.label} ${r.entidade}`}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.user_nome ?? "—"} · {format(parseISO(r.created_at), "dd/MM/yyyy HH:mm")}
                    {temDiff ? ` · ${campos.length} campo(s)` : ""}
                  </div>
                </div>
                {temDiff ? (open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />) : null}
              </>
            );
            return (
              <Card key={r.id} className="overflow-hidden">
                {temDiff ? (
                  <button type="button" className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/50" onClick={() => setExpanded(open ? null : r.id)}>
                    {head}
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-3 p-3 text-left">{head}</div>
                )}
                {open && temDiff && (
                  <div className="border-t bg-muted/30 px-4 py-3 text-xs">
                    <p className="mb-1.5 font-semibold text-muted-foreground">Alterações</p>
                    <ul className="space-y-1.5">
                      {campos.map(([campo, d]) => (
                        <li key={campo} className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-1">
                          <span className="font-medium">{campoLabel(campo)}:</span>
                          <span className="flex flex-wrap items-baseline gap-1 break-words">
                            <span className="text-muted-foreground line-through">{valLegivel(campo, d?.de, nomes)}</span>
                            <span>→</span>
                            <span>{valLegivel(campo, d?.para, nomes)}</span>
                          </span>
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">Página {page + 1} de {totalPages} · {total} eventos</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
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
