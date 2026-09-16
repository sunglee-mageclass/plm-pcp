import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/shared/NumberInput";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  montarRef,
  siglaAutoParte,
  type RefConfig,
  type RefFamilia,
  type RefParte,
  type RefTaxonomia,
} from "@/lib/ref-montar";

// Card "Formato da REF" (Config da Loja) — configura como a REF de produto (interno/
// acabado/importado) é montada: quais partes entram + ordem, separador, largura/início do
// número sequencial, e as siglas de família/taxonomia. `montarRef`/`ref-montar.ts` é a
// FONTE DA VERDADE da montagem (espelho byte-a-byte do SQL) — este Card só monta o objeto
// `RefConfig` e delega a montagem pro preview. NÃO reimplementa a lógica.

const PARTES_DEF: { key: RefParte; label: string }[] = [
  { key: "familia", label: "Família" },
  { key: "grupo", label: "Grupo" },
  { key: "categoria", label: "Categoria" },
  { key: "sub1", label: "Subcategoria 1" },
  { key: "sub2", label: "Subcategoria 2" },
  { key: "numero", label: "Número sequencial" },
];

// Aba de taxonomia → parte correspondente (pra filtrar quais abas aparecem).
const TAX_TABS: { parte: RefParte; key: string; label: string }[] = [
  { parte: "grupo", key: "grupo", label: "Grupos" },
  { parte: "categoria", key: "categoria", label: "Categorias" },
  { parte: "sub1", key: "sub1", label: "Subcat. 1" },
  { parte: "sub2", key: "sub2", label: "Subcat. 2" },
];

const FAMILIA_ROWS: { key: RefFamilia; label: string }[] = [
  { key: "interno", label: "Produto interno" },
  { key: "acabado", label: "Produto acabado" },
  { key: "importado", label: "Produto importado" },
];

type Item = { id: string; nome: string; grupo_id?: string | null; categoria_id?: string | null };

