# Plan. Tecido R4 — Aplicar Grade ao Modelo + Seleção Múltipla

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar dois recursos ao módulo Plan. Tecido: (10) botão "Aplicar grade ao modelo" que chama a RPC `aplicar_plan_tecido_grade` para empurrar a grade do slot ao card de modelo, e (11) seleção múltipla de cards para aplicar o mesmo tecido em massa (estado local apenas).

**Architecture:** Item 10 é a única escrita em produção (via RPC guardada `aplicar_plan_tecido_grade`); o helper `distribuirGrade` em `calc.ts` é puro e coberto por testes. Item 11 é puramente estado local em `PlanTecidoSheet`: um `Set` de chaves de slot + um mini-form inline que atualiza a `arvore` sem tocar o banco.

**Tech Stack:** React 18 + TypeScript + TanStack Query v5 + Supabase JS + shadcn/Radix UI + Vitest

## Global Constraints

- Branch: `feature/plan-tecido-a1` (já com checkout feito)
- `.rpc()` em RPCs não tipadas: usar `as any`
- `tsc --noEmit` deve terminar com 0 erros após cada commit
- `npm run build` deve passar (Vite)
- `npm run test:unit -- plan-tecido` deve ser verde
- Item 10: ÚNICA escrita em produção, via RPC `aplicar_plan_tecido_grade` — NÃO chamar `salvar_modelo_bom` nem `.insert/.update` direto em `modelos`/`modelo_*`
- Item 11: estado local apenas — NÃO escrever em produção
- Mensagens de erro: `mensagemErro(e, fallback)` de `@/lib/erro-mensagem`
- `toast.error` / `toast.success` via `sonner`
- Commit com trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Caminho do report: `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/task-R4-report.md`

---

## File Map

| Arquivo | Ação |
|---|---|
| `src/lib/plan-tecido/calc.ts` | Modificar — adicionar `distribuirGrade` |
| `tests/unit/plan-tecido-calc.test.ts` | Modificar — adicionar testes de `distribuirGrade` |
| `src/components/plan-tecido/ModelCard.tsx` | Modificar — adicionar botão "Aplicar grade ao modelo" + AlertDialog |
| `src/components/plan-tecido/PlanTecidoSheet.tsx` | Modificar — adicionar seleção múltipla + barra de ação + mini-form |

---

### Task 1: Helper `distribuirGrade` + testes

**Files:**
- Modify: `src/lib/plan-tecido/calc.ts`
- Modify: `tests/unit/plan-tecido-calc.test.ts`

**Interfaces:**
- Produces: `distribuirGrade(gradeTotal: number, proporcoes: Record<string,number> | null | undefined): Record<string, number>`
  - Distribui `gradeTotal` pelos tamanhos de `proporcoes`, proporcional ao peso
  - Resto (arredondamento) vai pro tamanho de maior peso
  - Se `proporcoes` for null/undefined/vazio → retorna `{}`
  - Tamanhos com peso 0 → ficam com 0
  - Retorno: `Record<string, number>` (inteiros, pois peças são inteiras)

- [ ] **Step 1.1: Escrever os testes que devem falhar**

Em `tests/unit/plan-tecido-calc.test.ts`, adicionar um novo `describe` no final:

```typescript
import { distribuirGrade } from "@/lib/plan-tecido/calc";

describe("distribuirGrade", () => {
  it("distribui proporcionalmente, soma = gradeTotal", () => {
    const r = distribuirGrade(100, { PP: 1, M: 2, G: 1 });
    // PP=25, M=50, G=25
    expect(Object.values(r).reduce((s, n) => s + n, 0)).toBe(100);
    expect(r["M"]).toBe(50);
    expect(r["PP"]).toBe(25);
    expect(r["G"]).toBe(25);
  });

  it("resto de arredondamento vai pro tamanho de maior peso", () => {
    // PP:1, M:2, G:1 → pesos=[1,2,1] soma=4; 10÷4=2,5 → PP=2, M=5, G=2 + resto=1 → M (maior peso)
    const r = distribuirGrade(10, { PP: 1, M: 2, G: 1 });
    expect(Object.values(r).reduce((s, n) => s + n, 0)).toBe(10);
    expect(r["M"]).toBe(6); // 5 + resto 1
    expect(r["PP"]).toBe(2);
    expect(r["G"]).toBe(2);
  });

  it("proporcoes null → {}", () => {
    expect(distribuirGrade(100, null)).toEqual({});
  });

  it("proporcoes undefined → {}", () => {
    expect(distribuirGrade(100, undefined)).toEqual({});
  });

  it("proporcoes vazio → {}", () => {
    expect(distribuirGrade(100, {})).toEqual({});
  });

  it("gradeTotal 0 → todos 0", () => {
    const r = distribuirGrade(0, { PP: 1, M: 2, G: 1 });
    expect(Object.values(r).reduce((s, n) => s + n, 0)).toBe(0);
  });

  it("tamanho com peso 0 fica 0", () => {
    const r = distribuirGrade(10, { PP: 0, M: 1 });
    expect(r["PP"]).toBe(0);
    expect(r["M"]).toBe(10);
  });
});
```

