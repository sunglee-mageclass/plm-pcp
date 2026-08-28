import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Tags, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { AttributeTab, type AttributeTabConfig } from "@/components/attribute-tab";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erro-mensagem";
import { isServicoConfeccao, isServicoPL } from "@/lib/servico-confeccao";

import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { GradeTamanhosCard } from "@/components/shared/GradeTamanhosCard";

export const Route = createFileRoute("/_authenticated/cadastro/atributos")({
  component: () => (
    <RequirePermission page="cadastro_atributos">
      <AtributosPage />
    </RequirePermission>
  ),
});

type GroupKey = "GERAL" | "FORNECEDOR" | "TECIDO" | "AVIAMENTO" | "PRODUTO" | "SERVIÇO";

type AttributeItem = {
  value: string;
  label: string;
  group: GroupKey;
  config?: AttributeTabConfig;
  custom?: "grade"; // seção especial (não é tabela): Grade de Tamanhos (tenant_config)
};

const ATTRIBUTES: AttributeItem[] = [
  {
    value: "cores",
    label: "Cor base",
    group: "GERAL",
    config: {
      table: "cores",
      nameField: "nome",
      singular: "Cor base",
      plural: "Cores base",
      usage: [
        { table: "variantes_tecido", column: "cor_id" },
        { table: "aviamentos", column: "cor_id" }, // SET NULL — some em silêncio se não contar
        { table: "cores_apelido", column: "cor_base_id" },
      ],
    },
  },
  {
    value: "cores_apelido",
    label: "Cor apelido",
    group: "GERAL",
    config: {
      table: "cores_apelido",
      nameField: "nome",
      singular: "Cor apelido",
      plural: "Cores apelido",
      // Cada apelido pertence a uma Cor base (obrigatório).
      extra: { field: "cor_base_id", label: "Cor base", from: "cores", optionLabel: "nome", required: true },
      usage: [
        { table: "aviamentos", column: "cor_apelido_id" }, // SET NULL
        { table: "variantes_tecido", column: "cor_apelido_id" },
      ],
    },
  },
  {
    value: "anos",
    label: "Ano",
    group: "GERAL",
    config: {
      table: "anos",
      nameField: "ano",
      singular: "Ano",
      plural: "Anos",
      usage: [
        { table: "artigos", column: "ano_id" },
        { table: "modelos", column: "ano_id" },
        { table: "colecoes", column: "ano_id" },
      ],
    },
  },
  {
    value: "meses",
    label: "Mês",
    group: "GERAL",
    config: {
      table: "meses",
      nameField: "mes",
      singular: "Mês",
      plural: "Meses",
      // Os 12 meses são fixos: dá pra renomear a nomenclatura (01/Jan/JAN/Janeiro),
      // mas não criar nem excluir; a ordem cronológica vem da coluna `ordem`.
      fixed: true,
      orderField: "ordem",
      usage: [
        { table: "artigos", column: "mes_id" },
        { table: "modelos", column: "mes_id" },
      ],
    },
  },
  {
    value: "cat_fornecedor",
    label: "Categoria do Fornecedor",
    group: "FORNECEDOR",
    config: {
      table: "categorias_fornecedor",
      nameField: "nome",
      singular: "Categoria de Fornecedor",
      plural: "Categorias de Fornecedor",
      usage: [
        { table: "empresa_categorias_fornecedor", column: "categoria_fornecedor_id" },
        { table: "empresas", column: "categoria_fornecedor_id" },
      ],
    },
  },
  {
    value: "cat_tecido",
    label: "Categoria do Tecido",
    group: "TECIDO",
    config: {
      table: "categorias_tecido",
      nameField: "nome",
      singular: "Categoria de Tecido",
      plural: "Categorias de Tecido",
      usage: [
        { table: "artigo_categorias_tecido", column: "categoria_tecido_id" },
        { table: "artigos", column: "categoria_tecido_id" },
      ],
    },
  },
  {
    value: "cat_aviamento",
    label: "Categoria",
    group: "AVIAMENTO",
    config: {
      table: "categorias_aviamento",
      nameField: "nome",
      singular: "Categoria de Aviamento",
      plural: "Categorias de Aviamento",
      usage: [
        { table: "aviamentos", column: "categoria_aviamento_id" },
        { table: "subcategorias_aviamento", column: "categoria_aviamento_id" },
      ],
    },
  },
  {
    value: "subcat_aviamento",
    label: "Subcategoria",
    group: "AVIAMENTO",
    config: {
      table: "subcategorias_aviamento",
      nameField: "nome",
      singular: "Subcategoria de Aviamento",
      plural: "Subcategorias de Aviamento",
      usage: [{ table: "aviamentos", column: "subcategoria_aviamento_id" }],
      extra: {
        field: "categoria_aviamento_id",
        label: "Categoria de Aviamento",
        from: "categorias_aviamento",
        optionLabel: "nome",
        required: true,
      },
    },
  },
  {
    value: "mat_aviamento",
    label: "Material",
    group: "AVIAMENTO",
    config: {
      table: "materiais_aviamento",
      nameField: "nome",
      singular: "Material de Aviamento",
      plural: "Materiais de Aviamento",
      usage: [{ table: "aviamentos", column: "material_aviamento_id" }],
    },
  },
  {
    value: "intervalo_largura",
    label: "Intervalo de Largura",
    group: "AVIAMENTO",
    config: {
      table: "intervalos_largura",
      nameField: "intervalo",
      singular: "Intervalo de Largura",
      plural: "Intervalos de Largura",
      usage: [
        { table: "aviamentos", column: "intervalo_largura_id" },
        { table: "aviamentos", column: "intervalo_vazado_id" },
      ],
    },
  },
  {
    value: "grupo_produto",
    label: "Grupo",
    group: "PRODUTO",
    config: {
      table: "grupos_produto",
      nameField: "nome",
      singular: "Grupo",
      plural: "Grupos",
      usage: [{ table: "categorias_produto", column: "grupo_id" }],
    },
  },
  {
    value: "cat_produto",
    label: "Categoria",
    group: "PRODUTO",
    config: {
      table: "categorias_produto",
      nameField: "nome",
      singular: "Categoria de Produto",
      plural: "Categorias de Produto",
      // A categoria pertence a um Grupo (obrigatório) — cria-se Grupo antes.
      extra: { field: "grupo_id", label: "Grupo", from: "grupos_produto", optionLabel: "nome", required: true },
      extraFirst: true,
      usage: [
        { table: "modelos", column: "categoria_principal_id" },
        { table: "modelos", column: "categoria_secundaria_id" },
        { table: "colecao_semana_categorias", column: "categoria_id" }, // CASCADE — apaga distribuição OTB
        { table: "subcategorias1_produto", column: "categoria_id" },
        { table: "subcategorias2_produto", column: "categoria_id" },
      ],
    },
  },
  {
    value: "subcat1_produto",
    label: "Subcategoria 1",
    group: "PRODUTO",
    config: {
      table: "subcategorias1_produto",
      nameField: "nome",
      singular: "Subcategoria 1",
      plural: "Subcategorias 1",
      // Pendura numa Categoria (obrigatório); rótulo mostra "Grupo › Categoria".
      extra: {
        field: "categoria_id",
        label: "Categoria",
        from: "categorias_produto",
        optionLabel: "nome",
        optionSelect: "id, nome, grupo:grupo_id(nome)",
        optionLabelFn: (r) => `${r.grupo?.nome ? `${r.grupo.nome} › ` : ""}${r.nome}`,
        required: true,
      },
      extraFirst: true,
      usage: [{ table: "modelos", column: "subcategoria1_id" }],
    },
  },
  {
    value: "subcat2_produto",
    label: "Subcategoria 2",
    group: "PRODUTO",
    config: {
      table: "subcategorias2_produto",
      nameField: "nome",
      singular: "Subcategoria 2",
      plural: "Subcategorias 2",
      extra: {
        field: "categoria_id",
        label: "Categoria",
        from: "categorias_produto",
        optionLabel: "nome",
        optionSelect: "id, nome, grupo:grupo_id(nome)",
        optionLabelFn: (r) => `${r.grupo?.nome ? `${r.grupo.nome} › ` : ""}${r.nome}`,
        required: true,
      },
      extraFirst: true,
      usage: [{ table: "modelos", column: "subcategoria2_id" }],
    },
  },
  {
    value: "linhas",
    label: "Linha",
    group: "PRODUTO",
    config: {
      table: "linhas",
      nameField: "nome",
      singular: "Linha",
      plural: "Linhas",
      // Markup (pode ser decimal) por Linha — usado em cálculos de preço.
      extraNumber: { field: "markup", label: "Markup", placeholder: "ex.: 2,5", step: "0.01" },
      usage: [
        { table: "modelos", column: "linha_id" },
        { table: "colecao_pv_itens", column: "linha_id" },
        { table: "mix_padrao_linhas", column: "linha_id" },
      ],
    },
  },
  {
    value: "cat_terceirizado",
    label: "Categoria do Serviço",
    group: "SERVIÇO",
    config: {
      table: "categorias_terceirizado",
      nameField: "nome",
      // Tem coluna `ordem` (usada em Serviços/CQ) → precisa semear no insert e ordenar por ela.
      orderField: "ordem",
      singular: "Categoria do Serviço",
      plural: "Categorias do Serviço",
      // Etapa: diferencia serviço "até costura" (pré) de "pós costura" (o antigo acabamento).
      extraEnum: {
        field: "etapa",
        label: "Etapa",
        options: [
          { value: "ate_costura", label: "Até costura" },
          { value: "pos_costura", label: "Pós costura" },
        ],
      },
      usage: [
        { table: "empresa_categorias_servico", column: "categoria_terceirizado_id" }, // CASCADE — vínculo empresa↔serviço
        { table: "producao_terceirizados", column: "categoria_terceirizado_id" },
        { table: "tipos_colaborador", column: "categoria_terceirizado_id" },
      ],
      // Corte e Oficina são fixos do sistema (semeados por loja); não podem ser
      // renomeados nem excluídos — "Oficina" alimenta a detecção do fluxo de oficina.
      protectedNames: ["corte", "oficina"],
      toggleField: { field: "ativo", label: "Ativo", hint: "Desligar esconde o serviço de novos usos (não exclui)." },
    },
  },
  {
    value: "grade_tamanhos",
    label: "Grade de Tamanhos",
    group: "PRODUTO",
    custom: "grade",
  },
];

