# OTB (Open To Buy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "OTB" module — a collection-budget screen before Planejamento — where the store sets a collection (name, year, month, weeks, budget) and watches previsto/real cost + poder de venda against the budget; on confirm it auto-generates blank planning cards per week; and Planejamento gains a bulk-edit tool.

**Architecture:** New `otb` module (toggleable per store, default OFF). New `colecoes` + `colecao_semanas` tables; `modelos.colecao_id` FK (text `colecao` kept as legacy/mirror). OTB screen at `/otb` (list + right-side Sheet editor) computes the budget panel **client-side** reusing `preco.ts` + the same queries Planejamento uses. Card generation/reconciliation is a transactional RPC `otb_confirmar`. When the module is ON, the Coleção field in Planejamento/Desenvolvimento/Vários Cards becomes a dropdown of collections; when OFF, everything stays as today (free text).

**Tech Stack:** Vite + React 19 + TanStack Router/Query + Supabase (Postgres + RLS + RPC) + Tailwind + shadcn/Radix + zod. Tests: Vitest transactional integration (`tests/integration/`, reverted BEGIN…ROLLBACK) for RPC/DB; `tsc --noEmit` + `vite build` as the front gate.

## Global Constraints

- **Migrations are ADDITIVE** — never drop a column the deployed front still reads (`modelos.colecao` stays). Apply with `psql "$(cat /tmp/dburl.txt)" -f <file>`; dry-run `BEGIN; …; ROLLBACK`. After DDL: `select pg_notify('pgrst','reload schema');`.
- **UNIQUE only COMPOSTA** on new tables (never UNIQUE on a single embedded FK column — breaks PostgREST to-one embeds). Use `(tenant_id, nome)` / `(colecao_id, semana)`.
- **Every FK gets a plain index** (`create index` — embedded FK without UNIQUE else seq-scans).
- **RPC security:** business wrappers check `tenant_module_enabled('otb')` (module gate) and any `_core` helper has `REVOKE EXECUTE … FROM public, anon, authenticated` (invariant 9). Tenant-scope every query with `public.get_user_tenant_id()`.
- **Module `otb` default OFF** (opt-in) — must be overridden to `false` in BOTH `useTenantModules` and `admin/lojas.tsx` `MODULE_DEFAULTS` (the generic fallback is `?? true`).
- **`npm run build` does NOT run tsc** — after edits run `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2552|otb|colec"` too.
- **Regenerate types** after each migration: `npx supabase gen types typescript --db-url "$(cat /tmp/dburl.txt)" > src/integrations/supabase/types.ts`.
- Toasts/erros in PT-BR via `mensagemErro(e, fallback)`. Datas via `<DateField>` (não `<input type=date>`).
- **UI testing reality:** this repo has NO React component unit tests. For front tasks the deliverable's "test" is `tsc --noEmit` + `vite build` green (and, where noted, an E2E smoke). RPC/DB tasks use real TDD via `tests/integration/`.

## File Structure

**Create:**
- `supabase/migrations/20260703100000_otb_colecoes.sql` — tables + FK + index + RLS + trigger + grants.
- `supabase/migrations/20260703110000_otb_confirmar.sql` — RPC `otb_confirmar` (generation/reconciliation).
- `supabase/migrations/20260703120000_otb_importar_colecoes.sql` — RPC `otb_importar_colecoes`.
- `src/routes/_authenticated/otb.index.tsx` — OTB route: list of collections + Sheet editor + budget panel.
- `src/components/otb/ColecaoSheet.tsx` — the collection editor Sheet (fields, weeks table, panel).
- `src/components/otb/otb-resumo.ts` — pure helper computing a collection's resumo (previsto/real/poder) from loaded models. Reuses `preco.ts`.
- `src/components/planejamento/BulkEditDialog.tsx` — bulk-edit dialog for selected planning cards.
- `tests/integration/otb.test.ts` — integration tests for `otb_confirmar` + `otb_importar_colecoes`.

**Modify:**
- `src/lib/permissions-catalog.ts` — add `otb` module.
- `src/hooks/useTenantModules.tsx` — add `otb` to union + DEFAULTS (false) + base path.
- `src/components/app-sidebar.tsx` — `MODULE_META.otb` + position `/otb` above `/criacao`.
- `src/routes/_authenticated/admin/lojas.tsx` — `MODULE_DEFAULTS.otb = false`.
- `src/routes/_authenticated/admin/configuracoes.tsx` — add `otb` to `MODULE_LABELS`.
- `src/routes/_authenticated/criacao.planejamento.tsx` — Coleção field conditional (dropdown when OTB on) + prefill mês/ano; selection mode + BulkEditDialog wiring; `BatchCardsDialog` Coleção conditional.
- `src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx` (+ its panel loader) — Coleção field conditional.

---

## PHASE 1 — Data model + module + OTB screen

### Task 1.1: Migration — colecoes, colecao_semanas, modelos.colecao_id

**Files:**
- Create: `supabase/migrations/20260703100000_otb_colecoes.sql`
- Test: `tests/integration/otb.test.ts`

**Interfaces:**
- Produces tables `public.colecoes(id, tenant_id, nome, ano_id, mes_id, orcamento, status, created_at)`, `public.colecao_semanas(id, colecao_id, semana, qtd_planejada)`, column `public.modelos.colecao_id uuid`.

- [ ] **Step 1: Write the migration file**

```sql
-- OTB (Open To Buy): coleção vira entidade dona (nome, ano, mês, semanas, orçamento).
-- ADITIVA: modelos.colecao (texto) permanece (livre quando OTB off; espelho do nome
-- quando OTB on). Nada é dropado.

-- 1. Coleção (a entidade dona)
create table if not exists public.colecoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  nome varchar not null,
  ano_id uuid references public.anos(id),
  mes_id uuid references public.meses(id),
  orcamento numeric,
  status varchar not null default 'rascunho' check (status in ('rascunho','confirmada')),
  created_at timestamptz not null default now(),
  unique (tenant_id, nome)
);

-- 2. Semanas da coleção (qtd de modelos por semana)
create table if not exists public.colecao_semanas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  semana varchar not null,
  qtd_planejada int not null default 0,
  unique (colecao_id, semana)
);

-- 3. modelos ganha o FK da coleção (texto colecao permanece)
alter table public.modelos
  add column if not exists colecao_id uuid references public.colecoes(id);

-- Índices das FKs (embedadas sem UNIQUE → seq scan sem índice)
create index if not exists idx_colecoes_ano on public.colecoes(ano_id);
create index if not exists idx_colecoes_mes on public.colecoes(mes_id);
create index if not exists idx_colecao_semanas_colecao on public.colecao_semanas(colecao_id);
create index if not exists idx_modelos_colecao on public.modelos(colecao_id);

-- Trigger de tenant (auto-preenche tenant_id na inserção)
create or replace trigger set_tenant_id_trg before insert on public.colecoes
  for each row execute function public.set_tenant_id();
create or replace trigger set_tenant_id_trg before insert on public.colecao_semanas
  for each row execute function public.set_tenant_id();

-- Grants (o RLS faz o gate real)
grant all on public.colecoes to anon, authenticated, service_role;
grant all on public.colecao_semanas to anon, authenticated, service_role;

-- RLS por tenant (4 policies cada)
alter table public.colecoes enable row level security;
alter table public.colecao_semanas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['colecoes','colecao_semanas'] loop
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format('create policy tenant_select on public.%I for select to authenticated using (tenant_id = public.get_user_tenant_id())', t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check (tenant_id = public.get_user_tenant_id() or tenant_id is null)', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format('create policy tenant_update on public.%I for update to authenticated using (tenant_id = public.get_user_tenant_id()) with check (tenant_id = public.get_user_tenant_id())', t);
    execute format('drop policy if exists tenant_delete on public.%I', t);
    execute format('create policy tenant_delete on public.%I for delete to authenticated using (tenant_id = public.get_user_tenant_id())', t);
  end loop;
end $$;

select pg_notify('pgrst','reload schema');
```

- [ ] **Step 2: Dry-run the migration (reverted)**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 --single-transaction \
  -c "BEGIN;" -f supabase/migrations/20260703100000_otb_colecoes.sql -c "ROLLBACK;"