- [ ] **Step 1.2: Rodar os testes para confirmar falha**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run test:unit -- plan-tecido 2>&1 | tail -30
```

Esperado: falha com "distribuirGrade is not a function" ou similar.

- [ ] **Step 1.3: Implementar `distribuirGrade` em `calc.ts`**

Adicionar ao final de `src/lib/plan-tecido/calc.ts`:

```typescript
/**
 * Distribui gradeTotal pelos tamanhos de proporcoes, proporcional ao peso.
 * Resto de arredondamento vai pro tamanho de maior peso.
 * proporcoes null/undefined/vazio → retorna {}.
 */
export function distribuirGrade(
  gradeTotal: number,
  proporcoes: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!proporcoes) return {};
  const entradas = Object.entries(proporcoes);
  if (entradas.length === 0) return {};
  const soma = entradas.reduce((s, [, p]) => s + (Number(p) || 0), 0);
  if (soma <= 0 || gradeTotal <= 0) {
    return Object.fromEntries(entradas.map(([tam]) => [tam, 0]));
  }
  // distribuição base (floor)
  const resultado: Record<string, number> = {};
  let distribuido = 0;
  for (const [tam, peso] of entradas) {
    const val = Math.floor((gradeTotal * (Number(peso) || 0)) / soma);
    resultado[tam] = val;
    distribuido += val;
  }
  // resto vai pro maior peso
  const resto = gradeTotal - distribuido;
  if (resto > 0) {
    const [tamMaior] = entradas.reduce(([bestTam, bestP], [tam, p]) =>
      (Number(p) || 0) > (Number(bestP) || 0) ? [tam, p] : [bestTam, bestP],
    );
    resultado[tamMaior] = (resultado[tamMaior] ?? 0) + resto;
  }
  return resultado;
}
```

- [ ] **Step 1.4: Rodar os testes para confirmar sucesso**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run test:unit -- plan-tecido 2>&1 | tail -20
```

Esperado: todos os testes passando (incluindo os antigos).

- [ ] **Step 1.5: Verificar tsc**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | head -30
```

Esperado: 0 erros.

- [ ] **Step 1.6: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && git add src/lib/plan-tecido/calc.ts tests/unit/plan-tecido-calc.test.ts && git commit -m "$(cat <<'EOF'
feat(plan-tecido): helper puro distribuirGrade + testes unit

Distribui gradeTotal pelos tamanhos de proporcoes proporcional ao peso;
resto de arredondamento vai pro maior peso; null/vazio retorna {}.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Botão "Aplicar grade ao modelo" no ModelCard

**Files:**
- Modify: `src/components/plan-tecido/ModelCard.tsx`

**Interfaces:**
- Consumes: `distribuirGrade` de `@/lib/plan-tecido/calc`
- Consumes: `mensagemErro` de `@/lib/erro-mensagem`
- Consumes: `toast` de `sonner`
- Consumes: `useQueryClient` de `@tanstack/react-query`
- Consumes: `supabase.rpc("aplicar_plan_tecido_grade" as any, { _slot_id, _variantes })`
  - `_slot_id`: `string` (uuid do slot)
  - `_variantes`: array de `{ ordem: number; grade_total: number; grades: Record<string,number> }`
  - Retorna: `{ modelo_id: string; changed: boolean }`
- Consumes: `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogHeader`, `AlertDialogTitle` de `@/components/ui/alert-dialog`

**Lógica do botão:**
- Habilitado quando: `slot.id` existe E `slot.modelo_id` existe
- `!slot.id` → `title="Salve o plano primeiro"`
- `!slot.modelo_id` → `title="Este item não está ligado a um card de modelo"`
- Ao clicar: abre AlertDialog de confirmação
- No confirmar: monta `_variantes` das variantes do Tecido 1 do slot:
  - Para cada `variante` do Tecido 1: `{ ordem: variante.ordem, grade_total: variante.grade_total, grades: distribuirGrade(variante.grade_total, slot.proporcoes) }`
- Chama `supabase.rpc("aplicar_plan_tecido_grade" as any, { _slot_id: slot.id, _variantes })`
- Em erro: `toast.error(mensagemErro(e, "Não foi possível aplicar a grade ao modelo."))`
- Em sucesso (`changed=true`): `toast.success("Grade aplicada. #Erro aceso — verifique o modelo.")` 
- Em sucesso (`changed=false`): `toast.success("Grade já estava atualizada.")`
- Invalida queryKeys: `["modelos-desenvolvimento"]`, `["cad-grades"]`, `["dash-estoque"]`
- Estado `loading` local para desabilitar o botão durante a chamada

- [ ] **Step 2.1: Modificar `ModelCard.tsx`**

Substituir o conteúdo completo do arquivo com:

```typescript
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { PtSlot, PtMaterial } from "@/lib/plan-tecido/types";
import { ChevronRight, ImageIcon } from "lucide-react";
import { necessidadePorTecido, distribuirGrade } from "@/lib/plan-tecido/calc";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MaterialBlock } from "./MaterialBlock";
import { GradeSection } from "./GradeSection";
import { CustoSection } from "./CustoSection";

function novoMaterial(existentes: PtMaterial[], tipo: "tecido" | "forro"): PtMaterial {
  const numero = existentes.filter((m) => m.tipo === tipo).length + 1;
  return { artigo_id: null, tipo, numero, consumo: 0, loss_percent: 0, ordem: existentes.length, variantes: [] };
}

