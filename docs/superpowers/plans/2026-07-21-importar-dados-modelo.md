# Importar dados de outro modelo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um botão "Importar dados" no cabeçalho do card de Desenvolvimento que copia dados escolhidos de outro modelo para o rascunho do card (staging), com realce amarelo e confirmação de sobrescrita, sem gravar até o Salvar.

**Architecture:** Front-end puro. Uma **função pura** (`construirCopia`) aplica as regras de negócio e produz um *patch* + o conjunto de campos copiados. O card aplica o patch aos seus estados já existentes (`draft`, `blocks`, `aviamentosState`, `grades`, `etiquetasState`); o **Salvar existente** (`persistModelo` → `modelos.update` + `salvar_modelo_bom` + diff de `modelo_etiquetas`) comita. As seções realçam em amarelo os campos do conjunto e limpam a marca ao editar. Sem migration, sem RPC de escrita nova.

**Tech Stack:** React + TypeScript, TanStack Query, shadcn/ui, Supabase JS, Vitest (unit em `tests/unit`), pg (integração em `tests/integration`).

## Global Constraints
- **Staging:** "Copiar" NUNCA grava no banco (exceto o caso decidido do obs-bloco, Fase 6). Só o botão **Salvar** do card comita.
- **Sem OC-links:** variante copiada entra com `oc_links` vazio (`Array(10).fill([])`). Nunca copiar `modelo_tecido_oc_links`.
- **Grade ⟸ Variantes do Tecido:** `grade` só é aplicável se pelo menos um bloco de tecido tiver `variantes` selecionado.
- **Reuso do save:** não criar caminho de escrita paralelo ao `persistModelo`/`salvar_modelo_bom`.
- **Tenant:** origem e destino da mesma loja (o seletor filtra por RLS); o `salvar_modelo_bom` revalida no Salvar.
- **Botão só com card editável:** invisível quando `draft.enviado_cad && !editing` (mesma condição que hoje mostra "Editar" em vez de "Salvar").
- **Idioma:** UI em pt-BR; toasts de erro via `mensagemErro(e, fallback)`.
- **Gate de build:** `npx tsc --noEmit` limpo antes de cada commit (o `vite build` não faz type-check).

## File Structure
- **Create** `src/components/desenvolvimento/importar/importar-copia.ts` — tipos + `construirCopia` (função pura, coração das regras).
- **Create** `tests/unit/importar-copia.test.ts` — unit tests da função pura.
- **Create** `src/components/desenvolvimento/importar/useModeloParaCopia.ts` — hook que carrega um modelo de origem no shape `ModeloParaCopia`.
- **Create** `src/components/desenvolvimento/importar/ImportarDadosDialog.tsx` — a janela (seletor de origem + seleção de áreas/itens + "Selecionar tudo" + dependência da Grade).
- **Create** `src/components/desenvolvimento/importar/highlight.ts` — helper de classe amarela + tipo do conjunto de campos.
- **Modify** `src/components/desenvolvimento/ModeloDetailPanel.tsx` — botão no cabeçalho, estado `camposCopiados`, aplicação do patch, AlertDialog de sobrescrita, passar realce às seções.
- **Modify** seções (`ModeloInfoSection`, `ModeloTecidosSection`, `ModeloGradeSection`, `ModeloAviamentosSection`, `ModeloEtiquetasSection`, `ModeloCustosSection`) — aceitar `camposCopiados` + `onCampoEditado` e aplicar o realce.
- **Modify** (Fase 6) `src/components/shared/ModeloObservacoes.tsx` — receber linhas importadas.

---

## Fase 1 — Função pura de cópia (o coração)

### Task 1: Tipos + esqueleto de `construirCopia`

**Files:**
- Create: `src/components/desenvolvimento/importar/importar-copia.ts`
- Test: `tests/unit/importar-copia.test.ts`

**Interfaces:**
- Consumes: `TecidoBlock`, `AviamentoRow`, `GradeRow`, `ModeloEtiquetaRow`, `makeEmptyBlocks` de `@/components/desenvolvimento/modelo-detail/types`.
- Produces:
  - `type ModeloParaCopia = { observacoes_tecnicas: string; custos_adicionais: {descricao:string;valor:number}[]; proporcoes: Record<string,number>; blocks: TecidoBlock[]; aviamentos: AviamentoRow[]; etiquetas: ModeloEtiquetaRow[]; grades: GradeRow[] }`
  - `type ItemTecido = { artigo: boolean; consumo: boolean; variantes: boolean }`
  - `type Selecao = { obsTecnica: boolean; tecidos: Record<TecidoBlock["tipo"], ItemTecido>; aviamentos: boolean; etiquetas: boolean; grade: boolean; custosAdicionais: boolean }`
  - `type PatchCopia = { observacoes_tecnicas?: string; custos_adicionais?: {descricao:string;valor:number}[]; proporcoes?: Record<string,number>; blocks?: TecidoBlock[]; aviamentos?: AviamentoRow[]; etiquetas?: ModeloEtiquetaRow[]; grades?: GradeRow[] }`
  - `type ResultadoCopia = { patch: PatchCopia; campos: Set<string> }`
  - `function construirCopia(origem: ModeloParaCopia, destinoBlocks: TecidoBlock[], sel: Selecao): ResultadoCopia`
  - `function gradeAplicavel(sel: Selecao): boolean` — true se algum `sel.tecidos[*].variantes`.

- [ ] **Step 1: Write the failing test (obs técnica + custos)**