const GROUP_ORDER: GroupKey[] = [
  "GERAL",
  "FORNECEDOR",
  "TECIDO",
  "AVIAMENTO",
  "PRODUTO",
  "SERVIÇO",
];

function useAttributeCount(table: string | null) {
  return useQuery({
    queryKey: ["attribute-count", table],
    enabled: !!table,
    queryFn: async () => {
      const { count, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(table as any)
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/**
 * Prioridade da fonte de confecção (grade cortada): ordena as categorias de serviço
 * de confecção (PL/Oficina/Costura) — quando um modelo tem mais de um bloco destrinchado
 * dessas categorias, a grade cortada/recebida/defeito vem do primeiro da lista. Grava
 * `tenant_config.confeccao_prioridade` (array de `categoria_terceirizado_id`, ordenado).
 * Espelha (TS puro) a resolução que o servidor faz em `_resolver_fonte_confeccao`
 * (Task 3) — ver `src/lib/confeccao-fonte.ts`; risco de drift TS↔SQL documentado lá.
 * Some da aba quando há ≤1 categoria de confecção (nada para priorizar).
 */
function ConfeccaoPrioridadeCard() {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const tenantId = useActiveTenantId();

  const { data: cfgPrio } = useQuery({
    queryKey: ["confeccao-prioridade", tenantId],
    enabled: !!tenantId,
    queryFn: async () =>
      ((await supabase.from("tenant_config").select("confeccao_prioridade").eq("tenant_id", tenantId).maybeSingle())
        .data as any)?.confeccao_prioridade ?? [],
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ["cat-terceirizado-confeccao", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      // `ativo` é coluna nova (migração 20260806100000) — types.ts pendente de regen
      // (não dá pra referenciar no `.select()`/`.eq()` tipado); traz `*` e filtra em JS,
      // como o resto do arquivo faz para colunas fora do types.ts.
      const { data, error } = await supabase.from("categorias_terceirizado").select("*").order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown as { id: string; nome: string; ativo: boolean }[]).filter((c) => c.ativo);
    },
  });

  const confeccaoCats = useMemo(() => categorias.filter((c) => isServicoConfeccao(c.nome)), [categorias]);

  // Ordem efetiva: as salvas primeiro (na ordem), depois as demais confecções pelo default (PL antes).
  const ordemAtual = useMemo(() => {
    const saved = (cfgPrio ?? []).filter((id: string) => confeccaoCats.some((c) => c.id === id));
    const resto = confeccaoCats
      .map((c) => c.id)
      .filter((id) => !saved.includes(id))
      .sort(
        (a, b) =>
          Number(isServicoPL(confeccaoCats.find((c) => c.id === b)!.nome)) -
          Number(isServicoPL(confeccaoCats.find((c) => c.id === a)!.nome)),
      );
    return [...saved, ...resto];
  }, [cfgPrio, confeccaoCats]);

  const savePrio = useMutation({
    mutationFn: async (ids: string[]) => {
      // upsert (não update): loja sem linha de tenant_config ainda não perde a gravação em
      // silêncio (0 rows, sem erro) — mesmo padrão de admin/configuracoes.tsx.
      const { error } = await supabase
        .from("tenant_config")
        .upsert({ tenant_id: tenantId, confeccao_prioridade: ids } as any, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["confeccao-prioridade", tenantId] });
      toast.success("Prioridade salva.");
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar prioridade.")),
  });

  if (confeccaoCats.length <= 1) return null;

  return (
    <Card className="p-4 space-y-2">
      <h3 className="font-semibold">Prioridade da grade cortada</h3>
      <p className="text-xs text-muted-foreground">
        Quando um modelo tem mais de um serviço de confecção destrinchado (ex.: PL e Oficina), a
        grade cortada/recebida/defeito vem do primeiro da lista abaixo.
      </p>
      <ol className="space-y-1">
        {ordemAtual.map((id, i) => {
          const nome = confeccaoCats.find((c) => c.id === id)?.nome ?? id;
          const mover = (delta: number) => {
            const arr = [...ordemAtual];
            const j = i + delta;
            if (j < 0 || j >= arr.length) return;
            [arr[i], arr[j]] = [arr[j], arr[i]];
            savePrio.mutate(arr);
          };
          return (
            <li key={id} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-muted-foreground">{i + 1}.</span>
              <span className="flex-1">{nome}</span>
              <Button
                size="iconSm"
                variant="ghost"
                onClick={() => mover(-1)}
                disabled={readOnly || i === 0 || savePrio.isPending}
                aria-label="Subir"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                size="iconSm"
                variant="ghost"
                onClick={() => mover(1)}
                disabled={readOnly || i === ordemAtual.length - 1 || savePrio.isPending}
                aria-label="Descer"
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function AtributosPage() {
  const { isStockOnly } = useTenantModules();
  const { isTenantAdmin, isSuperAdmin } = useAuth();
  // Categoria do Serviço é admin-only no banco (config de produção: SLA/Leadtime).
  // Esconde a aba p/ não-admin em vez de deixar o edit dar UPDATE-0 silencioso.
  const visibleAttributes = useMemo(
    () => ATTRIBUTES.filter((a) => isTenantAdmin || isSuperAdmin || a.value !== "cat_terceirizado"),
    [isTenantAdmin, isSuperAdmin],
  );
  const [selectedValue, setSelectedValue] = useState<string>(ATTRIBUTES[0].value);
  const selected = useMemo(
    () => visibleAttributes.find((a) => a.value === selectedValue) ?? visibleAttributes[0],
    [selectedValue, visibleAttributes],
  );
  // Subcategoria 1 ganha o SLA de Serviços (dias) — prazo da confecção (oficina/costura/
  // PL). Coluna `sla_oficina` (nome herdado). Reaproveitado como prazo no Leadtime. Exceto
  // no modo controle-de-estoque (não há produção lá).
  const activeConfig: AttributeTabConfig | undefined = !selected.config
    ? undefined
    : selected.config.table === "subcategorias1_produto" && !isStockOnly
      ? { ...selected.config, extraNumber: { field: "sla_oficina", label: "SLA de Serviços (dias)", placeholder: "dias" } }
      : selected.config;

  const grouped = useMemo(() => {
    const map = new Map<GroupKey, AttributeItem[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const item of visibleAttributes) map.get(item.group)!.push(item);
    return map;
  }, [visibleAttributes]);
  // Só grupos com ao menos 1 item visível (SERVIÇO fica vazio p/ não-admin).
  const visibleGroups = useMemo(() => GROUP_ORDER.filter((g) => grouped.get(g)!.length > 0), [grouped]);

  const qc = useQueryClient();
  const { data: count, isLoading: countLoading } = useAttributeCount(selected.config?.table ?? null);
  // Contagem FILTRADA (após busca) reportada pelo AttributeTab; reseta ao trocar de atributo.
  const [filteredN, setFilteredN] = useState<number | null>(null);
  useEffect(() => setFilteredN(null), [selectedValue]);

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-start gap-3">
        <Tags className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Atributos</h1>
          <p className="text-sm text-muted-foreground">
            Listas de apoio usadas em todo o cadastro do sistema.
          </p>
        </div>
      </header>

      {/* Mobile selector */}
      <div className="md:hidden">
        <Select value={selectedValue} onValueChange={setSelectedValue}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {visibleGroups.map((g) => (
              <SelectGroup key={g}>
                <SelectLabel>{g}</SelectLabel>
                {grouped.get(g)!.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-6 rounded-lg border bg-card">
        {/* Sidebar */}
        <aside className="hidden md:block w-60 shrink-0 border-r py-4">
          <nav className="space-y-4">
            {visibleGroups.map((g) => (
              <div key={g}>
                <div className="px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g}
                </div>
                <ul className="space-y-0.5">
                  {grouped.get(g)!.map((item) => {
                    const active = item.value === selectedValue;
                    return (
                      <li key={item.value}>
                        <button
                          type="button"
                          onClick={() => setSelectedValue(item.value)}
                          className={cn(
                            "w-full text-left px-4 py-1.5 text-sm transition-colors border-l-2",
                            active
                              ? "bg-muted text-foreground font-medium border-primary"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
                          )}
                        >
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 border-b pb-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">
                {selected.custom === "grade" ? "Grade de Tamanhos" : selected.config!.plural}
              </h2>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {selected.group}
              </p>
            </div>
            {!selected.custom && (
              <Badge variant="secondary" className="shrink-0">
                {countLoading
                  ? "…"
                  : `${filteredN ?? count ?? 0} de ${count ?? 0} ${(count ?? 0) === 1 ? "item" : "itens"}`}
              </Badge>
            )}
          </div>

          {selected.custom === "grade" ? (
            <GradeTamanhosCard />
          ) : (
            activeConfig && (
              <AttributeTab
                key={selected.value}
                config={activeConfig}
                onFilteredCount={setFilteredN}
                onChanged={() =>
                  qc.invalidateQueries({ queryKey: ["attribute-count", selected.config?.table] })
                }
              />
            )
          )}

          {/* Prioridade da fonte de confecção (grade cortada) — só na aba de Categoria do Serviço. */}
          {selected.value === "cat_terceirizado" && <ConfeccaoPrioridadeCard />}
        </div>
      </div>
    </div>
  );
}