```
Expected: no errors (statements run, then rolled back). If `set_tenant_id`/`get_user_tenant_id` missing → STOP, they must already exist (they do — used across the schema).

- [ ] **Step 3: Write the failing integration test**

Append to `tests/integration/otb.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("OTB — coleções", () => {
  it("insere coleção e semana no tenant e lê de volta (RLS)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const col = await um<{ id: string; tenant_id: string; status: string }>(
        c,
        `insert into public.colecoes (nome, orcamento) values ($1, $2) returning id, tenant_id, status`,
        ["Verão Teste OTB", 100000],
      );
      expect(col.tenant_id).toBe(TENANT_TESTE);
      expect(col.status).toBe("rascunho");
      await c.query(
        `insert into public.colecao_semanas (colecao_id, semana, qtd_planejada) values ($1,'1',10)`,
        [col.id],
      );
      const wk = await um<{ n: string }>(c, `select count(*)::text n from public.colecao_semanas where colecao_id=$1`, [col.id]);
      expect(wk.n).toBe("1");
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it FAILS (table missing)**

Run: `npx vitest run tests/integration/otb.test.ts`
Expected: FAIL — `relation "public.colecoes" does not exist` (migration not yet applied).

- [ ] **Step 5: Apply the migration for real**

Run: `psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260703100000_otb_colecoes.sql`
Expected: `CREATE TABLE`/`ALTER TABLE`/`CREATE INDEX`/`GRANT`/`DO`/`pg_notify` lines, no error.

- [ ] **Step 6: Run the test to verify it PASSES**

Run: `npx vitest run tests/integration/otb.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260703100000_otb_colecoes.sql tests/integration/otb.test.ts
git commit -m "feat(otb): tabelas colecoes/colecao_semanas + modelos.colecao_id (aditiva)"
```

### Task 1.2: Regenerate Supabase types

**Files:** Modify `src/integrations/supabase/types.ts`

- [ ] **Step 1: Regenerate**

Run: `npx supabase gen types typescript --db-url "$(cat /tmp/dburl.txt)" > src/integrations/supabase/types.ts`

- [ ] **Step 2: Verify the new tables appear**

Run: `grep -E "colecoes:|colecao_semanas:|colecao_id" src/integrations/supabase/types.ts | head`
Expected: matches for `colecoes`, `colecao_semanas`, and `colecao_id` on `modelos`.

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2552" | head`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(otb): regen types.ts (colecoes/colecao_semanas/colecao_id)"
```

### Task 1.3: Wire the `otb` module (catalog, hook, sidebar, config, lojas)

**Files:**
- Modify: `src/lib/permissions-catalog.ts`
- Modify: `src/hooks/useTenantModules.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/routes/_authenticated/admin/lojas.tsx:34`
- Modify: `src/routes/_authenticated/admin/configuracoes.tsx:102`

**Interfaces:**
- Produces: module key `"otb"` known to `isModuleEnabled` (default **false**), basePath `/otb`, sidebar item above Criação, store toggle in Gerenciar Lojas.

- [ ] **Step 1: Add `otb` to PAGES_CATALOG**

In `src/lib/permissions-catalog.ts`, insert BEFORE the `criacao` entry:
```ts
  {
    module: "otb",
    label: "OTB",
    basePath: "/otb",
    pages: [
      { key: "otb", label: "OTB" },
    ],
  },
```
(The page `otb` is intentionally NOT added to `PAGE_URLS` in the sidebar → the module renders as a single direct link to `/otb`.)

- [ ] **Step 2: Add `otb` to useTenantModules with default FALSE**

In `src/hooks/useTenantModules.tsx`:
- Add `| "otb"` to the `ModuleKey` union.
- Replace `ALL_ON` with a defaults map that keeps the 6 legacy modules `true` and adds `otb: false`:
```ts
const DEFAULTS: Record<ModuleKey, boolean> = {
  cadastro: true,
  entrada_saida: true,
  criacao: true,
  producao: true,
  financeiro: true,
  dashboard: true,
  otb: false, // opt-in
};
```
- Add `otb: "/otb"` to `MODULE_BASE_PATH`.
- Do NOT add `otb` to `LANDING_ORDER` (never an auto-landing).
- Change the merge + gate to honor per-key defaults:
```ts
const modules: Record<ModuleKey, boolean> = { ...DEFAULTS, ...(data ?? {}) };
const isModuleEnabled = (key: string) =>
  modules[key as ModuleKey] ?? DEFAULTS[key as ModuleKey] ?? true;
```
(Replace every remaining `ALL_ON` reference with `DEFAULTS`.)

- [ ] **Step 3: Add MODULE_META + sidebar positioning**

In `src/components/app-sidebar.tsx`:
- Import an icon: add `Target` to the `lucide-react` import.
- Add to `MODULE_META`: `otb: { title: "OTB", icon: Target },`.
- Replace the criacao-to-top block (around line 157-159) with OTB-then-Criação:
```ts
  // Topo (a pedido do dono): OTB e Criação logo abaixo de Início.
  const moveTop = (url: string) => {
    const i = visibleMainItems.findIndex((x) => x.url === url);
    if (i > 0) visibleMainItems.unshift(visibleMainItems.splice(i, 1)[0]);
  };
  moveTop("/criacao"); // Criação sobe primeiro…
  moveTop("/otb");     // …e OTB fica acima dela.
```

- [ ] **Step 4: Override MODULE_DEFAULTS.otb = false in lojas.tsx**

In `src/routes/_authenticated/admin/lojas.tsx`, replace the `MODULE_DEFAULTS` const (line ~34) with:
```ts
const MODULE_DEFAULTS: Record<string, boolean> = {
  ...Object.fromEntries(MODULE_TOGGLES.map((m) => [m.key, true])),
  otb: false, // opt-in
};
```

- [ ] **Step 5: Add otb to the config display list**

In `src/routes/_authenticated/admin/configuracoes.tsx`, add to `MODULE_LABELS` (line ~102) after the Criação entry:
```ts
  { key: "otb", label: "OTB" },
```

- [ ] **Step 6: tsc + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2552|otb" ; npm run build 2>&1 | tail -3`
Expected: no tsc errors; build `✓ built`.

- [ ] **Step 7: Enable the module for the test store (verify gate)**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -c "select coalesce((modules->>'otb')::bool,false) from tenant_config where tenant_id='37889b78-fffb-404b-8c75-18b7e50a1d9b';"
```
Expected: `f` (or null → false). This confirms the opt-in default; the store admin turns it on in Gerenciar Lojas.

- [ ] **Step 8: Commit**

```bash
git add src/lib/permissions-catalog.ts src/hooks/useTenantModules.tsx src/components/app-sidebar.tsx src/routes/_authenticated/admin/lojas.tsx src/routes/_authenticated/admin/configuracoes.tsx
git commit -m "feat(otb): módulo otb (opt-in, default off) + item de sidebar acima de Criação"
```

### Task 1.4: OTB route — list + editor Sheet (name/year/month/budget/weeks)

**Files:**
- Create: `src/routes/_authenticated/otb.index.tsx`
- Create: `src/components/otb/ColecaoSheet.tsx`
- Create: `src/components/otb/otb-resumo.ts`

**Interfaces:**
- Consumes: `precoInfo` from `@/lib/preco`.
- Produces: `computeColecaoResumo(models, custoMap, gradeMap, linhaMarkupMap)` in `otb-resumo.ts` returning `{ orcamento?: number; previsto: number; real: number; poder: number; qtdModelos: number; qtdPecas: number }`. `<ColecaoSheet colecaoId={string|null} onClose onSaved />`.

- [ ] **Step 1: Write the resumo helper**

Create `src/components/otb/otb-resumo.ts`:
```ts
import { precoInfo } from "@/lib/preco";

export type ModelForResumo = {
  id: string;
  linha_id: string | null;
  preco_venda: number | null;
};
export type Custo = { previsto: number; real: number; confirmado: boolean };

export type ColecaoResumo = {
  previsto: number; // Σ custo previsto por peça × grade
  real: number;     // Σ custo real por peça × grade
  poder: number;    // Σ preço efetivo × grade
  qtdModelos: number;
  qtdPecas: number;
};

/** Agrega previsto/real/poder de venda de uma lista de modelos (mesma lógica do
 *  Planejamento). custoMap: id→{previsto,real}; gradeMap: id→grade total. */
export function computeColecaoResumo(
  models: ModelForResumo[],
  custoMap: Record<string, Custo>,
  gradeMap: Record<string, number>,
  linhaMarkupMap: Record<string, number | null>,
): ColecaoResumo {
  let previsto = 0, real = 0, poder = 0, qtdPecas = 0;
  for (const m of models) {
    const grade = Number(gradeMap[m.id]) || 0;
    const custo = custoMap[m.id];
    const pi = precoInfo(custo?.real, m.linha_id ? linhaMarkupMap[m.linha_id] : 0, m.preco_venda);
    previsto += (Number(custo?.previsto) || 0) * grade;
    real += (Number(custo?.real) || 0) * grade;
    poder += pi.efetivo * grade;
    qtdPecas += grade;
  }
  return { previsto, real, poder, qtdModelos: models.length, qtdPecas };
}
```

- [ ] **Step 2: Write the ColecaoSheet editor**

Create `src/components/otb/ColecaoSheet.tsx`. Mirror the Sheet pattern from `criacao.planejamento.tsx`'s `ModeloDialog` (flex-col, fixed footer via `shrink-0 border-t`). Fields: Nome (Input), Ano/Mês (`FieldSelect` from meses/anos via `useOpts`-style query), Orçamento (`NumberInput`), weeks table (checkbox per "1".."5" + `NumberInput` integer for qtd). Load existing collection + its `colecao_semanas` when `colecaoId` set. Save = upsert `colecoes` + diff `colecao_semanas`. Full skeleton:
```tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const WEEKS = ["1", "2", "3", "4", "5"];
type Opt = { id: string; nome: string };

export function ColecaoSheet({
  colecaoId, meses, anos, onClose, onSaved,
}: {
  colecaoId: string | null;
  meses: Opt[]; anos: Opt[];
  onClose: () => void; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [anoId, setAnoId] = useState<string | null>(null);
  const [mesId, setMesId] = useState<string | null>(null);
  const [orcamento, setOrcamento] = useState<string>("");
  const [weeks, setWeeks] = useState<Record<string, number | null>>({}); // semana→qtd (undefined = off)

  const { data } = useQuery({
    queryKey: ["otb-colecao", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data: col, error } = await supabase.from("colecoes").select("*, colecao_semanas(semana, qtd_planejada)").eq("id", colecaoId!).single();
      if (error) throw error;
      return col as any;
    },
  });
  useEffect(() => {
    if (!data) return;
    setNome(data.nome ?? "");
    setAnoId(data.ano_id ?? null);
    setMesId(data.mes_id ?? null);
    setOrcamento(data.orcamento != null ? String(data.orcamento) : "");
    const w: Record<string, number> = {};
    for (const s of data.colecao_semanas ?? []) w[s.semana] = s.qtd_planejada;
    setWeeks(w);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!nome.trim()) throw new Error("Informe o nome da coleção.");
      const payload = { nome: nome.trim(), ano_id: anoId, mes_id: mesId, orcamento: orcamento === "" ? null : Number(orcamento) };
      let id = colecaoId;
      if (id) {
        const { error } = await supabase.from("colecoes").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data: ins, error } = await supabase.from("colecoes").insert(payload).select("id").single();
        if (error) throw error;
        id = (ins as any).id;
      }
      // Diff das semanas: apaga as desmarcadas, upserta as marcadas.
      const marked = WEEKS.filter((s) => weeks[s] != null);
      await supabase.from("colecao_semanas").delete().eq("colecao_id", id!).not("semana", "in", `(${marked.map((s) => `'${s}'`).join(",") || "''"})`);
      for (const s of marked) {
        await supabase.from("colecao_semanas").upsert({ colecao_id: id!, semana: s, qtd_planejada: weeks[s] ?? 0 }, { onConflict: "colecao_id,semana" });
      }
      return id!;
    },
    onSuccess: () => { toast.success("Coleção salva"); qc.invalidateQueries({ queryKey: ["otb-colecoes"] }); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar coleção")),
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0">
        <SheetHeader className="p-4 border-b shrink-0"><SheetTitle>{colecaoId ? "Editar coleção" : "Nova coleção"}</SheetTitle></SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid gap-1"><Label>Nome</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="grid gap-1"><Label>Ano</Label>
              <Select value={anoId ?? ""} onValueChange={setAnoId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{anos.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1"><Label>Mês</Label>
              <Select value={mesId ?? ""} onValueChange={setMesId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{meses.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1"><Label>Orçamento</Label><NumberInput value={orcamento} onChange={setOrcamento} /></div>
          </div>
          <div>
            <Label className="mb-2 block">Semanas</Label>
            <div className="space-y-2">
              {WEEKS.map((s) => {
                const on = weeks[s] != null;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <Checkbox checked={on} onCheckedChange={(v) => setWeeks((w) => { const n = { ...w }; if (v) n[s] = n[s] ?? 0; else delete n[s]; return n; })} />
                    <span className="w-16 text-sm">Semana {s}</span>
                    {on && <div className="w-28"><NumberInput integer value={String(weeks[s] ?? 0)} onChange={(v) => setWeeks((w) => ({ ...w, [s]: Number(v) || 0 }))} /></div>}
                  </div>
                );
              })}
            </div>
          </div>
          {/* Painel de resumo é adicionado na Task 1.5 */}
        </div>
        <div className="p-4 border-t shrink-0 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```
(If `NumberInput` import path differs, confirm with `grep -rn "export.*NumberInput" src/components/ui`.)

- [ ] **Step 3: Write the OTB route (list + open editor)**

Create `src/routes/_authenticated/otb.index.tsx`. Mirror the header/query patterns of `criacao.planejamento.tsx`. List collections as cards (nome, ano/mês, status, orçamento). "Nova coleção" button + clicking a card opens `ColecaoSheet`. Gate the whole page on the module:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantModules } from "@/hooks/useTenantModules";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { Target, Plus } from "lucide-react";
import { ColecaoSheet } from "@/components/otb/ColecaoSheet";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/otb/")({ component: OtbPage });

function useOpts(table: string, key = "nome") {
  return useQuery({ queryKey: ["opt", table], queryFn: async () => {
    const { data } = await supabase.from(table as any).select(`id, ${key}`).order(key);
    return ((data ?? []) as any[]).map((r) => ({ id: r.id, nome: r[key] }));
  }});
}

function OtbPage() {
  const { isModuleEnabled } = useTenantModules();
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const { data: colecoes = [] } = useQuery({
    queryKey: ["otb-colecoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes").select("id, nome, status, orcamento, mes_id, ano_id").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  if (!isModuleEnabled("otb")) {
    return <div className="container mx-auto p-6"><EmptyState icon={Target} title="OTB não habilitado" description="Ative o módulo OTB nas configurações da loja." /></div>;
  }

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3"><Target className="h-7 w-7 text-primary mt-0.5" />
          <div><h1 className="text-2xl font-bold">OTB</h1><p className="text-sm text-muted-foreground">Orçamento de coleção.</p></div></div>
        <Button onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> Nova coleção</Button>
      </header>
      {colecoes.length === 0 ? (
        <EmptyState icon={Target} title="Nenhuma coleção" description="Crie a primeira coleção do OTB." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colecoes.map((c) => (
            <button key={c.id} onClick={() => setOpenId(c.id)} className="text-left rounded-lg border p-3 hover:bg-muted">
              <div className="flex items-center justify-between"><span className="font-semibold">{c.nome}</span>
                <span className="text-xs text-muted-foreground">{c.status === "confirmada" ? "Confirmada" : "Rascunho"}</span></div>
              <div className="text-sm text-muted-foreground mt-1">Orçamento: {c.orcamento != null ? brl(Number(c.orcamento)) : "—"}</div>
            </button>
          ))}
        </div>
      )}
      {(openNew || openId) && (
        <ColecaoSheet colecaoId={openId} meses={meses} anos={anos}
          onClose={() => { setOpenNew(false); setOpenId(null); }} onSaved={() => {}} />
      )}
    </div>
  );
}
```
(Confirm `EmptyState` + `brl` import paths with `grep -rn "export.*EmptyState" src/components` and `grep -rn "export.*brl" src/lib/format.ts`.)

- [ ] **Step 4: tsc + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2552|otb|colec" ; npm run build 2>&1 | tail -3`
Expected: no tsc errors; build `✓ built`. The route tree is regenerated by the router plugin during build.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/otb.index.tsx src/components/otb/
git commit -m "feat(otb): rota /otb com lista de coleções + editor (nome/ano/mês/orçamento/semanas)"
```

### Task 1.5: Budget panel in the editor (client-side resumo)

**Files:**
- Modify: `src/components/otb/ColecaoSheet.tsx`

**Interfaces:**
- Consumes: `computeColecaoResumo` (Task 1.4), `custo_unitario_modelos` RPC, `modelo_grades`, `linhas`.

- [ ] **Step 1: Load the collection's models + cost + grade + linha markup**

In `ColecaoSheet.tsx`, add queries (only when editing an existing collection):
```tsx
const { data: modelos = [] } = useQuery({
  queryKey: ["otb-colecao-modelos", colecaoId],
  enabled: !!colecaoId,
  queryFn: async () => {
    const { data, error } = await supabase.from("modelos").select("id, linha_id, preco_venda").eq("colecao_id", colecaoId!);
    if (error) throw error;
    return data as { id: string; linha_id: string | null; preco_venda: number | null }[];
  },
});
const modeloIds = modelos.map((m) => m.id).sort();
const { data: custoMap = {} } = useQuery({
  queryKey: ["otb-custo", modeloIds],
  enabled: modeloIds.length > 0,
  queryFn: async () => {
    const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: modeloIds });
    if (error) throw error;
    return (data ?? {}) as Record<string, { previsto: number; real: number; confirmado: boolean }>;
  },
});
const { data: gradeMap = {} } = useQuery({
  queryKey: ["otb-grade", modeloIds],
  enabled: modeloIds.length > 0,
  queryFn: async () => {
    const { data, error } = await supabase.from("modelo_grades").select("modelo_id, grade_total").in("modelo_id", modeloIds);
    if (error) throw error;
    const m: Record<string, number> = {};
    for (const r of (data ?? []) as any[]) m[r.modelo_id] = (m[r.modelo_id] ?? 0) + Number(r.grade_total ?? 0);
    return m;
  },
});
const { data: linhas = [] } = useQuery({
  queryKey: ["opt", "linhas", "markup"],
  queryFn: async () => {
    const { data } = await supabase.from("linhas").select("id, markup");
    return (data ?? []) as { id: string; markup: number | null }[];
  },
});
const linhaMarkupMap = Object.fromEntries(linhas.map((l) => [l.id, l.markup]));
```

- [ ] **Step 2: Compute the resumo + render the panel**

Add near the render:
```tsx
import { computeColecaoResumo } from "./otb-resumo";
import { brl } from "@/lib/format";
// …inside component, before return:
const resumo = computeColecaoResumo(modelos, custoMap as any, gradeMap as any, linhaMarkupMap as any);
const orc = orcamento === "" ? null : Number(orcamento);
const saldo = orc != null ? orc - resumo.previsto : null;
const pct = orc && orc > 0 ? resumo.previsto / orc : 0;
const statusCor = orc == null ? "text-muted-foreground" : pct > 1 ? "text-destructive" : pct >= 0.9 ? "text-amber-600" : "text-emerald-600";
const statusTxt = orc == null ? "Sem orçamento" : pct > 1 ? "Estourou" : pct >= 0.9 ? "Perto do teto" : "Dentro";
```
Panel JSX (replace the `{/* Painel … Task 1.5 */}` placeholder):
```tsx
<div className="rounded-lg border p-3 space-y-1 text-sm">
  <div className="flex justify-between"><span className="text-muted-foreground">Orçamento</span><span className="tabular-nums">{orc != null ? brl(orc) : "—"}</span></div>
  <div className="flex justify-between"><span className="text-muted-foreground">Custo previsto</span><span className="tabular-nums">{brl(resumo.previsto)}</span></div>
  <div className="flex justify-between"><span className="text-muted-foreground">Custo real</span><span className="tabular-nums">{brl(resumo.real)}</span></div>
  <div className="flex justify-between"><span className="text-muted-foreground">Poder de venda</span><span className="tabular-nums">{brl(resumo.poder)}</span></div>
  <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">Saldo (orç. − previsto)</span><span className="tabular-nums">{saldo != null ? brl(saldo) : "—"}</span></div>
  <div className={`flex justify-between font-medium ${statusCor}`}><span>Status</span><span>{statusTxt}</span></div>
  <div className="text-xs text-muted-foreground pt-1">{resumo.qtdModelos} modelo(s) · {resumo.qtdPecas} peça(s)</div>
</div>
```

- [ ] **Step 3: tsc + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "TS2304|otb|colec" ; npm run build 2>&1 | tail -3`
Expected: clean tsc; build OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/otb/ColecaoSheet.tsx
git commit -m "feat(otb): painel orçamento vs previsto/real + poder de venda (client-side, reusa preco.ts)"
```

---

## PHASE 2 — Card generation + reconciliation

### Task 2.1: RPC `otb_confirmar` (generate/reconcile blank cards)

**Files:**
- Create: `supabase/migrations/20260703110000_otb_confirmar.sql`
- Test: `tests/integration/otb.test.ts`

**Interfaces:**
- Produces: `public.otb_confirmar(_colecao_id uuid) returns jsonb` — `{ criados int, removidos int, mantidos int }`. Marks `colecoes.status='confirmada'`. Reconciles per `(colecao_id, semana)`: create diff of blank cards when target > existing; delete only "untouched blank" cards when target < existing; never delete a touched card.

- [ ] **Step 1: Write the migration**

```sql
-- OTB: confirmar coleção → gera/reconcilia cards em branco por semana.
-- "Card em branco/não tocado" = nome vazio E sem estilista E sem categoria E sem
-- fotos E sem tecidos_planejados. Nunca apaga card tocado. Módulo-gated.
create or replace function public.otb_confirmar(_colecao_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_col record;
  v_wk record;
  v_criados int := 0; v_removidos int := 0; v_mantidos int := 0;
  v_existing int; v_diff int; v_removable uuid[];
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  select * into v_col from colecoes where id = _colecao_id and tenant_id = v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;

  for v_wk in select semana, qtd_planejada from colecao_semanas where colecao_id = _colecao_id loop
    select count(*) into v_existing from modelos
      where tenant_id = v_tenant and colecao_id = _colecao_id and coalesce(semana,'') = v_wk.semana;
    v_diff := v_wk.qtd_planejada - v_existing;

    if v_diff > 0 then
      insert into modelos (colecao_id, colecao, semana, mes_id, ano_id, status_planejamento, versao,
                           nome, tecidos_planejados, fotos_modelo, fotos_referencia, observacoes_gerais)
      select _colecao_id, v_col.nome, v_wk.semana, v_col.mes_id, v_col.ano_id, 'em_planejamento', 1,
             '', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, ''
      from generate_series(1, v_diff);
      v_criados := v_criados + v_diff;

    elsif v_diff < 0 then
      -- remove só os "não tocados" desta semana, até -v_diff
      select array_agg(id) into v_removable from (
        select id from modelos
        where tenant_id = v_tenant and colecao_id = _colecao_id and coalesce(semana,'') = v_wk.semana
          and coalesce(nome,'') = '' and estilista_id is null and categoria_principal_id is null
          and coalesce(jsonb_array_length(coalesce(fotos_modelo,'[]'::jsonb)),0) = 0
          and coalesce(jsonb_array_length(coalesce(tecidos_planejados,'[]'::jsonb)),0) = 0
        order by created_at desc
        limit (-v_diff)
      ) t;
      if v_removable is not null then
        delete from modelos where id = any(v_removable);
        v_removidos := v_removidos + array_length(v_removable, 1);
      end if;
      v_mantidos := v_mantidos + (v_existing - v_wk.qtd_planejada) - coalesce(array_length(v_removable,1),0);
    end if;
  end loop;

  update colecoes set status = 'confirmada' where id = _colecao_id;
  return jsonb_build_object('criados', v_criados, 'removidos', v_removidos, 'mantidos', v_mantidos);
end;
$function$;

revoke execute on function public.otb_confirmar(uuid) from public, anon;
grant execute on function public.otb_confirmar(uuid) to authenticated;
select pg_notify('pgrst','reload schema');
```
(Note: `otb_confirmar` is the module-gated wrapper itself — it does the check inline, so it stays granted to `authenticated`; there is no separate `_core` here. Verify `modelos` columns `fotos_modelo`/`tecidos_planejados` are `jsonb` with `grep`/`\d modelos`; if `fotos_modelo` is `text[]`, use `'{}'::text[]` and `cardinality(...)` instead.)

- [ ] **Step 2: Confirm modelos column types (shape the SQL correctly)**

Run: `psql "$(cat /tmp/dburl.txt)" -c "\d public.modelos" | grep -E "fotos_modelo|tecidos_planejados|semana|estilista_id|categoria_principal_id"`
Expected: note the types. If `fotos_modelo`/`fotos_referencia` are arrays not jsonb, adjust the `insert … select` defaults and the `jsonb_array_length` guards to `cardinality(coalesce(fotos_modelo,'{}'))=0` before Step 3.

- [ ] **Step 3: Write the failing integration tests**

Append to `tests/integration/otb.test.ts`:
```ts
describe.skipIf(!hasDb)("OTB — otb_confirmar (geração/reconciliação)", () => {
  it("cria a qtd por semana; reconfirmar é idempotente; diminuir só apaga branco; não apaga preenchido", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // módulo otb ligado no tenant de teste (dentro da txn)
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-OTB-TEST','rascunho') returning id`, []);
      await c.query(`insert into colecao_semanas (colecao_id, semana, qtd_planejada) values ($1,'1',3)`, [col.id]);

      // 1) gera 3
      let r = await um<{ obj: any }>(c, `select public.otb_confirmar($1) as obj`, [col.id]);
      expect(r.obj.criados).toBe(3);
      let cnt = await um<{ n: string }>(c, `select count(*)::text n from modelos where colecao_id=$1 and semana='1'`, [col.id]);
      expect(cnt.n).toBe("3");

      // 2) idempotente: reconfirmar não cria/remove nada
      r = await um<{ obj: any }>(c, `select public.otb_confirmar($1) as obj`, [col.id]);
      expect(r.obj.criados).toBe(0); expect(r.obj.removidos).toBe(0);

      // 3) preenche 1 card (toca), baixa alvo p/ 1 → remove só 1 branco, mantém o preenchido + …
      await c.query(`update modelos set nome='PREENCHIDO' where colecao_id=$1 and semana='1' and coalesce(nome,'')='' limit 1`, [col.id]);
      await c.query(`update colecao_semanas set qtd_planejada=1 where colecao_id=$1 and semana='1'`, [col.id]);
      r = await um<{ obj: any }>(c, `select public.otb_confirmar($1) as obj`, [col.id]);
      // existiam 3, alvo 1, diff -2; brancos = 2 → remove 2, sobra o preenchido (mantidos reflete o excesso não-removível=0)
      expect(r.obj.removidos).toBe(2);
      cnt = await um<{ n: string }>(c, `select count(*)::text n from modelos where colecao_id=$1 and semana='1'`, [col.id]);
      expect(cnt.n).toBe("1");
      const nome = await um<{ nome: string }>(c, `select nome from modelos where colecao_id=$1 and semana='1'`, [col.id]);
      expect(nome.nome).toBe("PREENCHIDO");
    });
  });

  it("bloqueia quando o módulo otb está desligado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":false}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome) values ('C-OTB-OFF') returning id`, []);
      await expect(c.query(`select public.otb_confirmar($1)`, [col.id])).rejects.toThrow();
    });
  });
});
```
(Postgres has no `update … limit`; if Step-3's `update … limit 1` errors, replace with `update modelos set nome='PREENCHIDO' where id = (select id from modelos where colecao_id=$1 and semana='1' and coalesce(nome,'')='' limit 1)`.)

- [ ] **Step 4: Run tests to verify they FAIL (function missing)**

Run: `npx vitest run tests/integration/otb.test.ts`
Expected: FAIL — `function public.otb_confirmar(uuid) does not exist`.

- [ ] **Step 5: Apply the migration**

Run: `psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260703110000_otb_confirmar.sql`
Expected: `CREATE FUNCTION`/`REVOKE`/`GRANT`/`pg_notify`, no error.

- [ ] **Step 6: Run tests to verify they PASS**

Run: `npx vitest run tests/integration/otb.test.ts`
Expected: PASS (all cases). If a column-type mismatch fails, fix per Step 2 and re-apply.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260703110000_otb_confirmar.sql tests/integration/otb.test.ts
git commit -m "feat(otb): RPC otb_confirmar — gera/reconcilia cards por semana (nunca apaga preenchido)"
```

### Task 2.2: Wire "Confirmar" in the editor

**Files:** Modify `src/components/otb/ColecaoSheet.tsx`

- [ ] **Step 1: Add the Confirmar mutation + button**

In `ColecaoSheet.tsx`, add:
```tsx
const confirmar = useMutation({
  mutationFn: async () => {
    if (!colecaoId) throw new Error("Salve a coleção antes de confirmar.");
    await save.mutateAsync(); // garante semanas/orçamento persistidos
    const { data, error } = await supabase.rpc("otb_confirmar" as any, { _colecao_id: colecaoId });
    if (error) throw error;
    return data as { criados: number; removidos: number; mantidos: number };
  },
  onSuccess: (r) => {
    const partes = [r.criados ? `${r.criados} criado(s)` : "", r.removidos ? `${r.removidos} removido(s)` : "", r.mantidos ? `${r.mantidos} mantido(s) (preenchidos)` : ""].filter(Boolean);
    toast.success(`Coleção confirmada. ${partes.join(" · ") || "Sem mudanças."}`);
    qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
    qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
    onSaved(); onClose();
  },
  onError: (e: any) => toast.error(mensagemErro(e, "Erro ao confirmar coleção")),
});
```
Add the button in the footer, left of Salvar:
```tsx
<Button variant="secondary" onClick={() => confirmar.mutate()} disabled={confirmar.isPending || !colecaoId}>
  {confirmar.isPending ? "Confirmando…" : "Confirmar"}
</Button>
```
(`save.mutateAsync` requires `save` to be defined above; it is. If `save` currently closes the sheet on success, guard it: only `onClose()` from the outer mutations, or split a `persist()` helper — simplest: have `confirmar` call the same insert/update logic via a shared `persistColecao()` function instead of `save.mutateAsync`. Extract `persistColecao` if the double-close causes a flthis.)

- [ ] **Step 2: tsc + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "otb|colec|TS2304" ; npm run build 2>&1 | tail -3`
Expected: clean; build OK.

- [ ] **Step 3: Commit**

```bash
git add src/components/otb/ColecaoSheet.tsx
git commit -m "feat(otb): botão Confirmar (gera cards + toast de resultado)"
```

---

## PHASE 3 — Coleção condicional (dropdown) + importar

### Task 3.1: Planejamento — Coleção condicional + prefill mês/ano

**Files:** Modify `src/routes/_authenticated/criacao.planejamento.tsx`

**Interfaces:**
- Consumes: `useTenantModules().isModuleEnabled("otb")`; `colecoes` list `{id, nome, mes_id, ano_id}`.

- [ ] **Step 1: Load collections when OTB is on**

Near the other queries in the page component and in `ModeloDialog`, add:
```tsx
const { isModuleEnabled } = useTenantModules();
const otbOn = isModuleEnabled("otb");
const { data: colecoes = [] } = useQuery({
  queryKey: ["otb-colecoes-opts"],
  enabled: otbOn,
  queryFn: async () => {
    const { data } = await supabase.from("colecoes").select("id, nome, mes_id, ano_id").order("nome");
    return (data ?? []) as { id: string; nome: string; mes_id: string | null; ano_id: string | null }[];
  },
});
```
(Import `useTenantModules` at top.)

- [ ] **Step 2: Swap the Coleção field in ModeloDialog**

Replace the existing free-text Coleção field (`<FieldText label={fl("colecao")} value={draft.colecao} …/>`, ~line 1019) with a conditional:
```tsx
{otbOn ? (
  <FieldSelect
    label={fl("colecao")}
    value={draft.colecao_id ?? null}
    onChange={(v) => {
      const col = colecoes.find((c) => c.id === v);
      setDraft((d) => ({ ...d, colecao_id: v, colecao: col?.nome ?? d.colecao,
        mes_id: d.mes_id ?? col?.mes_id ?? null, ano_id: d.ano_id ?? col?.ano_id ?? null }));
    }}
    options={colecoes}
  />
) : (
  <FieldText label={fl("colecao")} value={draft.colecao} onChange={(v) => setDraft((d) => ({ ...d, colecao: v }))} />
)}
```
Add `colecao_id` to the `modelos` select (line ~220) and to the draft load (line ~786): `colecao_id: (data as any).colecao_id ?? null`, and to the initial empty draft. Ensure the save payload includes `colecao_id`.

- [ ] **Step 3: tsc + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "colec|otb|TS2304" ; npm run build 2>&1 | tail -3`
Expected: clean; build OK.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/criacao.planejamento.tsx
git commit -m "feat(otb): Planejamento — Coleção vira dropdown quando OTB ligado (+ prefill mês/ano)"
```

### Task 3.2: Desenvolvimento — Coleção condicional

**Files:** Modify `src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx` (+ its data loader `ModeloDetailPanel.tsx`)

- [ ] **Step 1: Thread `otbOn` + `colecoes` into ModeloInfoSection**

In `ModeloDetailPanel.tsx`, load `colecoes` (same query as Task 3.1 Step 1, gated on `isModuleEnabled("otb")`) and pass `otbOn`/`colecoes` as props to `ModeloInfoSection`. Add both to `ModeloInfoSection`'s prop types.

- [ ] **Step 2: Add the conditional Coleção field**

In `ModeloInfoSection.tsx`, add a Coleção field to the grid (mirroring Task 3.1 Step 2 with `FieldSelectOpt`/`Field` used in that file). When OTB off, render nothing new (Desenvolvimento today has no Coleção field — only add the dropdown when OTB on):
```tsx
{otbOn && (
  <FieldSelectOpt
    label="Coleção"
    value={draft.colecao_id}
    onChange={(v) => {
      const col = colecoes.find((c) => c.id === v);
      setDraft({ ...draft, colecao_id: v, colecao: col?.nome ?? draft.colecao,
        mes_id: draft.mes_id ?? col?.mes_id ?? null, ano_id: draft.ano_id ?? col?.ano_id ?? null });
    }}
    options={colecoes}
  />
)}
```
Ensure `colecao_id` is loaded/saved by the panel.

- [ ] **Step 3: tsc + build; Commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "colec|otb|TS2304" ; npm run build 2>&1 | tail -3` → clean.
```bash
git add src/components/desenvolvimento/
git commit -m "feat(otb): Desenvolvimento — dropdown de Coleção quando OTB ligado"
```

### Task 3.3: Vários Cards — Coleção condicional

**Files:** Modify `src/routes/_authenticated/criacao.planejamento.tsx` (`BatchCardsDialog`)

- [ ] **Step 1: Make Coleção conditional + write colecao_id**

In `BatchCardsDialog` (~line 1197): add `otbOn`/`colecoes` (pass from parent or read `useTenantModules` + the query). Replace the `<FieldText label="Coleção" …/>` (line ~1290) with the same conditional as Task 3.1 Step 2, storing a `colecaoId` state. In the insert payload (line ~1249), add `colecao_id: colecaoId`.

- [ ] **Step 2: tsc + build; Commit**

Run tsc+build → clean.
```bash
git add src/routes/_authenticated/criacao.planejamento.tsx
git commit -m "feat(otb): Vários Cards — Coleção dropdown quando OTB ligado"
```

### Task 3.4: RPC `otb_importar_colecoes` + button

**Files:**
- Create: `supabase/migrations/20260703120000_otb_importar_colecoes.sql`
- Modify: `src/routes/_authenticated/otb.index.tsx`
- Test: `tests/integration/otb.test.ts`

**Interfaces:**
- Produces: `public.otb_importar_colecoes() returns jsonb` — `{ importadas int, vinculados int }`. For each distinct non-empty `modelos.colecao` (text) with `colecao_id is null` in the tenant, create a `colecoes` row (status 'confirmada') if none with that name, and set `modelos.colecao_id`.

- [ ] **Step 1: Write the migration**

```sql
-- OTB: importar coleções já digitadas (texto) → cria linhas em colecoes e liga o FK.
create or replace function public.otb_importar_colecoes()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_nome text; v_col_id uuid; v_imp int := 0; v_vin int := 0; v_n int;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  for v_nome in
    select distinct trim(colecao) from modelos
    where tenant_id = v_tenant and colecao_id is null and coalesce(trim(colecao),'') <> ''
  loop
    select id into v_col_id from colecoes where tenant_id = v_tenant and nome = v_nome;
    if v_col_id is null then
      insert into colecoes (nome, status) values (v_nome, 'confirmada') returning id into v_col_id;
      v_imp := v_imp + 1;
    end if;
    update modelos set colecao_id = v_col_id
      where tenant_id = v_tenant and colecao_id is null and trim(colecao) = v_nome;
    get diagnostics v_n = row_count;
    v_vin := v_vin + v_n;
  end loop;

  return jsonb_build_object('importadas', v_imp, 'vinculados', v_vin);
end;
$function$;

revoke execute on function public.otb_importar_colecoes() from public, anon;
grant execute on function public.otb_importar_colecoes() to authenticated;
select pg_notify('pgrst','reload schema');
```

- [ ] **Step 2: Write the failing test**

Append to `tests/integration/otb.test.ts`:
```ts
describe.skipIf(!hasDb)("OTB — importar coleções existentes", () => {
  it("cria coleção a partir do texto e liga os modelos", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      await c.query(`insert into modelos (nome, colecao, status_planejamento, versao) values ('M1','ImportTest','em_planejamento',1),('M2','ImportTest','em_planejamento',1)`);
      const r = await um<{ obj: any }>(c, `select public.otb_importar_colecoes() as obj`, []);
      expect(r.obj.importadas).toBeGreaterThanOrEqual(1);
      const linked = await um<{ n: string }>(c, `select count(*)::text n from modelos m join colecoes col on col.id=m.colecao_id where col.nome='ImportTest'`, []);
      expect(Number(linked.n)).toBeGreaterThanOrEqual(2);
    });
  });
});
```

- [ ] **Step 3: Run → FAIL; apply; run → PASS**

Run: `npx vitest run tests/integration/otb.test.ts` → FAIL (function missing).
Run: `psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260703120000_otb_importar_colecoes.sql`
Run: `npx vitest run tests/integration/otb.test.ts` → PASS.

- [ ] **Step 4: Add the button in the OTB route**

In `otb.index.tsx` header, add next to "Nova coleção":
```tsx
const importar = useMutation({
  mutationFn: async () => {
    const { data, error } = await supabase.rpc("otb_importar_colecoes" as any);
    if (error) throw error;
    return data as { importadas: number; vinculados: number };
  },
  onSuccess: (r) => { toast.success(`${r.importadas} coleção(ões) importada(s), ${r.vinculados} modelo(s) vinculado(s).`); qc.invalidateQueries({ queryKey: ["otb-colecoes"] }); },
  onError: (e: any) => toast.error(mensagemErro(e, "Erro ao importar coleções")),
});
// button:
<Button variant="outline" onClick={() => importar.mutate()} disabled={importar.isPending}>Importar coleções existentes</Button>
```
(Add `useMutation`, `useQueryClient`, `toast`, `mensagemErro` imports.)

- [ ] **Step 5: tsc + build; Commit**

Run tsc+build → clean.
```bash
git add supabase/migrations/20260703120000_otb_importar_colecoes.sql tests/integration/otb.test.ts src/routes/_authenticated/otb.index.tsx
git commit -m "feat(otb): importar coleções digitadas (RPC + botão)"
```

---

## PHASE 4 — Preenchimento em massa no Planejamento

### Task 4.1: Selection mode in Planejamento

**Files:** Modify `src/routes/_authenticated/criacao.planejamento.tsx`

**Interfaces:**
- Produces: `selected: Set<string>` of model ids, a "Selecionar" toggle, per-card checkbox, select-all (filtered), count.

- [ ] **Step 1: Add selection state + toolbar controls**

In the page component:
```tsx
const [selMode, setSelMode] = useState(false);
const [selected, setSelected] = useState<Set<string>>(new Set());
const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
const selectAllFiltered = () => setSelected(new Set(sorted.map((m) => m.id)));
const clearSel = () => setSelected(new Set());
```
Add to the toolbar (next to AgrupamentoButton):
```tsx
<Button size="sm" variant={selMode ? "default" : "outline"} onClick={() => { setSelMode((v) => !v); clearSel(); }}>
  <CheckSquare className="h-4 w-4 mr-1" /> Selecionar