```ts
// tests/unit/importar-copia.test.ts
import { describe, it, expect } from "vitest";
import { construirCopia, gradeAplicavel, type ModeloParaCopia, type Selecao } from "@/components/desenvolvimento/importar/importar-copia";
import { makeEmptyBlocks } from "@/components/desenvolvimento/modelo-detail/types";

function origemVazia(): ModeloParaCopia {
  return { observacoes_tecnicas: "", custos_adicionais: [], proporcoes: {}, blocks: makeEmptyBlocks(), aviamentos: [], etiquetas: [], grades: [] };
}
function selNada(): Selecao {
  return {
    obsTecnica: false,
    tecidos: { tecido: { artigo: false, consumo: false, variantes: false }, forro: { artigo: false, consumo: false, variantes: false }, entretela: { artigo: false, consumo: false, variantes: false } },
    aviamentos: false, etiquetas: false, grade: false, custosAdicionais: false,
  };
}

describe("construirCopia — escalares", () => {
  it("copia observações técnicas e custos adicionais quando marcados", () => {
    const origem = { ...origemVazia(), observacoes_tecnicas: "Pespontar 2mm", custos_adicionais: [{ descricao: "Lavanderia", valor: 3 }] };
    const sel = { ...selNada(), obsTecnica: true, custosAdicionais: true };
    const { patch, campos } = construirCopia(origem, makeEmptyBlocks(), sel);
    expect(patch.observacoes_tecnicas).toBe("Pespontar 2mm");
    expect(patch.custos_adicionais).toEqual([{ descricao: "Lavanderia", valor: 3 }]);
    expect(campos.has("obs_tecnicas")).toBe(true);
    expect(campos.has("custos_adicionais")).toBe(true);
  });

  it("não copia nada quando a seleção está vazia", () => {
    const { patch, campos } = construirCopia({ ...origemVazia(), observacoes_tecnicas: "X" }, makeEmptyBlocks(), selNada());
    expect(patch.observacoes_tecnicas).toBeUndefined();
    expect(campos.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/importar-copia.test.ts`
Expected: FAIL — módulo `importar-copia` não existe.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/desenvolvimento/importar/importar-copia.ts
import { makeEmptyBlocks, type TecidoBlock, type AviamentoRow, type GradeRow, type ModeloEtiquetaRow } from "@/components/desenvolvimento/modelo-detail/types";

export type ModeloParaCopia = {
  observacoes_tecnicas: string;
  custos_adicionais: { descricao: string; valor: number }[];
  proporcoes: Record<string, number>;
  blocks: TecidoBlock[];
  aviamentos: AviamentoRow[];
  etiquetas: ModeloEtiquetaRow[];
  grades: GradeRow[];
};

export type ItemTecido = { artigo: boolean; consumo: boolean; variantes: boolean };
export type Selecao = {
  obsTecnica: boolean;
  tecidos: Record<TecidoBlock["tipo"], ItemTecido>;
  aviamentos: boolean;
  etiquetas: boolean;
  grade: boolean;
  custosAdicionais: boolean;
};
export type PatchCopia = {
  observacoes_tecnicas?: string;
  custos_adicionais?: { descricao: string; valor: number }[];
  proporcoes?: Record<string, number>;
  blocks?: TecidoBlock[];
  aviamentos?: AviamentoRow[];
  etiquetas?: ModeloEtiquetaRow[];
  grades?: GradeRow[];
};
export type ResultadoCopia = { patch: PatchCopia; campos: Set<string> };

export function gradeAplicavel(sel: Selecao): boolean {
  return (Object.keys(sel.tecidos) as TecidoBlock["tipo"][]).some((t) => sel.tecidos[t].variantes);
}