function ehAcessorio(nome: string | null | undefined): boolean {
  return (nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes("acessor");
}

export function FormatoRefCard({
  value,
  onChange,
}: {
  value: RefConfig | null;
  onChange: (next: RefConfig | null) => void;
}) {
  const tenantId = useActiveTenantId();
  const cfg: RefConfig = value ?? {};

  const partes = cfg.partes ?? [];
  const marcadas = new Set(partes);
  const separador = cfg.separador ?? "";
  const numDig = cfg.num_digitos ?? 8;
  const numInicio = cfg.num_inicio ?? 10000000;

  // Atualiza um campo do RefConfig, preservando os demais. `null` explícito reseta tudo.
  const patch = (p: Partial<RefConfig>) => onChange({ ...cfg, ...p });

  const toggleParte = (parte: RefParte, on: boolean) => {
    const next = on ? [...partes, parte] : partes.filter((p) => p !== parte);
    patch({ partes: next });
  };

  const moverParte = (idx: number, dir: -1 | 1) => {
    const alvo = idx + dir;
    if (alvo < 0 || alvo >= partes.length) return;
    const next = [...partes];
    [next[idx], next[alvo]] = [next[alvo], next[idx]];
    patch({ partes: next });
  };

  const setSiglaFamilia = (familia: RefFamilia, v: string) => {
    const map = { ...(cfg.sigla_familia ?? {}) };
    if (v.trim()) map[familia] = v; else delete map[familia];
    patch({ sigla_familia: map });
  };

  const setSiglaItem = (id: string, v: string) => {
    const map = { ...(cfg.sigla_taxonomia ?? {}) };
    if (v.trim()) map[id] = v; else delete map[id];
    patch({ sigla_taxonomia: map });
  };

  // Taxonomia da loja — só carregada pra alimentar as abas de sigla + a prévia.
  const { data: grupos = [] } = useQuery({
    queryKey: ["ref-cfg-grupos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("grupos_produto").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ["ref-cfg-categorias", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("categorias_produto").select("id, nome, grupo_id").order("nome");
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });
  const { data: sub1s = [] } = useQuery({
    queryKey: ["ref-cfg-sub1", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias1_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });
  const { data: sub2s = [] } = useQuery({
    queryKey: ["ref-cfg-sub2", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias2_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  const acessorioSet = useMemo(() => new Set(grupos.filter((g) => ehAcessorio(g.nome)).map((g) => g.id)), [grupos]);

  const TAX_ITEMS: Record<string, Item[]> = { grupo: grupos, categoria: categorias, sub1: sub1s, sub2: sub2s };
  const abasVisiveis = TAX_TABS.filter((t) => marcadas.has(t.parte));
  const [tab, setTab] = useState<string>("familia");
  const abaAtual = marcadas.has("familia") || abasVisiveis.some((t) => t.key === tab) ? tab : (abasVisiveis[0]?.key ?? "familia");

  // Prévia ao vivo — 1º grupo/categoria/sub1 da loja como exemplo (ou vazio se a loja não
  // tem taxonomia cadastrada ainda). NÃO reimplementa a montagem: delega ao montarRef.
  const exGrupo = grupos[0];
  const exCategoria = categorias.find((c) => c.grupo_id === exGrupo?.id) ?? categorias[0];
  const exSub1 = sub1s.find((s) => s.categoria_id === exCategoria?.id) ?? sub1s[0];
  const exSub2 = sub2s.find((s) => s.categoria_id === exCategoria?.id) ?? sub2s[0];
  const exAcessorio = exGrupo ? acessorioSet.has(exGrupo.id) : false;
  const tax: RefTaxonomia = {
    grupoId: exGrupo?.id ?? null,
    grupoNome: exGrupo?.nome ?? "Vestuário",
    categoriaId: exCategoria?.id ?? null,
    categoriaNome: exCategoria?.nome ?? "Blusa",
    sub1Id: exSub1?.id ?? null,
    sub1Nome: exSub1?.nome ?? "Manga Curta",
    sub2Id: exSub2?.id ?? null,
    sub2Nome: exSub2?.nome ?? "Estampado",
  };
  const numeroExemplo = numInicio;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Formato da REF</CardTitle>
        <CardDescription>
          Como a REF de produto (interno, acabado e importado) é montada: quais partes
          entram, em que ordem, e as siglas de cada uma. Sem configuração = comportamento
          padrão do sistema (histórico).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Bloco: Montagem da REF */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Montagem da REF
          </p>
          <p className="text-xs text-muted-foreground">
            Marque as partes que compõem a REF. Use as setas para ordenar — a ordem aqui é a
            ordem final na REF.
          </p>
          <ul className="space-y-1.5">
            {/* Primeiro as partes MARCADAS, na ordem configurada; depois as não-marcadas. */}
            {[...partes, ...PARTES_DEF.map((p) => p.key).filter((k) => !marcadas.has(k))].map((key) => {
              const def = PARTES_DEF.find((p) => p.key === key)!;
              const on = marcadas.has(key);
              const idx = partes.indexOf(key);
              return (
                <li key={key} className="rounded-md border bg-card p-2">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) => toggleParte(key, !!v)}
                      aria-label={`Usar "${def.label}" na REF`}
                    />
                    <span
                      className="flex-1 cursor-pointer select-none text-sm"
                      onClick={() => toggleParte(key, !on)}
                    >
                      {def.label}
                    </span>
                    {on && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button" size="icon" variant="ghost" className="h-7 w-7"
                          disabled={idx <= 0}
                          onClick={() => moverParte(idx, -1)}
                          aria-label={`Mover "${def.label}" para cima`}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button" size="icon" variant="ghost" className="h-7 w-7"
                          disabled={idx < 0 || idx >= partes.length - 1}
                          onClick={() => moverParte(idx, 1)}
                          aria-label={`Mover "${def.label}" para baixo`}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {key === "numero" && on && (
                    <div className="mt-2 grid grid-cols-1 gap-2 border-t pt-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Qtd de dígitos</Label>
                        <NumberInput
                          integer
                          value={numDig}
                          onChange={(e) => patch({ num_digitos: Math.max(1, Number(e.target.value) || 8) })}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Começar em</Label>
                        <NumberInput
                          integer
                          value={numInicio}
                          onChange={(e) => patch({ num_inicio: Math.max(0, Number(e.target.value) || 0) })}
                          className="h-8"
                        />
                      </div>
                      <p className="col-span-full text-xs text-muted-foreground">
                        O "começar em" é um piso; o contador só sobe, nunca reinicia nem reusa.
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="grid grid-cols-1 gap-1 sm:max-w-xs">
            <Label className="text-xs text-muted-foreground">Separador entre partes</Label>
            <Select value={separador || "none"} onValueChange={(v) => patch({ separador: v === "none" ? "" : v })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                <SelectItem value="-">Traço ( - )</SelectItem>
                <SelectItem value=".">Ponto ( . )</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Bloco: Siglas — abas só das partes marcadas */}
        {(marcadas.has("familia") || abasVisiveis.length > 0) && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Siglas</p>
            <Tabs value={abaAtual} onValueChange={setTab}>
              <TabsList>
                {marcadas.has("familia") && <TabsTrigger value="familia">Família</TabsTrigger>}
                {abasVisiveis.map((t) => (
                  <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
                ))}
              </TabsList>

              {marcadas.has("familia") && (
                <TabsContent value="familia" className="space-y-2">
                  {FAMILIA_ROWS.map((f) => (
                    <div key={f.key} className="grid grid-cols-[1fr_120px] items-center gap-2">
                      <Label className="text-sm font-normal">{f.label}</Label>
                      <Input
                        className="h-8"
                        maxLength={6}
                        placeholder={{ interno: "I", acabado: "A", importado: "M" }[f.key]}
                        value={cfg.sigla_familia?.[f.key] ?? ""}
                        onChange={(e) => setSiglaFamilia(f.key, e.target.value)}
                      />
                    </div>
                  ))}
                </TabsContent>
              )}

              {abasVisiveis.map((t) => (
                <TabsContent key={t.key} value={t.key}>
                  <TaxonomiaSiglaTab
                    parte={t.parte}
                    itens={TAX_ITEMS[t.key] ?? []}
                    siglaCfg={cfg.sigla_taxonomia ?? {}}
                    onSigla={setSiglaItem}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}

        {/* Prévia ao vivo */}
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prévia</p>
          <p className="text-xs text-muted-foreground">
            Exemplo com {exGrupo ? "o 1º grupo/categoria/subcategoria cadastrado" : "valores de exemplo (loja sem taxonomia cadastrada ainda)"}.
          </p>
          <div className="space-y-1.5 rounded-md border bg-muted/30 p-3 font-mono text-sm">
            {FAMILIA_ROWS.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-2">
                <span className="text-xs font-sans text-muted-foreground">{f.label}</span>
                <span className="tabular-nums">
                  {montarRef({ cfg, familia: f.key, tax, numero: numeroExemplo, acessorio: exAcessorio })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Uma aba de taxonomia (Grupos/Categorias/Sub1/Sub2): busca + lista com input de sigla por
// item. Vazio mostra a sigla AUTOMÁTICA esmaecida (placeholder) — não grava nada até o
// usuário digitar algo.
function TaxonomiaSiglaTab({
  parte,
  itens,
  siglaCfg,
  onSigla,
}: {
  parte: RefParte;
  itens: Item[];
  siglaCfg: Record<string, string>;
  onSigla: (id: string, v: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return itens;
    return itens.filter((i) => i.nome.toLowerCase().includes(q));
  }, [itens, busca]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-8"
          placeholder="Buscar…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {filtrados.map((it) => {
          // Placeholder "auto" = derivação do MODO CONFIGURADO (sem exceção de acessório — essa é só
          // do fallback histórico). Fonte única: siglaAutoParte do ref-montar.ts.
          const auto = siglaAutoParte(parte, it.nome);
          return (
            <li key={it.id} className="grid grid-cols-[1fr_100px] items-center gap-2 px-1">
              <span className="truncate text-sm">{it.nome}</span>
              <Input
                className="h-8"
                maxLength={6}
                placeholder={auto ? `${auto} (auto)` : "(auto)"}
                value={siglaCfg[it.id] ?? ""}
                onChange={(e) => onSigla(it.id, e.target.value)}
              />
            </li>
          );
        })}
        {filtrados.length === 0 && (
          <li className="px-1 py-2 text-sm italic text-muted-foreground">
            {itens.length === 0 ? "Nenhum item cadastrado ainda." : "Nenhum item bate com a busca."}
          </li>
        )}
      </ul>
    </div>
  );
}