</Button>
{selMode && (
  <>
    <Button size="sm" variant="ghost" onClick={selectAllFiltered}>Todos ({sorted.length})</Button>
    <span className="text-xs text-muted-foreground">{selected.size} selecionado(s)</span>
    <Button size="sm" disabled={selected.size === 0} onClick={() => setOpenBulk(true)}>Definir em massa</Button>
  </>
)}
```
(Import `CheckSquare` from lucide; add `const [openBulk, setOpenBulk] = useState(false);`.)

- [ ] **Step 2: Render the checkbox on cards in selection mode**

Pass `selMode`, `checked`, `onToggleSel` to `ModeloCard` (or wrap the card). Minimal: in `renderCard`, wrap with a relative container and an overlay checkbox:
```tsx
const renderCard = (m: Modelo) => (
  <div key={m.id} className="relative">
    {selMode && (
      <div className="absolute left-2 top-2 z-10">
        <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggleSel(m.id)} />
      </div>
    )}
    <ModeloCard /* …existing props… */ onOpen={() => (selMode ? toggleSel(m.id) : setOpenId(m.id))} />
  </div>
);
```
(Move the existing `key`/props accordingly. Import `Checkbox`.)

- [ ] **Step 3: tsc + build; Commit**

Run tsc+build → clean.
```bash
git add src/routes/_authenticated/criacao.planejamento.tsx
git commit -m "feat(planejamento): modo de seleção de cards (checkbox + selecionar todos)"
```

### Task 4.2: Bulk-edit dialog + apply

**Files:**
- Create: `src/components/planejamento/BulkEditDialog.tsx`
- Modify: `src/routes/_authenticated/criacao.planejamento.tsx` (render + onSaved)

**Interfaces:**
- Consumes: selected ids, option lists (colecoes/grupos/categorias/sub1/sub2/estilistas/linhas/meses/anos), `otbOn`.
- Produces: `<BulkEditDialog ids={string[]} … onClose onSaved />` that updates only the fields the user set.

- [ ] **Step 1: Write the dialog**

Create `src/components/planejamento/BulkEditDialog.tsx`:
```tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Opt = { id: string; nome: string };
const NONE = "__keep__"; // "não alterar"