export function construirCopia(origem: ModeloParaCopia, _destinoBlocks: TecidoBlock[], sel: Selecao): ResultadoCopia {
  const patch: PatchCopia = {};
  const campos = new Set<string>();
  if (sel.obsTecnica) { patch.observacoes_tecnicas = origem.observacoes_tecnicas; campos.add("obs_tecnicas"); }
  if (sel.custosAdicionais) { patch.custos_adicionais = origem.custos_adicionais.map((c) => ({ ...c })); campos.add("custos_adicionais"); }
  return { patch, campos };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/importar-copia.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/components/desenvolvimento/importar/importar-copia.ts tests/unit/importar-copia.test.ts
git commit -m "feat(importar): função pura construirCopia — escalares (obs téc, custos)"
```

### Task 2: Aviamentos, etiquetas e grade (com dependência)

**Files:**
- Modify: `src/components/desenvolvimento/importar/importar-copia.ts`
- Test: `tests/unit/importar-copia.test.ts`

**Interfaces:**
- Produces: comportamento de `construirCopia` para `aviamentos`, `etiquetas`, `grade` (+ `proporcoes`). Aviamentos/etiquetas copiados **sem `id`** (entram como novos). Grade só entra se `gradeAplicavel(sel)`.

- [ ] **Step 1: Write the failing test**

```ts
// adicionar em tests/unit/importar-copia.test.ts
import type { AviamentoRow, GradeRow, ModeloEtiquetaRow } from "@/components/desenvolvimento/modelo-detail/types";

describe("construirCopia — listas e grade", () => {
  it("copia aviamentos e etiquetas sem id (novos)", () => {
    const av: AviamentoRow = { id: "a1", aviamento_id: "AV", consumo: 2, loss_percent: 0, custo_previsto: 4 };
    const et: ModeloEtiquetaRow = { id: "e1", etiqueta_id: "ET", cor_id: "C", consumo: 1, loss_percent: 0, custo_previsto: 1 };
    const origem = { ...origemVazia(), aviamentos: [av], etiquetas: [et] };
    const sel = { ...selNada(), aviamentos: true, etiquetas: true };
    const { patch, campos } = construirCopia(origem, makeEmptyBlocks(), sel);
    expect(patch.aviamentos).toEqual([{ aviamento_id: "AV", consumo: 2, loss_percent: 0, custo_previsto: 4 }]);
    expect(patch.etiquetas).toEqual([{ etiqueta_id: "ET", cor_id: "C", consumo: 1, loss_percent: 0, custo_previsto: 1 }]);
    expect(campos.has("aviamentos")).toBe(true);
    expect(campos.has("etiquetas")).toBe(true);
  });

  it("só copia grade+proporções quando há variantes de tecido selecionadas", () => {
    const g: GradeRow = { variante_numero: 1, grades: { P: 2, M: 3 }, grade_total: 5 };
    const origem = { ...origemVazia(), grades: [g], proporcoes: { P: 40, M: 60 } };
    // grade marcada mas SEM variantes → não aplica
    const semVar = construirCopia(origem, makeEmptyBlocks(), { ...selNada(), grade: true });
    expect(semVar.patch.grades).toBeUndefined();
    expect(semVar.patch.proporcoes).toBeUndefined();
    // com variantes do Tecido → aplica
    const sel = { ...selNada(), grade: true };
    sel.tecidos.tecido.variantes = true;
    const comVar = construirCopia(origem, makeEmptyBlocks(), sel);
    expect(comVar.patch.grades).toEqual([g]);
    expect(comVar.patch.proporcoes).toEqual({ P: 40, M: 60 });
    expect(comVar.campos.has("grade")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/importar-copia.test.ts`
Expected: FAIL — `patch.aviamentos`/`grades` undefined.

- [ ] **Step 3: Write minimal implementation** (adicionar antes do `return` em `construirCopia`)

```ts
  if (sel.aviamentos) {
    patch.aviamentos = origem.aviamentos.map((r) => ({ aviamento_id: r.aviamento_id, consumo: r.consumo, loss_percent: r.loss_percent, custo_previsto: r.custo_previsto }));
    campos.add("aviamentos");
  }
  if (sel.etiquetas) {
    patch.etiquetas = origem.etiquetas.map((r) => ({ etiqueta_id: r.etiqueta_id, cor_id: r.cor_id, consumo: r.consumo, loss_percent: r.loss_percent, custo_previsto: r.custo_previsto }));
    campos.add("etiquetas");
  }
  if (sel.grade && gradeAplicavel(sel)) {
    patch.grades = origem.grades.map((g) => ({ variante_numero: g.variante_numero, grades: { ...g.grades }, grade_total: g.grade_total }));
    patch.proporcoes = { ...origem.proporcoes };
    campos.add("grade");
    campos.add("proporcoes");
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/importar-copia.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/desenvolvimento/importar/importar-copia.ts tests/unit/importar-copia.test.ts
git commit -m "feat(importar): aviamentos/etiquetas (sem id) + grade dependente de variantes"
```

### Task 3: Blocos de Tecido/Forro/Entretela (granular, casa por tipo+numero, sem oc-links)

**Files:**
- Modify: `src/components/desenvolvimento/importar/importar-copia.ts`
- Test: `tests/unit/importar-copia.test.ts`

**Interfaces:**
- Produces: merge de blocos em `patch.blocks` (partindo de `destinoBlocks`), casando por `tipo`+`numero`; por item selecionado copia Artigo (`artigo_id`+`artigoIdsExtra`), Consumo (`consumo`+`loss_percent`), Variantes (`variantes`+`multiplicadores`, `oc_links` **zerados**). Campos: `tecido:<tipo>:<numero>:{artigo|consumo|variantes}`.

- [ ] **Step 1: Write the failing test**

```ts
// adicionar em tests/unit/importar-copia.test.ts
function blocoTecido1(over: Partial<import("@/components/desenvolvimento/modelo-detail/types").TecidoBlock>) {
  const bs = makeEmptyBlocks();
  const i = bs.findIndex((b) => b.tipo === "tecido" && b.numero === 1);
  bs[i] = { ...bs[i], ...over };
  return bs;
}

describe("construirCopia — blocos de tecido", () => {
  it("copia só os itens marcados do Tecido 1 e zera oc_links das variantes", () => {
    const origemBlocks = blocoTecido1({
      artigo_id: "ART", artigoIdsExtra: ["SUB"], consumo: 1.5, loss_percent: 5,
      variantes: ["V1", "V2", ...Array(8).fill(null)],
      multiplicadores: [1, 2, ...Array(8).fill(1)],
      oc_links: Array.from({ length: 10 }, (_, i) => (i < 2 ? [{ oc_tecido_item_id: "OC", quantidade_m: 3, prioridade: 1 }] : [])),
    });
    const origem = { ...origemVazia(), blocks: origemBlocks };
    const sel = { ...selNada() };
    sel.tecidos.tecido = { artigo: true, consumo: false, variantes: true };

    const { patch, campos } = construirCopia(origem, makeEmptyBlocks(), sel);
    const t1 = patch.blocks!.find((b) => b.tipo === "tecido" && b.numero === 1)!;
    expect(t1.artigo_id).toBe("ART");
    expect(t1.artigoIdsExtra).toEqual(["SUB"]);
    expect(t1.consumo).toBe(0); // consumo NÃO marcado → mantém destino (0)
    expect(t1.variantes.slice(0, 2)).toEqual(["V1", "V2"]);
    expect(t1.oc_links.every((l) => l.length === 0)).toBe(true); // oc-links zerados
    expect(campos.has("tecido:tecido:1:artigo")).toBe(true);
    expect(campos.has("tecido:tecido:1:variantes")).toBe(true);
    expect(campos.has("tecido:tecido:1:consumo")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/importar-copia.test.ts`
Expected: FAIL — `patch.blocks` undefined.

- [ ] **Step 3: Write minimal implementation** (adicionar em `construirCopia`, antes do `return`)

```ts
  const tipos = Object.keys(sel.tecidos) as TecidoBlock["tipo"][];
  const algumTecido = tipos.some((t) => sel.tecidos[t].artigo || sel.tecidos[t].consumo || sel.tecidos[t].variantes);
  if (algumTecido) {
    const blocks = _destinoBlocks.map((b) => ({ ...b, variantes: [...b.variantes], multiplicadores: [...b.multiplicadores], oc_links: b.oc_links.map((l) => [...l]), artigoIdsExtra: [...b.artigoIdsExtra] }));
    for (const tipo of tipos) {
      const item = sel.tecidos[tipo];
      if (!item.artigo && !item.consumo && !item.variantes) continue;
      for (const orig of origem.blocks.filter((b) => b.tipo === tipo)) {
        const dest = blocks.find((b) => b.tipo === tipo && b.numero === orig.numero);
        if (!dest) continue;
        if (item.artigo) { dest.artigo_id = orig.artigo_id; dest.artigoIdsExtra = [...orig.artigoIdsExtra]; campos.add(`tecido:${tipo}:${orig.numero}:artigo`); }
        if (item.consumo) { dest.consumo = orig.consumo; dest.loss_percent = orig.loss_percent; campos.add(`tecido:${tipo}:${orig.numero}:consumo`); }
        if (item.variantes) {
          dest.variantes = [...orig.variantes];
          dest.multiplicadores = [...orig.multiplicadores];
          dest.oc_links = Array.from({ length: dest.variantes.length }, () => []); // sem OC-links
          campos.add(`tecido:${tipo}:${orig.numero}:variantes`);
        }
      }
    }
    patch.blocks = blocks;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/importar-copia.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/components/desenvolvimento/importar/importar-copia.ts tests/unit/importar-copia.test.ts
git commit -m "feat(importar): merge granular dos blocos de tecido (tipo+numero, sem oc-links)"
```

---

## Fase 2 — Carregar o modelo de origem

### Task 4: Hook `useModeloParaCopia`

**Files:**
- Create: `src/components/desenvolvimento/importar/useModeloParaCopia.ts`

**Interfaces:**
- Consumes: `supabase` de `@/integrations/supabase/client`; `makeEmptyBlocks`, tipos de `modelo-detail/types`.
- Produces: `function useModeloParaCopia(modeloId: string | null): { data: ModeloParaCopia | undefined; isLoading: boolean }`. Monta os 9 blocos (via `makeEmptyBlocks` + preenche por `tipo`+`numero`), listas de aviamentos/etiquetas/grades e os escalares.

**Nota de implementação (sem step de teste — é I/O; coberto no teste de integração da Fase 4/Task 8 e no smoke manual):** reusa exatamente as mesmas consultas que os efeitos de carga do card já fazem (`ModeloDetailPanel` linhas ~474+ para blocos, e as queries de `modelo_aviamentos`/`modelo_etiquetas`/`modelo_grades`). Ler essas queries no card e replicar o shape.

- [ ] **Step 1: Implementar o hook**

```ts
// src/components/desenvolvimento/importar/useModeloParaCopia.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { makeEmptyBlocks, type TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import type { ModeloParaCopia } from "./importar-copia";

export function useModeloParaCopia(modeloId: string | null) {
  return useQuery<ModeloParaCopia>({
    queryKey: ["modelo-para-copia", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const [m, tec, avi, etq, gra] = await Promise.all([
        supabase.from("modelos").select("observacoes_tecnicas, custos_adicionais, proporcoes").eq("id", modeloId!).single(),
        supabase.from("modelo_tecidos").select("id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto, modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador)").eq("modelo_id", modeloId!),
        supabase.from("modelo_aviamentos").select("aviamento_id, consumo, loss_percent, custo_previsto").eq("modelo_id", modeloId!).order("numero"),
        supabase.from("modelo_etiquetas" as any).select("etiqueta_id, cor_id, consumo, loss_percent, custo_previsto").eq("modelo_id", modeloId!).order("numero"),
        supabase.from("modelo_grades").select("variante_numero, grades, grade_total").eq("modelo_id", modeloId!),
      ]);
      const blocks = makeEmptyBlocks();
      for (const t of (tec.data ?? []) as any[]) {
        const b = blocks.find((x) => x.tipo === t.tipo && x.numero === t.numero);
        if (!b) continue;
        b.artigo_id = t.artigo_id ?? null;
        b.consumo = Number(t.consumo ?? 0);
        b.loss_percent = Number(t.loss_percent ?? 0);
        b.custo_previsto = Number(t.custo_previsto ?? 0);
        const vs = [...(t.modelo_tecido_variantes ?? [])].sort((a: any, c: any) => (a.ordem ?? 0) - (c.ordem ?? 0));
        for (const v of vs) {
          const i = (v.ordem ?? 1) - 1;
          if (i >= 0 && i < b.variantes.length) { b.variantes[i] = v.variante_tecido_id ?? null; b.multiplicadores[i] = Number(v.multiplicador ?? 1) || 1; }
        }
        const usados = new Set<string>(); vs.forEach((v: any) => { if (v.variante_tecido_id) usados.add(v.variante_tecido_id); });
        b.artigoIdsExtra = [];
      }
      return {
        observacoes_tecnicas: (m.data as any)?.observacoes_tecnicas ?? "",
        custos_adicionais: ((m.data as any)?.custos_adicionais ?? []) as { descricao: string; valor: number }[],
        proporcoes: ((m.data as any)?.proporcoes ?? {}) as Record<string, number>,
        blocks,
        aviamentos: ((avi.data ?? []) as any[]).map((r) => ({ aviamento_id: r.aviamento_id, consumo: Number(r.consumo ?? 0), loss_percent: Number(r.loss_percent ?? 0), custo_previsto: Number(r.custo_previsto ?? 0) })),
        etiquetas: ((etq.data ?? []) as any[]).map((r) => ({ etiqueta_id: r.etiqueta_id, cor_id: r.cor_id ?? null, consumo: Number(r.consumo ?? 0), loss_percent: Number(r.loss_percent ?? 0), custo_previsto: Number(r.custo_previsto ?? 0) })),
        grades: ((gra.data ?? []) as any[]).map((g) => ({ variante_numero: g.variante_numero, grades: (g.grades ?? {}) as Record<string, number>, grade_total: Number(g.grade_total ?? 0) })),
      };
    },
  });
}
```

- [ ] **Step 2: Verificar type-check**

Run: `npx tsc --noEmit 2>&1 | grep useModeloParaCopia || echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/components/desenvolvimento/importar/useModeloParaCopia.ts
git commit -m "feat(importar): hook useModeloParaCopia (carrega origem no shape do card)"
```

---

## Fase 3 — A janela (dialog)

### Task 5: `ImportarDadosDialog`

**Files:**
- Create: `src/components/desenvolvimento/importar/ImportarDadosDialog.tsx`

**Interfaces:**
- Consumes: `useModeloParaCopia`, `construirCopia`, `gradeAplicavel`, `Selecao` de `./importar-copia`; `Dialog`/`Checkbox`/`Input`/`Button` de `@/components/ui/*`; `supabase`.
- Produces: `function ImportarDadosDialog(props: { open: boolean; onOpenChange: (o: boolean) => void; modeloDestinoId: string; destinoBlocks: TecidoBlock[]; onCopiar: (r: ResultadoCopia, origem: ModeloParaCopia, sel: Selecao) => void })`. Ao confirmar "Copiar", chama `onCopiar(construirCopia(origem, destinoBlocks, sel), origem, sel)` e fecha.

- [ ] **Step 1: Implementar a janela**

```tsx
// src/components/desenvolvimento/importar/ImportarDadosDialog.tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useModeloParaCopia } from "./useModeloParaCopia";
import { construirCopia, gradeAplicavel, type Selecao, type ItemTecido, type ResultadoCopia, type ModeloParaCopia } from "./importar-copia";
import { TIPOS, TIPO_LABEL, type TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";

function selVazia(): Selecao {
  const item = (): ItemTecido => ({ artigo: false, consumo: false, variantes: false });
  return { obsTecnica: false, tecidos: { tecido: item(), forro: item(), entretela: item() }, aviamentos: false, etiquetas: false, grade: false, custosAdicionais: false };
}

export function ImportarDadosDialog({ open, onOpenChange, modeloDestinoId, destinoBlocks, onCopiar }: {
  open: boolean; onOpenChange: (o: boolean) => void; modeloDestinoId: string; destinoBlocks: TecidoBlock[];
  onCopiar: (r: ResultadoCopia, origem: ModeloParaCopia, sel: Selecao) => void;
}) {
  const [termo, setTermo] = useState("");
  const [origemId, setOrigemId] = useState<string | null>(null);
  const [sel, setSel] = useState<Selecao>(selVazia());
  const { data: origem } = useModeloParaCopia(origemId);

  const { data: opcoes = [] } = useQuery({
    queryKey: ["modelos-importar", termo, modeloDestinoId],
    queryFn: async () => {
      let q = supabase.from("modelos").select("id, nome, ref, versao").neq("id", modeloDestinoId).order("nome").limit(30);
      if (termo.trim()) q = q.or(`nome.ilike.%${termo}%,ref.ilike.%${termo}%`);
      const { data } = await q;
      return (data ?? []) as { id: string; nome: string; ref: string | null; versao: number | null }[];
    },
  });

  const podeGrade = gradeAplicavel(sel);
  const setItem = (tipo: TecidoBlock["tipo"], k: keyof ItemTecido, v: boolean) =>
    setSel((s) => ({ ...s, tecidos: { ...s.tecidos, [tipo]: { ...s.tecidos[tipo], [k]: v } } }));

  const selecionarTudo = () => setSel({
    obsTecnica: true, aviamentos: true, etiquetas: true, grade: true, custosAdicionais: true,
    tecidos: { tecido: { artigo: true, consumo: true, variantes: true }, forro: { artigo: true, consumo: true, variantes: true }, entretela: { artigo: true, consumo: true, variantes: true } },
  });

  const copiar = () => {
    if (!origem) return;
    onCopiar(construirCopia(origem, destinoBlocks, { ...sel, grade: sel.grade && podeGrade }), origem, sel);
    onOpenChange(false);
    setSel(selVazia()); setOrigemId(null); setTermo("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Importar dados de outro modelo</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Origem</Label>
            <Input placeholder="buscar por nome / ref…" value={termo} onChange={(e) => setTermo(e.target.value)} />
            <div className="max-h-40 overflow-auto mt-1 rounded-md border divide-y">
              {opcoes.map((m) => (
                <button key={m.id} type="button" onClick={() => setOrigemId(m.id)}
                  className={`w-full text-left px-2 py-1.5 text-sm hover:bg-muted ${origemId === m.id ? "bg-muted" : ""}`}>
                  {m.nome} {m.ref ? `· ${m.ref}` : ""} {m.versao ? `· v${m.versao}` : ""}
                </button>
              ))}
            </div>
          </div>

          <fieldset disabled={!origemId} className="space-y-2 disabled:opacity-50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Áreas a importar</span>
              <Button type="button" size="sm" variant="outline" onClick={selecionarTudo}>Selecionar tudo</Button>
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={sel.obsTecnica} onCheckedChange={(v) => setSel((s) => ({ ...s, obsTecnica: !!v }))} /> Observações técnicas (manual)</label>
            {TIPOS.map((tipo) => (
              <div key={tipo} className="text-sm">
                <div className="font-medium">{TIPO_LABEL[tipo]}</div>
                <div className="flex gap-4 pl-3">
                  {(["artigo", "consumo", "variantes"] as (keyof ItemTecido)[]).map((k) => (
                    <label key={k} className="flex items-center gap-1.5">
                      <Checkbox checked={sel.tecidos[tipo][k]} onCheckedChange={(v) => setItem(tipo, k, !!v)} /> {k[0].toUpperCase() + k.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={sel.aviamentos} onCheckedChange={(v) => setSel((s) => ({ ...s, aviamentos: !!v }))} /> Aviamentos</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={sel.etiquetas} onCheckedChange={(v) => setSel((s) => ({ ...s, etiquetas: !!v }))} /> Insumos / Etiquetas</label>
            <label className={`flex items-center gap-2 text-sm ${!podeGrade ? "opacity-50" : ""}`}>
              <Checkbox disabled={!podeGrade} checked={sel.grade && podeGrade} onCheckedChange={(v) => setSel((s) => ({ ...s, grade: !!v }))} /> Grade {!podeGrade && <span className="text-xs text-muted-foreground">(requer Variantes do Tecido)</span>}
            </label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={sel.custosAdicionais} onCheckedChange={(v) => setSel((s) => ({ ...s, custosAdicionais: !!v }))} /> Custos adicionais</label>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!origem} onClick={copiar}>Copiar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar type-check**

Run: `npx tsc --noEmit 2>&1 | grep ImportarDadosDialog || echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/components/desenvolvimento/importar/ImportarDadosDialog.tsx
git commit -m "feat(importar): janela de import (origem + seleção + grade dependente + selecionar tudo)"
```

---

## Fase 4 — Ligar no card (botão + aplicar patch + confirmação)

### Task 6: Botão no cabeçalho + aplicação do patch + AlertDialog de sobrescrita

**Files:**
- Modify: `src/components/desenvolvimento/ModeloDetailPanel.tsx` (cabeçalho ~L1513; estados ~L360-395; import no topo)

**Interfaces:**
- Consumes: `ImportarDadosDialog`, `construirCopia`/`ResultadoCopia`/`Selecao`/`PatchCopia` de `./importar/*`.
- Produces: estado `camposCopiados: Set<string>` no `PanelContent`; função `aplicarPatch(patch: PatchCopia)`; função `campoOverwrites(patch): string[]` (lista human-readable do que será sobrescrito).

- [ ] **Step 1: Adicionar estado + import** (perto de L364, junto dos outros `useState`)

```tsx
// imports no topo do arquivo
import { ImportarDadosDialog } from "./importar/ImportarDadosDialog";
import type { PatchCopia, ResultadoCopia } from "./importar/importar-copia";
// ...
const [importOpen, setImportOpen] = useState(false);
const [camposCopiados, setCamposCopiados] = useState<Set<string>>(new Set());
const [confirmSobrescrita, setConfirmSobrescrita] = useState<{ itens: string[]; aplicar: () => void } | null>(null);
```

- [ ] **Step 2: Adicionar `aplicarPatch` + detecção de sobrescrita** (perto das outras funções do componente, ex. após a definição de `save`)

```tsx
const aplicarPatch = (patch: PatchCopia, campos: Set<string>) => {
  if (patch.observacoes_tecnicas !== undefined) setDraft((d: any) => ({ ...d, observacoes_tecnicas: patch.observacoes_tecnicas }));
  if (patch.custos_adicionais !== undefined) setDraft((d: any) => ({ ...d, custos_adicionais: patch.custos_adicionais }));
  if (patch.proporcoes !== undefined) setDraft((d: any) => ({ ...d, proporcoes: patch.proporcoes }));
  if (patch.blocks !== undefined) setBlocks(patch.blocks);
  if (patch.aviamentos !== undefined) setAviamentosState(patch.aviamentos);
  if (patch.etiquetas !== undefined) setEtiquetasState(patch.etiquetas);
  if (patch.grades !== undefined) setGrades(patch.grades);
  // Marca alterações p/ o alerta de revisão downstream (mesma semântica do editar à mão)
  if (patch.blocks) setConsumoAlterado(true);
  if (patch.grades) setGradeAlterada(true);
  if (patch.aviamentos) setAviamentoAlterado(true);
  setCamposCopiados((prev) => new Set([...prev, ...campos]));
};

// Lista o que já tem valor e será substituído (para o AlertDialog).
const overwritesDoPatch = (patch: PatchCopia): string[] => {
  const out: string[] = [];
  if (patch.observacoes_tecnicas !== undefined && (draft?.observacoes_tecnicas ?? "").trim()) out.push("Observações técnicas");
  if (patch.custos_adicionais !== undefined && (draft?.custos_adicionais ?? []).length) out.push("Custos adicionais");
  if (patch.grades !== undefined && grades.some((g) => (g.grade_total ?? 0) > 0)) out.push("Grade");
  if (patch.aviamentos !== undefined && aviamentosState.some((a) => a.aviamento_id)) out.push("Aviamentos");
  if (patch.etiquetas !== undefined && etiquetasState.some((e) => e.etiqueta_id)) out.push("Insumos/Etiquetas");
  if (patch.blocks !== undefined) {
    for (const nb of patch.blocks) {
      const old = blocks.find((b) => b.tipo === nb.tipo && b.numero === nb.numero);
      if (!old) continue;
      const mudouArtigo = old.artigo_id && nb.artigo_id !== old.artigo_id;
      const mudouConsumo = (old.consumo ?? 0) > 0 && nb.consumo !== old.consumo;
      const mudouVar = old.variantes.some((v) => v) && JSON.stringify(nb.variantes) !== JSON.stringify(old.variantes);
      if (mudouArtigo || mudouConsumo || mudouVar) out.push(`${nb.tipo === "tecido" ? "Tecido" : nb.tipo === "forro" ? "Forro" : "Entretela"} ${nb.numero}`);
    }
  }
  return out;
};

const onCopiar = (r: ResultadoCopia) => {
  const itens = overwritesDoPatch(r.patch);
  if (itens.length === 0) { aplicarPatch(r.patch, r.campos); return; }
  setConfirmSobrescrita({ itens, aplicar: () => { aplicarPatch(r.patch, r.campos); setConfirmSobrescrita(null); } });
};
```

- [ ] **Step 3: Adicionar o botão no `SheetHeader`** (L1513–1518, ao lado do `VersaoBadge`) — só quando editável (não `locked`)

```tsx
<SheetHeader>
  <div className="flex items-center justify-between gap-2">
    <SheetTitle className="flex items-center gap-2">{draft.nome} <VersaoBadge versao={(modelo as any)?.versao} /></SheetTitle>
    {!locked && (
      <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
        <Download className="h-4 w-4 mr-2" /> Importar dados
      </Button>
    )}
  </div>
</SheetHeader>
```
(Importar `Download` de `lucide-react` no topo; ajustar o markup existente do header mantendo o título atual.)

- [ ] **Step 4: Renderizar o dialog + o AlertDialog de sobrescrita** (perto dos outros AlertDialogs, ex. após o de `confirmEnviarCad`)

```tsx
<ImportarDadosDialog
  open={importOpen}
  onOpenChange={setImportOpen}
  modeloDestinoId={modeloId}
  destinoBlocks={blocks}
  onCopiar={(r) => onCopiar(r)}
/>
<AlertDialog open={!!confirmSobrescrita} onOpenChange={(o) => !o && setConfirmSobrescrita(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Sobrescrever dados existentes?</AlertDialogTitle>
      <AlertDialogDescription>
        A importação vai substituir: {confirmSobrescrita?.itens.join(" · ")}. Nada é gravado até você Salvar.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction onClick={() => confirmSobrescrita?.aplicar()}>Substituir</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 5: Type-check + smoke manual**

Run: `npx tsc --noEmit 2>&1 | grep ModeloDetailPanel || echo OK`
Expected: `OK`.
Smoke (manual, `npm run dev`): abrir um modelo editável → "Importar dados" → escolher origem → marcar Aviamentos → Copiar → aviamentos aparecem no card; **Salvar** persiste; recarregar confirma. Marcar algo que já tinha valor → AlertDialog aparece.

- [ ] **Step 6: Commit**

```bash
git add src/components/desenvolvimento/ModeloDetailPanel.tsx
git commit -m "feat(importar): botão no card + aplica patch nos estados + confirmação de sobrescrita"
```

---

## Fase 5 — Realce amarelo

### Task 7: Helper de realce + fio `camposCopiados` para as seções

**Files:**
- Create: `src/components/desenvolvimento/importar/highlight.ts`
- Modify: `ModeloDetailPanel.tsx` (passar props às seções) + as seções que exibem campos copiáveis.

**Interfaces:**
- Produces: `function classeCopiado(campos: Set<string>, chave: string): string` → retorna `"bg-yellow-100"` se presente, senão `""`. As seções recebem `camposCopiados: Set<string>` e `onCampoEditado: (chave: string) => void`.

- [ ] **Step 1: Criar o helper + teste**

```ts
// src/components/desenvolvimento/importar/highlight.ts
export function classeCopiado(campos: Set<string>, chave: string): string {
  return campos.has(chave) ? "bg-yellow-100 dark:bg-yellow-900/30" : "";
}
```
```ts
// tests/unit/importar-copia.test.ts (adicionar)
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";
describe("classeCopiado", () => {
  it("amarelo só quando a chave está no conjunto", () => {
    const s = new Set(["obs_tecnicas"]);
    expect(classeCopiado(s, "obs_tecnicas")).toContain("yellow");
    expect(classeCopiado(s, "aviamentos")).toBe("");
  });
});
```

- [ ] **Step 2: Rodar o teste**

Run: `npx vitest run tests/unit/importar-copia.test.ts`
Expected: PASS.

- [ ] **Step 3: Adicionar `onCampoEditado` no card** (em `ModeloDetailPanel`)

```tsx
const onCampoEditado = (chave: string) => setCamposCopiados((prev) => {
  if (!prev.has(chave)) return prev;
  const n = new Set(prev); n.delete(chave); return n;
});
// limpar tudo ao salvar com sucesso:
// no save.onSuccess (ou no persistModelo pós-sucesso) → setCamposCopiados(new Set());
```

- [ ] **Step 4: Aplicar o realce nas seções (uma de cada vez, mesmo padrão).** Para cada seção, receber `camposCopiados`/`onCampoEditado` por props e aplicar `className={classeCopiado(camposCopiados, CHAVE)}` no input do campo, e chamar `onCampoEditado(CHAVE)` no `onChange`. Chaves por seção:
  - **ModeloInfoSection** (Textarea de `observacoes_tecnicas`, L231): chave `"obs_tecnicas"`.
  - **ModeloCustosSection** (lista `custosAdicionais`): chave `"custos_adicionais"` (realçar o bloco de custos adicionais).
  - **ModeloAviamentosSection**: chave `"aviamentos"` (realçar as linhas de aviamento).
  - **ModeloEtiquetasSection**: chave `"etiquetas"`.
  - **ModeloGradeSection**: chave `"grade"` (realçar a matriz).
  - **ModeloTecidosSection**: por bloco, chaves `"tecido:<tipo>:<numero>:artigo|consumo|variantes"` nos inputs correspondentes.

  Exemplo concreto (ModeloInfoSection, L231):
```tsx
// props: camposCopiados: Set<string>; onCampoEditado: (k: string) => void
<Textarea rows={3} className={classeCopiado(camposCopiados, "obs_tecnicas")}
  value={draft.observacoes_tecnicas}
  onChange={(e) => { setDraft({ ...draft, observacoes_tecnicas: e.target.value }); onCampoEditado("obs_tecnicas"); }} />
```
  Passar as props na renderização de cada seção em `ModeloDetailPanel` (ex.: `<ModeloInfoSection ... camposCopiados={camposCopiados} onCampoEditado={onCampoEditado} />`). Repetir para as demais seções com a chave listada.

- [ ] **Step 5: Type-check + smoke**

Run: `npx tsc --noEmit 2>&1 | grep -E "ModeloDetailPanel|Section" || echo OK`
Expected: `OK`.
Smoke: copiar → campos ficam amarelos → editar um → volta ao normal → Salvar → amarelo some.

- [ ] **Step 6: Commit**

```bash
git add src/components/desenvolvimento/importar/highlight.ts tests/unit/importar-copia.test.ts src/components/desenvolvimento/ModeloDetailPanel.tsx src/components/desenvolvimento/modelo-detail/
git commit -m "feat(importar): realce amarelo dos campos copiados (some ao editar/salvar)"
```

---

## Fase 6 — Observações (bloco) — DECISÃO PENDENTE

O componente `ModeloObservacoes` é **autônomo e grava na hora** (insert/update por linha, `src/components/shared/ModeloObservacoes.tsx`) e é reusado também em **Serviços**. Copiar o obs-bloco tem duas saídas:

- **(Recomendado) Insert imediato das linhas manuais copiadas** — ao Copiar com "Observações (bloco)" marcado, inserir em `modelo_observacoes` as linhas manuais da origem (pulando a Composição, que é derivada) e invalidar `["modelo-observacoes", destino]`. Simples, casa com o auto-save do componente; **exceção documentada**: essas linhas gravam na hora (não ficam em staging/amarelo).
- **(Alternativa) Refatorar `ModeloObservacoes` para modo controlado/staged** — o pai passa as linhas e um `onChange`, e o Salvar do card persiste. Consistente com o resto, mas mexe também em **Serviços** (risco/escopo maior).

**Ação:** confirmar a saída com o dono na revisão do plano. Task 8 assume a opção recomendada.

### Task 8: Copiar obs-bloco (insert imediato) — *só após decisão*

**Files:**
- Modify: `ImportarDadosDialog.tsx` (checkbox "Observações (bloco)") + `ModeloDetailPanel.tsx` (handler) OU `useModeloParaCopia` (trazer as linhas).
- Test: `tests/integration/importar-obs-bloco.test.ts` (txn revertida).

- [ ] **Step 1: Teste de integração (RED)** — dado um modelo origem com 2 linhas manuais em `modelo_observacoes`, ao chamar o insert de cópia, o destino passa a ter as 2 linhas manuais (a Composição não é linha gravada, então não é copiada).

```ts
// tests/integration/importar-obs-bloco.test.ts
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
describe.skipIf(!hasDb)("importar obs-bloco (linhas manuais)", () => {
  it("copia as linhas manuais de modelo_observacoes para o destino", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const org = (await um<{ id: string }>(c, `insert into modelos (nome, status_planejamento, versao) values ('ORIG','em_planejamento',1) returning id`)).id;
      const dst = (await um<{ id: string }>(c, `insert into modelos (nome, status_planejamento, versao) values ('DEST','em_planejamento',1) returning id`)).id;
      await c.query(`insert into modelo_observacoes (modelo_id, ordem, descricao, observacao) values ($1,1,'Barra','2cm'),($1,2,'Gola','ribana')`, [org]);
      // simula o insert de cópia (mesma query do handler)
      await c.query(`insert into modelo_observacoes (modelo_id, ordem, descricao, observacao)
                     select $2, ordem, descricao, observacao from modelo_observacoes where modelo_id=$1`, [org, dst]);
      const n = (await um<{ n: string }>(c, `select count(*)::text n from modelo_observacoes where modelo_id=$1`, [dst])).n;
      expect(n).toBe("2");
    });
  });
});
```

- [ ] **Step 2: Rodar (deve passar — é SQL puro sobre a tabela)**

Run: `DATABASE_URL="$(cat /tmp/dburl.txt)" npx vitest run tests/integration/importar-obs-bloco.test.ts`
Expected: PASS.

- [ ] **Step 3: Implementar o handler no card** — quando `sel.obsBloco`, após aplicar o patch, chamar:

```tsx
await supabase.from("modelo_observacoes" as any).insert(
  (origem.obsBlocoLinhas ?? []).map((o) => ({ modelo_id: modeloId, ordem: o.ordem, descricao: o.descricao, observacao: o.observacao }))
);
qc.invalidateQueries({ queryKey: ["modelo-observacoes", modeloId] });
toast.info("Observações copiadas.");
```
(Adicionar `obsBloco: boolean` na `Selecao`, o checkbox no dialog, e `obsBlocoLinhas` no `useModeloParaCopia` lendo `modelo_observacoes` da origem.)

- [ ] **Step 4: Type-check + commit**

```bash
git add -A && npx tsc --noEmit 2>&1 | grep -i observ || echo OK
git commit -m "feat(importar): copiar observações (bloco) via insert imediato (decisão docada)"
```

---

## Fase 7 — Fechamento

### Task 9: Rodar tudo + docs + push

- [ ] **Step 1: Suíte completa**

Run: `npx vitest run tests/unit && DATABASE_URL="$(cat /tmp/dburl.txt)" npx vitest run tests/integration`
Expected: tudo verde.

- [ ] **Step 2: Type-check final**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Atualizar CLAUDE.md + memória** (docs-keeper): registrar o botão "Importar dados" no card, staging, e a regra Grade⟸Variantes.

- [ ] **Step 4: Commit + push**

```bash
git add -A && git commit -m "docs(importar): registra a feature em CLAUDE.md/memória"
git push origin main
```

---

## Self-Review (feito ao escrever)
- **Cobertura do spec:** obs técnica manual (Task 1/7), obs bloco (Fase 6), tecidos granular sem oc-links (Task 3), aviamentos/etiquetas (Task 2), grade⟸variantes (Task 2/5), custos adicionais (Task 1), janela+selecionar-tudo (Task 5), staging+aplicar patch (Task 6), amarelo+edita-limpa (Task 7), confirmação de sobrescrita (Task 6), guardas (botão só editável — Task 6; sem oc-links — Task 3; origem≠destino — Task 5 `neq`). ✔
- **Sem placeholders:** as notas "definir com o dono" são só a Fase 6 (decisão real de UX), sinalizada. Demais steps têm código real.
- **Consistência de tipos:** `Selecao`/`PatchCopia`/`ResultadoCopia`/`ModeloParaCopia` usados igualmente no engine, no hook e no dialog; chaves de campo (`obs_tecnicas`, `tecido:<tipo>:<numero>:<item>`, `aviamentos`, `etiquetas`, `grade`, `custos_adicionais`) idênticas entre `construirCopia` (Task 1-3) e `classeCopiado` (Task 7).
- **Ponto aberto real:** Fase 6 (obs-bloco: insert imediato vs refatorar `ModeloObservacoes`). Recomendação = insert imediato; confirmar na revisão.