export function ModelCard({
  slot,
  onChange,
  selected,
  onToggleSelect,
}: {
  slot: PtSlot;
  onChange: (s: PtSlot) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmGrade, setConfirmGrade] = useState(false);
  const [aplicandoGrade, setAplicandoGrade] = useState(false);

  const { data: categorias = [] } = useQuery({
    queryKey: ["plan-tecido-categorias"],
    queryFn: async () =>
      ((await supabase.from("categorias_produto").select("id, nome").order("nome")).data ?? []) as {
        id: string;
        nome: string;
      }[],
  });

  const total = necessidadePorTecido({
    colecao_id: "",
    subcolecoes: [
      {
        subcolecao_id: null,
        ordem: 0,
        linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [slot] }],
      },
    ],
  }).reduce((s, t) => s + t.totalMetros, 0);

  const temGrade = slot.materiais.some((m) => m.variantes.some((v) => v.grade_total > 0));
  const usarEstoque = slot.usar_estoque ?? false;
  const borderClass = open ? "border-primary" : usarEstoque ? "border-amber-500" : "";

  // Estado do botão "Aplicar grade ao modelo"
  const gradeDisabled = !slot.id || !slot.modelo_id || aplicandoGrade;
  const gradeTitle = !slot.id
    ? "Salve o plano primeiro"
    : !slot.modelo_id
      ? "Este item não está ligado a um card de modelo"
      : undefined;

  async function aplicarGrade() {
    if (!slot.id) return;
    const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
    const _variantes = (tec1?.variantes ?? []).map((v) => ({
      ordem: v.ordem,
      grade_total: v.grade_total,
      grades: distribuirGrade(v.grade_total, slot.proporcoes),
    }));
    setAplicandoGrade(true);
    try {
      const { data, error } = await supabase.rpc("aplicar_plan_tecido_grade" as any, {
        _slot_id: slot.id,
        _variantes,
      });
      if (error) throw error;
      const result = data as { modelo_id: string; changed: boolean } | null;
      if (result?.changed) {
        toast.success("Grade aplicada. #Erro aceso — verifique o modelo.");
      } else {
        toast.success("Grade já estava atualizada.");
      }
      // Invalidações best-effort
      void qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      void qc.invalidateQueries({ queryKey: ["cad-grades"] });
      void qc.invalidateQueries({ queryKey: ["dash-estoque"] });
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível aplicar a grade ao modelo."));
    } finally {
      setAplicandoGrade(false);
      setConfirmGrade(false);
    }
  }

  return (
    <>
      <div className={`rounded-lg border ${borderClass} relative`}>
        {/* Checkbox de seleção múltipla */}
        {onToggleSelect && (
          <div className="absolute left-1 top-1 z-10">
            <Checkbox
              checked={selected ?? false}
              onCheckedChange={onToggleSelect}
              className="h-4 w-4"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        <button
          className="flex w-full items-center gap-2 p-2 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
          <div className="flex h-7 w-7 items-center justify-center rounded bg-muted">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className={`min-w-0 ${onToggleSelect ? "ml-4" : ""}`}>
            <div className="truncate text-sm font-medium">{slot.ref ?? slot.nome ?? "Modelo"}</div>
            <div className="text-xs text-muted-foreground">
              {total ? `${total.toFixed(0)} m` : "—"} · {temGrade ? "✓ grade" : "⚠ falta"}
              {usarEstoque ? " · estoque" : ""}
            </div>
          </div>
        </button>
        {open && (
          <>
            <div className="border-t px-2 py-1 flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground shrink-0">Categoria</span>
              <select
                className="flex-1 rounded border bg-background px-2 py-1 text-xs"
                value={slot.categoria_id ?? ""}
                onChange={(e) => onChange({ ...slot, categoria_id: e.target.value || null })}
              >
                <option value="">—</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="border-t px-2 py-1 flex items-center gap-2">
              <label
                className="flex cursor-pointer items-center gap-2 text-xs select-none"
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  id={`usar-estoque-${slot.id ?? slot.modelo_id ?? "new"}`}
                  checked={usarEstoque}
                  onCheckedChange={(v) => onChange({ ...slot, usar_estoque: !!v })}
                  className="h-4 w-4"
                />
                <span>Usar estoque existente</span>
              </label>
            </div>
            <Accordion type="multiple" defaultValue={["mat"]} className="border-t px-2">
              <AccordionItem value="mat">
                <AccordionTrigger className="py-2 text-xs">1. Tecidos &amp; Forros</AccordionTrigger>
                <AccordionContent>
                  {slot.materiais.map((m, i) => (
                    <MaterialBlock
                      key={m.id ?? i}
                      material={m}
                      onChange={(nm) => {
                        const materiais = slot.materiais.slice();
                        materiais[i] = nm;
                        onChange({ ...slot, materiais });
                      }}
                      onRemove={() =>
                        onChange({ ...slot, materiais: slot.materiais.filter((_, j) => j !== i) })
                      }
                    />
                  ))}
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onChange({
                          ...slot,
                          materiais: [...slot.materiais, novoMaterial(slot.materiais, "tecido")],
                        })
                      }
                    >
                      + tecido
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onChange({
                          ...slot,
                          materiais: [...slot.materiais, novoMaterial(slot.materiais, "forro")],
                        })
                      }
                    >
                      + forro
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="grade">
                <AccordionTrigger className="py-2 text-xs">2. Grade</AccordionTrigger>
                <AccordionContent>
                  <GradeSection slot={slot} onChange={onChange} />
                  <div className="mt-2 border-t pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      disabled={gradeDisabled}
                      title={gradeTitle}
                      onClick={() => setConfirmGrade(true)}
                    >
                      {aplicandoGrade ? "Aplicando…" : "Aplicar grade ao modelo"}
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="custo">
                <AccordionTrigger className="py-2 text-xs">3. Custo &amp; Preço</AccordionTrigger>
                <AccordionContent>
                  <CustoSection slot={slot} onChange={onChange} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </>
        )}
      </div>

      <AlertDialog open={confirmGrade} onOpenChange={setConfirmGrade}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar grade ao modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso grava a grade por variante no card do modelo. NÃO altera o consumo (o CAD é dono
              do consumo). Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={aplicandoGrade}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={aplicandoGrade} onClick={aplicarGrade}>
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 2.2: Verificar tsc**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | head -30
```

Esperado: 0 erros.

- [ ] **Step 2.3: Build**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run build 2>&1 | tail -20
```

Esperado: build bem-sucedido.

- [ ] **Step 2.4: Rodar testes**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run test:unit -- plan-tecido 2>&1 | tail -20
```

Esperado: todos passando.

- [ ] **Step 2.5: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && git add src/components/plan-tecido/ModelCard.tsx && git commit -m "$(cat <<'EOF'
feat(plan-tecido): botão "Aplicar grade ao modelo" (Item 10, RPC guardada)

AlertDialog de confirmação → chama aplicar_plan_tecido_grade com
distribuirGrade por variante do Tecido 1; disabled quando slot não salvo
ou não vinculado; invalida queries de modelo/grade/estoque.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Seleção múltipla de cards + aplicar tecido em massa

**Files:**
- Modify: `src/components/plan-tecido/PlanTecidoSheet.tsx`

**Interfaces:**
- Consumes: props `selected` e `onToggleSelect` do `ModelCard` (adicionadas na Task 2)
- Produz: estado `selecao: Set<string>` (chave = `slot.id ?? "${si}-${li}-${sli}"`)
- Produz: mini-form para escolher artigo + variantes + consumo
- Mini-form usa dados de `artigos` e `variantes_tecido` (queries já existem em `MaterialBlock` por artigo; no Sheet fazemos queries simples diretas)
- Ao confirmar: para cada slot selecionado, adiciona/substitui o Tecido 1 no estado `arvore` com o material configurado, sem tocar o banco
- Depois: limpa a seleção (`setSelecao(new Set())`)

**Design do mini-form (ApliTecidoForm):**
- Estado interno: `artigoId: string | null`, `consumo: number`, `varianteIds: string[]` (ids das variantes marcadas)
- Query de artigos: `supabase.from("artigos").select("id, nome, unidade_medida, rendimento, preco_por_metro").order("nome")`
- Query de variantes (condicionada em artigoId): `supabase.from("variantes_tecido").select("id, nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)").eq("artigo_id", artigoId)`
- Ao confirmar: monta um `PtMaterial` do tipo `tecido` com `numero=1` (mesma estrutura do `novoMaterial`) e as variantes selecionadas como `PtVariante[]` com `grade_total=0, multiplicador=1, grades={}, ordem=i+1`
- Para cada slot na seleção: remove o Tecido 1 existente e insere o novo no início (ou substitui pelo índice); usa `structuredClone(arvore)` para imutabilidade

- [ ] **Step 3.1: Adicionar estado de seleção e mini-form embutido ao `PlanTecidoSheet.tsx`**

Substituir o conteúdo completo com a versão atualizada. As mudanças chave vs o arquivo atual são:

1. Adicionar imports: `useRef` (não é preciso), `X`, `Check` de lucide-react; queries inline para artigos/variantes dentro do mini-form
2. Estado: `const [selecao, setSelecao] = useState<Set<string>>(new Set())`; `const [mostrarFormTecido, setMostrarFormTecido] = useState(false)`
3. Helper para chave estável do slot: `function chaveSlot(slot: PtSlot, si: number, li: number, sli: number): string { return slot.id ?? `${si}-${li}-${sli}`; }`
4. Passar `selected` e `onToggleSelect` para cada `ModelCard`
5. Barra de seleção múltipla quando `selecao.size >= 1`
6. Mini-form no AlertDialog

O arquivo completo fica assim:

```typescript
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { labelVarianteRow } from "@/lib/variante";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/shared/NumberInput";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { ChevronRight, ArrowLeft } from "lucide-react";
import {
  semearComModelos, mergeArvore, type SeedInput, type ModeloReal, type ModeloRealMaterial,
} from "@/lib/plan-tecido/engine";
import type { PtArvore, PtMaterial, PtVariante } from "@/lib/plan-tecido/types";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";
import { ModelCard } from "@/components/plan-tecido/ModelCard";
import { ResumoPanel } from "@/components/plan-tecido/ResumoPanel";

type Nome = { id: string; nome: string };

// Chave estável por slot (prefere o id do banco, senão usa índices)
function chaveSlot(slotId: string | undefined, si: number, li: number, sli: number): string {
  return slotId ?? `${si}-${li}-${sli}`;
}

type ArtigoSimples = {
  id: string;
  nome: string;
  unidade_medida: string | null;
  rendimento: number | null;
  preco_por_metro: number | null;
};
type VarSimples = { id: string; nome_variante: string | null; cor: { nome: string | null } | null; apelido: { nome: string | null } | null };

function FormAplicarTecido({
  nSelecionados,
  onConfirmar,
  onCancelar,
}: {
  nSelecionados: number;
  onConfirmar: (material: PtMaterial) => void;
  onCancelar: () => void;
}) {
  const [artigoId, setArtigoId] = useState<string>("");
  const [consumo, setConsumo] = useState<number>(0);
  const [varianteIds, setVarianteIds] = useState<string[]>([]);

  const { data: artigos = [] } = useQuery({
    queryKey: ["form-tecido-artigos"],
    queryFn: async () =>
      ((await supabase.from("artigos").select("id, nome, unidade_medida, rendimento, preco_por_metro").order("nome")).data ?? []) as ArtigoSimples[],
  });

  const { data: variantes = [] } = useQuery({
    queryKey: ["form-tecido-variantes", artigoId],
    enabled: !!artigoId,
    queryFn: async () =>
      ((await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .eq("artigo_id", artigoId)
        .order("id")).data ?? []) as unknown as VarSimples[],
  });

  const artigo = artigos.find((a) => a.id === artigoId) ?? null;

  const toggle = (vid: string) =>
    setVarianteIds((prev) =>
      prev.includes(vid) ? prev.filter((x) => x !== vid) : [...prev, vid],
    );

  const confirmar = () => {
    if (!artigoId) return;
    const variatesPt: PtVariante[] = varianteIds.map((vid, i) => ({
      variante_tecido_id: vid,
      ordem: i + 1,
      multiplicador: 1,
      grades: {},
      grade_total: 0,
    }));
    const material: PtMaterial = {
      artigo_id: artigoId,
      artigo_nome: artigo?.nome ?? null,
      unidade_medida: artigo?.unidade_medida ?? null,
      rendimento: artigo?.rendimento ?? null,
      preco_por_metro: artigo?.preco_por_metro ?? null,
      tipo: "tecido",
      numero: 1,
      consumo,
      loss_percent: 0,
      ordem: 0,
      variantes: variatesPt,
    };
    onConfirmar(material);
  };

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Aplicar tecido a {nSelecionados} selecionado(s)</AlertDialogTitle>
        <AlertDialogDescription>
          Define o Tecido 1 nos slots selecionados (estado local — salve depois para gravar).
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="space-y-3 py-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Artigo</label>
          <select
            className="rounded border bg-background px-2 py-1.5 text-sm"
            value={artigoId}
            onChange={(e) => { setArtigoId(e.target.value); setVarianteIds([]); }}
          >
            <option value="">Escolher artigo…</option>
            {artigos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}{a.unidade_medida === "kg" ? " [kg]" : ""}
              </option>
            ))}
          </select>
        </div>
        {artigoId && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium">Consumo</label>
              <NumberInput
                className="h-8 w-20 text-right"
                value={consumo}
                onChange={(e) => setConsumo(Number(e.target.value) || 0)}
              />
              <span className="text-xs text-muted-foreground">m</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">Variantes</label>
              <div className="max-h-40 overflow-y-auto rounded border p-1 space-y-1">
                {variantes.length === 0 && (
                  <div className="text-xs text-muted-foreground p-1">Nenhuma variante cadastrada.</div>
                )}
                {variantes.map((v) => (
                  <label key={v.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs">
                    <Checkbox
                      checked={varianteIds.includes(v.id)}
                      onCheckedChange={() => toggle(v.id)}
                      className="h-4 w-4"
                    />
                    <span>{labelVarianteRow(v as any)}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onCancelar}>Cancelar</AlertDialogCancel>
        <AlertDialogAction disabled={!artigoId} onClick={confirmar}>
          Aplicar a {nSelecionados}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

export function PlanTecidoSheet({ colecaoId, onClose }: { colecaoId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [arvore, setArvore] = useState<PtArvore | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmSair, setConfirmSair] = useState(false);
  const [viewMode, setViewMode] = useState<"linha" | "tecido">("linha");
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [mostrarFormTecido, setMostrarFormTecido] = useState(false);

  const { data: colecao } = useQuery({
    queryKey: ["plan-tecido-colecao", colecaoId],
    queryFn: async () =>
      (await supabase.from("colecoes").select("id, nome, tipo").eq("id", colecaoId).maybeSingle()).data as any,
  });

  const { data: seed } = useQuery({
    queryKey: ["plan-tecido-seed", colecaoId],
    enabled: !!colecao,
    queryFn: async (): Promise<SeedInput> => {
      const tipo = (colecao.tipo === "poder_venda" ? "poder_venda" : "orcamento") as SeedInput["tipo"];
      if (tipo === "poder_venda") {
        const rows = ((await supabase.from("colecao_pv_itens" as any).select("subcolecao_id, linha_id, qtd_semanas").eq("colecao_id", colecaoId)).data ?? []) as any[];
        const buckets = rows.map((r) => ({
          subcolecao_id: r.subcolecao_id,
          linha_id: r.linha_id,
          categoria_id: null,
          qtd: Object.values((r.qtd_semanas ?? {}) as Record<string, number>).reduce((s, n) => s + (Number(n) || 0), 0),
        }));
        return { colecao_id: colecaoId, tipo, buckets };
      }
      const rows = ((await supabase.from("colecao_semana_categorias" as any).select("subcolecao_id, categoria_id, qtd").eq("colecao_id", colecaoId)).data ?? []) as any[];
      const buckets = rows.map((r) => ({ subcolecao_id: r.subcolecao_id, linha_id: null, categoria_id: r.categoria_id, qtd: Number(r.qtd) || 0 }));
      return { colecao_id: colecaoId, tipo, buckets };
    },
  });

  const { data: salvo } = useQuery({
    queryKey: ["plan-tecido-arvore", colecaoId],
    queryFn: async () =>
      ((await supabase.rpc("plan_tecido_arvore" as any, { _colecao_id: colecaoId })).data ?? null) as PtArvore | null,
  });

  const { data: subNomes = [] } = useQuery({
    queryKey: ["plan-tecido-subnomes", colecaoId],
    queryFn: async () =>
      ((await supabase.from("colecao_subcolecoes" as any).select("id, nome").eq("colecao_id", colecaoId)).data ?? []) as unknown as Nome[],
  });
  const { data: linhaNomes = [] } = useQuery({
    queryKey: ["plan-tecido-linha-nomes"],
    queryFn: async () => ((await supabase.from("linhas").select("id, nome")).data ?? []) as Nome[],
  });
  const { data: catNomes = [] } = useQuery({
    queryKey: ["plan-tecido-cat-nomes"],
    queryFn: async () =>
      ((await supabase.from("categorias_produto").select("id, nome")).data ?? []) as Nome[],
  });
  const nameOf = (arr: Nome[], id: string | null | undefined) =>
    id ? arr.find((x) => x.id === id)?.nome ?? null : null;

  const { data: modelosDb } = useQuery({
    queryKey: ["plan-tecido-modelos", colecaoId],
    queryFn: async () =>
      ((await supabase
        .from("modelos")
        .select(
          "id, ref, nome, subcolecao, linha_id, categoria_principal_id, proporcoes, fotos_modelo, modelo_tecidos(id, tipo, numero, artigo_id, consumo, loss_percent, artigo:artigo_id(nome, unidade_medida, rendimento, preco_por_metro), modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, variante:variante_tecido_id(cor:cor_id(nome)))), modelo_grades(variante_numero, grades, grade_total)",
        )
        .eq("colecao_id", colecaoId)).data ?? []) as any[],
  });

  const modelosReais = useMemo<ModeloReal[]>(() => {
    if (!modelosDb) return [];
    const subIdPorNome = new Map<string, string>((subNomes as Nome[]).map((s) => [s.nome, s.id]));
    return modelosDb.map((m: any): ModeloReal => {
      const grade: ModeloReal["grade"] = {};
      for (const g of m.modelo_grades ?? []) {
        grade[Number(g.variante_numero)] = { grades: (g.grades ?? {}) as Record<string, number>, grade_total: Number(g.grade_total) || 0 };
      }
      const materiais: ModeloRealMaterial[] = (m.modelo_tecidos ?? [])
        .filter((t: any) => t.tipo === "tecido" || t.tipo === "forro")
        .map((t: any): ModeloRealMaterial => ({
          tipo: t.tipo as "tecido" | "forro",
          numero: Number(t.numero) || 1,
          artigo_id: t.artigo_id ?? null,
          artigo_nome: (t.artigo?.nome ?? null) as string | null,
          artigo_unidade_medida: (t.artigo?.unidade_medida ?? null) as string | null,
          artigo_rendimento: t.artigo?.rendimento != null ? Number(t.artigo.rendimento) : null,
          preco_por_metro: t.artigo?.preco_por_metro != null ? Number(t.artigo.preco_por_metro) : null,
          consumo: Number(t.consumo) || 0,
          loss_percent: Number(t.loss_percent) || 0,
          variantes: (t.modelo_tecido_variantes ?? []).map((v: any) => ({
            variante_tecido_id: v.variante_tecido_id,
            ordem: Number(v.ordem) || 0,
            multiplicador: Number(v.multiplicador) || 1,
            cor_nome: (v.variante?.cor?.nome ?? null) as string | null,
          })),
        }));
      return {
        id: m.id,
        ref: m.ref ?? null,
        nome: m.nome ?? null,
        subcolecao: m.subcolecao ?? null,
        subcolecao_id: m.subcolecao ? (subIdPorNome.get(m.subcolecao) ?? null) : null,
        linha_id: m.linha_id ?? null,
        categoria_id: m.categoria_principal_id ?? null,
        proporcoes: (m.proporcoes ?? null) as Record<string, number> | null,
        materiais,
        grade,
      };
    });
  }, [modelosDb, subNomes]);

  useEffect(() => {
    if (seed && salvo !== undefined && modelosDb !== undefined && arvore === null) {
      setArvore(mergeArvore(semearComModelos({ ...seed, modelos: modelosReais }), salvo));
    }
  }, [seed, salvo, modelosDb, modelosReais, arvore]);

  const salvarMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("salvar_plan_tecido" as any, { _colecao_id: colecaoId, _arvore: arvore });
      if (error) throw error;
    },
    onSuccess: () => {
      setDirty(false);
      toast.success("Planejamento de tecido salvo.");
      qc.invalidateQueries({ queryKey: ["plan-tecido-arvore", colecaoId] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar.")),
  });

  const patch = (next: PtArvore) => { setArvore(next); setDirty(true); };
  const fechar = () => { if (dirty) setConfirmSair(true); else onClose(); };

  // Aplica um material (Tecido 1) em todos os slots selecionados (estado local)
  function aplicarTecidoEmMassa(material: PtMaterial) {
    if (!arvore) return;
    const next = structuredClone(arvore) as PtArvore;
    for (let si = 0; si < next.subcolecoes.length; si++) {
      for (let li = 0; li < next.subcolecoes[si].linhas.length; li++) {
        for (let sli = 0; sli < next.subcolecoes[si].linhas[li].slots.length; sli++) {
          const slot = next.subcolecoes[si].linhas[li].slots[sli];
          const chave = chaveSlot(slot.id, si, li, sli);
          if (!selecao.has(chave)) continue;
          // Remove Tecido 1 existente e prepend o novo
          const semTec1 = slot.materiais.filter((m) => !(m.tipo === "tecido" && m.numero === 1));
          next.subcolecoes[si].linhas[li].slots[sli] = {
            ...slot,
            materiais: [material, ...semTec1],
          };
        }
      }
    }
    patch(next);
    setSelecao(new Set());
    setMostrarFormTecido(false);
    toast.success(`Tecido aplicado a ${selecao.size} slot(s).`);
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) fechar(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0 max-sm:[&>button]:hidden">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background p-3">
          <Breadcrumb items={[{ label: "Estilo & Engenharia" }, { label: "Plan. Tecido" }, { label: colecao?.nome ?? "…" }]} />
          <UnsavedIndicator show={dirty} />
          <div className="ml-auto hidden items-center rounded-md border p-0.5 md:flex">
            <button
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${viewMode === "linha" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setViewMode("linha")}
            >
              Por linha
            </button>
            <button
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${viewMode === "tecido" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setViewMode("tecido")}
            >
              Por tecido
            </button>
          </div>
          <Button className="max-sm:hidden" disabled={!dirty || salvarMut.isPending} onClick={() => salvarMut.mutate()}>
            {dirty ? "Salvar" : "Salvo"}
          </Button>
        </div>

        {/* Barra de seleção múltipla */}
        {selecao.size > 0 && (
          <div className="flex items-center gap-2 border-b bg-amber-50 px-3 py-2 text-sm">
            <span className="font-medium">{selecao.size} selecionado(s)</span>
            <Button size="sm" variant="outline" className="ml-auto text-xs" onClick={() => setMostrarFormTecido(true)}>
              Aplicar tecido a {selecao.size} selecionado(s)
            </Button>
            <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setSelecao(new Set())}>
              Limpar
            </Button>
          </div>
        )}

        {!arvore ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <div className="flex flex-1 flex-col overflow-y-auto max-sm:pb-24">
            <div className="flex flex-1 gap-3 p-3">
              <div className="min-w-0 flex-1 space-y-2">
                {viewMode === "linha" ? (
                  arvore.subcolecoes.map((sub, si) => (
                    <Collapsible key={sub.id ?? si} defaultOpen>
                      <CollapsibleTrigger className="flex min-h-[44px] w-full items-center gap-2 rounded-md border px-3 text-sm font-medium [&[data-state=open]>svg]:rotate-90">
                        <ChevronRight className="h-4 w-4 transition-transform" />
                        {nameOf(subNomes, sub.subcolecao_id) ?? "Sem subcoleção"}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        {sub.linhas.map((ln, li) => (
                          <div key={ln.id ?? li} className="mb-2">
                            <div className="mb-1 px-1 text-xs text-muted-foreground">
                              {ln.linha_id
                                ? (nameOf(linhaNomes, ln.linha_id) ?? "Linha")
                                : ln.categoria_id
                                  ? (nameOf(catNomes, ln.categoria_id) ?? "Categoria")
                                  : "Sem classificação"}
                            </div>
                            <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-2">
                              {ln.slots.map((slot, sli) => {
                                const chave = chaveSlot(slot.id, si, li, sli);
                                return (
                                  <ModelCard
                                    key={slot.id ?? sli}
                                    slot={slot}
                                    onChange={(ns) => {
                                      const next = structuredClone(arvore) as PtArvore;
                                      next.subcolecoes[si].linhas[li].slots[sli] = ns;
                                      patch(next);
                                    }}
                                    selected={selecao.has(chave)}
                                    onToggleSelect={() => {
                                      setSelecao((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(chave)) next.delete(chave);
                                        else next.add(chave);
                                        return next;
                                      });
                                    }}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  ))
                ) : (
                  (() => {
                    const nec = necessidadePorTecido(arvore);
                    if (nec.length === 0)
                      return (
                        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                          Nenhum tecido configurado.
                        </div>
                      );
                    const modelosPorArtigo = new Map<string, Set<string>>();
                    for (const sub of arvore.subcolecoes)
                      for (const ln of sub.linhas)
                        for (const slot of ln.slots) {
                          for (const mat of slot.materiais) {
                            if (!mat.artigo_id) continue;
                            if (!modelosPorArtigo.has(mat.artigo_id))
                              modelosPorArtigo.set(mat.artigo_id, new Set());
                            modelosPorArtigo
                              .get(mat.artigo_id)!
                              .add(slot.modelo_id ?? `${sub.subcolecao_id}-${ln.linha_id}-${ln.slots.indexOf(slot)}`);
                          }
                        }
                    return nec.map((t) => (
                      <div key={t.artigo_id} className="rounded-lg border">
                        <div className="flex items-center justify-between border-b px-3 py-2">
                          <span className="text-sm font-medium">
                            {t.artigo_nome}
                            {t.unidade_medida === "kg" ? (
                              <span className="ml-1 text-[10px] text-muted-foreground">kg</span>
                            ) : null}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {modelosPorArtigo.get(t.artigo_id)?.size ?? 0} modelo(s)
                          </span>
                        </div>
                        <div className="divide-y">
                          {t.variantes.map((v) => (
                            <div key={v.variante_tecido_id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                              <span className="text-muted-foreground">{v.label || "—"}</span>
                              <b>{v.metros.toFixed(0)} m</b>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between border-t px-3 py-1.5 text-xs font-semibold">
                          <span>Total</span>
                          <span>{t.totalMetros.toFixed(0)} m</span>
                        </div>
                      </div>
                    ));
                  })()
                )}
              </div>
              <div className="hidden w-56 shrink-0 md:block">
                <ResumoPanel arvore={arvore} />
              </div>
            </div>

            <MobileActionBar>
              <Button variant="ghost" size="sm" onClick={fechar}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Voltar
              </Button>
              <Button
                className="ml-auto"
                disabled={!dirty || salvarMut.isPending}
                onClick={() => salvarMut.mutate()}
              >
                {dirty ? "Salvar" : "Salvo"}
              </Button>
            </MobileActionBar>
          </div>
        )}

        <AlertDialog open={confirmSair} onOpenChange={setConfirmSair}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
              <AlertDialogDescription>
                Há alterações não salvas no planejamento de tecido.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuar editando</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmSair(false); onClose(); }}>
                Descartar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Mini-form: aplicar tecido em massa */}
        <AlertDialog open={mostrarFormTecido} onOpenChange={setMostrarFormTecido}>
          <FormAplicarTecido
            nSelecionados={selecao.size}
            onConfirmar={aplicarTecidoEmMassa}
            onCancelar={() => setMostrarFormTecido(false)}
          />
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3.2: Verificar tsc**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | head -40
```

Esperado: 0 erros.

- [ ] **Step 3.3: Build**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run build 2>&1 | tail -20
```

Esperado: build bem-sucedido.

- [ ] **Step 3.4: Testes unit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npm run test:unit -- plan-tecido 2>&1 | tail -20
```

Esperado: todos passando.

- [ ] **Step 3.5: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && git add src/components/plan-tecido/PlanTecidoSheet.tsx && git commit -m "$(cat <<'EOF'
feat(plan-tecido): seleção múltipla de cards + aplicar tecido em massa (Item 11)

Checkbox por card (Set<string> de chaves estáveis), barra de ação quando
≥1 selecionado, mini-form (artigo+variantes+consumo) aplica Tecido 1 nos
slots em estado local; limpa seleção após confirmar.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Gerar report de finalização

**Files:**
- Create: `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/task-R4-report.md`

- [ ] **Step 4.1: Criar diretório e report**

```bash
mkdir -p "/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd"
```

Depois criar o arquivo `.superpowers/sdd/task-R4-report.md` com as evidências reais (commits, saída dos testes, tsc).

- [ ] **Step 4.2: git push**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && git push origin feature/plan-tecido-a1
```

---

## Self-Review Spec Coverage

| Requisito | Task |
|---|---|
| `distribuirGrade` puro em `calc.ts` | Task 1 |
| Teste unit `distribuirGrade(100,{PP:1,M:2,G:1})` soma 100 | Task 1 |
| Botão "Aplicar grade ao modelo" no card aberto, perto da aba Grade | Task 2 |
| Habilitado só quando `slot.id` E `slot.modelo_id` existem | Task 2 |
| Title de desabilitado correto para cada caso | Task 2 |
| AlertDialog de confirmação antes de chamar RPC | Task 2 |
| Monta `_variantes` do Tecido 1 com `distribuirGrade` | Task 2 |
| `supabase.rpc("aplicar_plan_tecido_grade" as any, ...)` | Task 2 |
| `toast.error(mensagemErro(...))` em erro | Task 2 |
| `toast.success` com menção a `#Erro` quando `changed` | Task 2 |
| Invalida `["modelos-desenvolvimento"]`, `["cad-grades"]`, `["dash-estoque"]` | Task 2 |
| Estado `Set` de seleção em `PlanTecidoSheet` | Task 3 |
| Checkbox por card (props `selected`/`onToggleSelect`) | Task 3 |
| Barra/ação "Aplicar tecido a N selecionados" | Task 3 |
| Mini-form: artigo + variantes + consumo | Task 3 |
| Aplica estado local (NÃO escreve em produção) | Task 3 |
| Limpa seleção após aplicar | Task 3 |
| `tsc --noEmit` 0 erros | Tasks 1-3 |
| `npm run build` passa | Tasks 2-3 |
| `npm run test:unit -- plan-tecido` verde | Tasks 1-3 |
| Report em `.superpowers/sdd/task-R4-report.md` | Task 4 |
| `git push origin feature/plan-tecido-a1` | Task 4 |

Nenhuma lacuna encontrada.