export function BulkEditDialog({
  ids, otbOn, colecoes, grupos, categorias, sub1, sub2, estilistas, linhas, meses, anos, onClose, onSaved,
}: {
  ids: string[]; otbOn: boolean;
  colecoes: (Opt & { mes_id?: string | null; ano_id?: string | null })[];
  grupos: Opt[]; categorias: (Opt & { grupo_id?: string | null })[];
  sub1: (Opt & { categoria_id?: string | null })[]; sub2: (Opt & { categoria_id?: string | null })[];
  estilistas: Opt[]; linhas: Opt[]; meses: Opt[]; anos: Opt[];
  onClose: () => void; onSaved: () => void;
}) {
  const [colecaoId, setColecaoId] = useState(NONE);
  const [grupo, setGrupo] = useState(NONE); // só cascata
  const [categoria, setCategoria] = useState(NONE);
  const [s1, setS1] = useState(NONE);
  const [s2, setS2] = useState(NONE);
  const [estilista, setEstilista] = useState(NONE);
  const [linha, setLinha] = useState(NONE);
  const [origem, setOrigem] = useState(NONE);
  const [semana, setSemana] = useState(NONE);
  const [mes, setMes] = useState(NONE);
  const [ano, setAno] = useState(NONE);
  const [status, setStatus] = useState(NONE);

  const catOpts = grupo === NONE ? categorias : categorias.filter((c) => c.grupo_id === grupo);
  const s1Opts = categoria === NONE ? [] : sub1.filter((s) => s.categoria_id === categoria);
  const s2Opts = categoria === NONE ? [] : sub2.filter((s) => s.categoria_id === categoria);

  const apply = useMutation({
    mutationFn: async () => {
      const patch: Record<string, any> = {};
      if (otbOn && colecaoId !== NONE) {
        patch.colecao_id = colecaoId;
        const col = colecoes.find((c) => c.id === colecaoId);
        if (col) patch.colecao = col.nome;
      }
      if (categoria !== NONE) { patch.categoria_principal_id = categoria; patch.subcategoria1_id = null; patch.subcategoria2_id = null; }
      if (s1 !== NONE) patch.subcategoria1_id = s1;
      if (s2 !== NONE) patch.subcategoria2_id = s2;
      if (estilista !== NONE) patch.estilista_id = estilista;
      if (linha !== NONE) patch.linha_id = linha;
      if (origem !== NONE) patch.origem = origem;
      if (semana !== NONE) patch.semana = semana;
      if (mes !== NONE) patch.mes_id = mes;
      if (ano !== NONE) patch.ano_id = ano;
      if (status !== NONE) patch.status_planejamento = status;
      if (Object.keys(patch).length === 0) throw new Error("Nada para alterar. Preencha ao menos um campo.");
      const { error } = await supabase.from("modelos").update(patch).in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => { toast.success(`${n} card(s) atualizado(s)`); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao atualizar cards")),
  });

  const field = (label: string, value: string, set: (v: string) => void, opts: Opt[]) => (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={set}>
        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Não alterar</SelectItem>
          {opts.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Definir em massa · {ids.length} card(s)</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Só os campos que você mudar de "Não alterar" são aplicados.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {otbOn && field("Coleção", colecaoId, setColecaoId, colecoes)}
          {field("Grupo (filtra categoria)", grupo, (v) => { setGrupo(v); setCategoria(NONE); setS1(NONE); setS2(NONE); }, grupos)}
          {field("Categoria", categoria, (v) => { setCategoria(v); setS1(NONE); setS2(NONE); }, catOpts)}
          {field("Subcategoria 1", s1, setS1, s1Opts)}
          {field("Subcategoria 2", s2, setS2, s2Opts)}
          {field("Estilista", estilista, setEstilista, estilistas)}
          {field("Linha", linha, setLinha, linhas)}
          {field("Origem", origem, setOrigem, [{ id: "interno", nome: "Interno" }, { id: "revenda", nome: "Revenda" }])}
          {field("Semana", semana, setSemana, ["1","2","3","4","5"].map((s) => ({ id: s, nome: s })))}
          {field("Mês", mes, setMes, meses)}
          {field("Ano", ano, setAno, anos)}
          {field("Status", status, setStatus, /* STATUS_OPTS mapped */ [])}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => apply.mutate()} disabled={apply.isPending}>{apply.isPending ? "Aplicando…" : "Aplicar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
(For Status options, pass the page's `STATUS_OPTS.map((s) => ({ id: s.value, nome: s.label }))`. Add a `status` prop or import `STATUS_OPTS` from where the page defines it.)

- [ ] **Step 2: Render the dialog in Planejamento**

In `criacao.planejamento.tsx`, load `sub1`/`sub2` option lists if not already present (the page already has grupos/categorias; add `subcategorias1_produto`/`subcategorias2_produto` queries). Render:
```tsx
{openBulk && (
  <BulkEditDialog
    ids={[...selected]} otbOn={otbOn}
    colecoes={colecoes} grupos={grupos} categorias={categorias}
    sub1={sub1} sub2={sub2} estilistas={estilistas} linhas={linhas} meses={meses} anos={anos}
    onClose={() => setOpenBulk(false)}
    onSaved={() => { qc.invalidateQueries({ queryKey: ["modelos-planejamento"] }); clearSel(); setSelMode(false); }}
  />
)}
```
(Import `BulkEditDialog`. Pass Status options into the dialog as noted.)

- [ ] **Step 3: tsc + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "colec|otb|Bulk|TS2304" ; npm run build 2>&1 | tail -3`
Expected: clean; build OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/planejamento/BulkEditDialog.tsx src/routes/_authenticated/criacao.planejamento.tsx
git commit -m "feat(planejamento): preenchimento em massa dos cards selecionados"
```

---

## PHASE 5 — OTB list: filtro ano/mês + badge de orçamento + xx/yy modelos

### Task 5.1: Enriquecer a lista de coleções em `/otb`

**Files:** Modify `src/routes/_authenticated/otb.index.tsx`

**Interfaces:**
- Consumes: `FilterButton` from `@/components/shared/filters`; `computeColecaoResumo` from `@/components/otb/otb-resumo`; `custo_unitario_modelos` RPC; `modelo_grades`, `colecao_semanas`, `linhas`, `modelos`.
- Produces: per-collection `{ planejado: number; vinculados: number; previsto: number; orcamento: number|null }` used by the card.

Requisitos:
1. **Filtro (ícone)** por **Ano** e **Mês**, usando o `FilterButton` compartilhado (mesmo padrão do Planejamento). Estado `fAno`/`fMes` (default `"all"`), aplicados à lista de coleções por `ano_id`/`mes_id`. Opções vêm de `meses`/`anos` (já carregados via `useOpts`).
2. **xx/yy modelos** em cada card:
   - **xx (planejado)** = Σ `qtd_planejada` das `colecao_semanas` daquela coleção.
   - **yy (vinculados)** = nº de `modelos` com `colecao_id` = a coleção.
   - Exibir como `"{xx}/{yy} modelos"` (ex.: `10/7 modelos`).
3. **Badge Dentro/Fora do orçamento** em cada card: compara `orcamento` vs **previsto** (Σ custo previsto × grade, via `computeColecaoResumo`). Regra: sem orçamento → sem badge (ou "—"); `previsto ≤ orçamento` → badge "Dentro" (verde); `previsto > orçamento` → badge "Fora" (vermelho/destructive). Reusar o componente `Badge` do shadcn.

Dados (carregar uma vez, agrupar por `colecao_id`):
- `colecao_semanas`: `select colecao_id, qtd_planejada` → soma por `colecao_id` = **xx**.
- `modelos`: `select id, colecao_id, linha_id, preco_venda from modelos where colecao_id not is null` → agrupa por `colecao_id`; a contagem por grupo = **yy**; a lista alimenta o resumo.
- `custo_unitario_modelos(_ids)` com todos os ids desses modelos; `modelo_grades` (`select modelo_id, grade_total`) com os mesmos ids; `linhas` (`select id, markup`).
- Por coleção: `computeColecaoResumo(modelosDaColecao, custoMap, gradeMap, linhaMarkupMap).previsto` → **previsto** p/ o badge.

- [ ] **Step 1: Add the ano/mês filter**

Import `FilterButton` from `@/components/shared/filters`. Add state `const [fAno, setFAno] = useState("all"); const [fMes, setFMes] = useState("all");`. Render `<FilterButton filters={[{ label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...anos] }, { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...meses] }]} />` in the header (next to "Nova coleção"/"Importar"). Filter the list: `const colecoesFiltradas = colecoes.filter((c) => (fAno === "all" || c.ano_id === fAno) && (fMes === "all" || c.mes_id === fMes));` and render `colecoesFiltradas` instead of `colecoes`.

- [ ] **Step 2: Load aggregate data (weeks, models, cost, grade, linha)**

```tsx
const { data: semanas = [] } = useQuery({
  queryKey: ["otb-semanas-todas"],
  queryFn: async () => {
    const { data, error } = await supabase.from("colecao_semanas").select("colecao_id, qtd_planejada");
    if (error) throw error;
    return (data ?? []) as { colecao_id: string; qtd_planejada: number }[];
  },
});
const { data: modelosLink = [] } = useQuery({
  queryKey: ["otb-modelos-link"],
  queryFn: async () => {
    const { data, error } = await supabase.from("modelos").select("id, colecao_id, linha_id, preco_venda").not("colecao_id", "is", null);
    if (error) throw error;
    return (data ?? []) as { id: string; colecao_id: string; linha_id: string | null; preco_venda: number | null }[];
  },
});
const modeloIds = modelosLink.map((m) => m.id).sort();
const { data: custoMap = {} } = useQuery({
  queryKey: ["otb-custo-lista", modeloIds],
  enabled: modeloIds.length > 0,
  queryFn: async () => {
    const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: modeloIds });
    if (error) throw error;
    return (data ?? {}) as Record<string, { previsto: number; real: number; confirmado: boolean }>;
  },
});
const { data: gradeMap = {} } = useQuery({
  queryKey: ["otb-grade-lista", modeloIds],
  enabled: modeloIds.length > 0,
  queryFn: async () => {
    const { data, error } = await supabase.from("modelo_grades").select("modelo_id, grade_total").in("modelo_id", modeloIds);
    if (error) throw error;
    const m: Record<string, number> = {};
    for (const r of (data ?? []) as any[]) m[r.modelo_id] = (m[r.modelo_id] ?? 0) + Number(r.grade_total ?? 0);
    return m;
  },
});
const { data: linhas = [] } = useQuery({
  queryKey: ["opt", "linhas", "markup"],
  queryFn: async () => {
    const { data } = await supabase.from("linhas").select("id, markup");
    return (data ?? []) as { id: string; markup: number | null }[];
  },
});
const linhaMarkupMap = Object.fromEntries(linhas.map((l) => [l.id, l.markup]));
```

- [ ] **Step 3: Compute per-collection stats**

```tsx
import { computeColecaoResumo } from "@/components/otb/otb-resumo";
// …
const statsByColecao = (() => {
  const planejado: Record<string, number> = {};
  for (const s of semanas) planejado[s.colecao_id] = (planejado[s.colecao_id] ?? 0) + Number(s.qtd_planejada ?? 0);
  const byCol: Record<string, typeof modelosLink> = {};
  for (const m of modelosLink) (byCol[m.colecao_id] ??= []).push(m);
  const out: Record<string, { planejado: number; vinculados: number; previsto: number }> = {};
  for (const c of colecoes) {
    const ms = byCol[c.id] ?? [];
    const resumo = computeColecaoResumo(ms as any, custoMap as any, gradeMap as any, linhaMarkupMap as any);
    out[c.id] = { planejado: planejado[c.id] ?? 0, vinculados: ms.length, previsto: resumo.previsto };
  }
  return out;
})();
```

- [ ] **Step 4: Render badge + xx/yy on each card**

In the card JSX, add (using the existing `Badge` import — add `import { Badge } from "@/components/ui/badge"` if missing):
```tsx
{(() => {
  const st = statsByColecao[c.id] ?? { planejado: 0, vinculados: 0, previsto: 0 };
  const orc = c.orcamento != null ? Number(c.orcamento) : null;
  const fora = orc != null && st.previsto > orc;
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="text-xs text-muted-foreground tabular-nums">{st.planejado}/{st.vinculados} modelos</span>
      {orc != null && (
        <Badge variant={fora ? "destructive" : "secondary"} className={fora ? "" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"}>
          {fora ? "Fora" : "Dentro"}
        </Badge>
      )}
    </div>
  );
})()}
```

- [ ] **Step 5: tsc + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "TS2304|otb|colec|Badge" ; npm run build 2>&1 | tail -3`
Expected: no tsc errors; build `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_authenticated/otb.index.tsx
git commit -m "feat(otb): lista com filtro ano/mês + badge dentro/fora + xx/yy modelos por coleção"
```

---

## Final verification (after all phases)

- [ ] Run the full integration suite: `npx vitest run tests/integration/otb.test.ts` → all PASS.
- [ ] `npx tsc --noEmit` → no errors. `npm run build` → `✓ built`.
- [ ] Manual smoke: enable `otb` for the test store in Gerenciar Lojas → `/otb` appears above Criação → create a collection with a budget + weeks → Confirmar → blank cards appear in Planejamento with that collection/week/month/year → select several → Definir em massa → apply category/etc. → panel shows previsto/real/poder as development fills in.
- [ ] Update docs: `docs/mapeamento-campos-calculos.md`, `docs/plano-de-ataque.md`, `docs/api-integracao-erp.md` (OTB fields + when the budget/cost is final) and the CLAUDE.md/memory (new `otb` module + `colecoes` entity) — role of `docs-keeper`.
- [ ] `git push origin main`. Reminder: **deploy is the owner's manual step** (`npm run deploy`).

## Deviations from spec (intentional)

- **Spec §7 said an `otb_resumo` RPC.** The plan computes the resumo **client-side** in `otb-resumo.ts`, reusing `preco.ts` (the price SSOT) and the same `custo_unitario_modelos` + `modelo_grades` queries Planejamento/Lançamentos already use. Rationale: DRY (no duplicated `precoSugerido` in SQL, which memory notes will become store config) and consistency with existing pages. Tenant-scoping is preserved by RLS on the underlying selects. If per-collection summaries in the LIST become a performance issue with many collections, revisit with a batch RPC.
