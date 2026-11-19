# Navegação por teclado em grades — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Digitar em grades variante×tamanho andando pelo teclado como planilha (Enter desce / Tab ao lado / Shift+Tab inverso, pulando células travadas), via um hook reutilizável, com piloto no CQ e sem regredir a navegação que já existe no Plan.Tecido.

**Architecture:** Lógica pura `proximaCelulaDisponivel` (loop sobre `proximaCelulaTeclado`, que fica intocada, com um predicado de "célula disponível") → hook `useGradeTeclado` que endereça células por `data-grade-cel="L:C"` e foca o alvo no DOM → prop opt-in no componente compartilhado `MatrizGradeResponsiva` (cobre CQ Pré e Pós de uma vez) → `DistribuicaoTabelas` migra para o mesmo hook (anti-regressão).

**Tech Stack:** React + TypeScript + Vitest/happy-dom. Reusa `proximaCelulaTeclado`, `MatrizGradeResponsiva`, `NumberInput`.

**Spec:** `docs/superpowers/specs/2026-11-19-navegacao-teclado-grades-design.md`

## Global Constraints

- **Front puro — ZERO migration, ZERO banco.** Nada em `supabase/`.
- Teclas: **Enter** = ±1 linha (Shift inverte); **Tab** = ±1 coluna com estouro de linha (Shift inverte). Ignora Ctrl/Meta/Alt.
- **Pular travada:** salta células cujo input não existe ou está `disabled`, parando na próxima habilitada na mesma direção; na **borda** devolve null (Enter faz só `preventDefault`; Tab deixa o fluxo nativo).
- **Guard anti-loop:** no máximo `nLinhas*nColunas` iterações em `proximaCelulaDisponivel`.
- Foco no alvo via `requestAnimationFrame` (convive com o rAF de cursor do `NumberInput.onFocus`).
- Endereço da célula: `data-grade-cel="<linha>:<coluna>"` (busca com `CSS.escape` não é necessária — são só dígitos e `:`, mas usar seletor de atributo exato).
- `proximaCelulaTeclado` (`src/lib/plan-tecido/calc.ts`) **não é alterada** — seus testes seguem 100%.
- `DistribuicaoTabelas` mantém `data-colab-path` (co-edição) além do novo `data-grade-cel` (navegação) — usos diferentes.
- Gates: `npm run build` + `npx tsc --noEmit 2>&1 | grep TS2304`; testes com fake timers onde houver rAF/timer.

## Review Focus

- **Todas as células de uma linha/coluna travadas:** `proximaCelulaDisponivel` deve devolver null sem travar o navegador (guard). Testado no Task 1.
- **Enter/Tab na borda da grade:** não deve estourar índice nem focar fora da grade; Tab segue nativo. Testado nos Tasks 1 e 2.
- **Layout mobile empilhado do MatrizGradeResponsiva:** a posição (linha,coluna) tem de ser a mesma dos 2 layouts (ordem variantes×tamanhos). Testado no Task 3 + QA mobile.
- **Input com `onKeyDown` próprio (ex.: Enter=blur em campos de preço):** o hook só liga nas células de grade; não pode vazar para inputs avulsos. Garantido por escopo (Task 4/5) — teste-guarda no Task 3 (a prop é opt-in).
- **`DistribuicaoTabelas` regredir:** destinos de Enter/Tab/Shift idênticos após a migração. Testado no Task 5.

---

### Task 1: Lib pura `proximaCelulaDisponivel`

**Files:**
- Create: `src/lib/grade-teclado.ts`
- Test: `tests/unit/grade-teclado.test.ts`

**Interfaces:**
- Consumes: `proximaCelulaTeclado` de `@/lib/plan-tecido/calc` (assinatura: `({tecla:"Enter"|"Tab", comShift:boolean, linha:number, coluna:number, nLinhas:number, nColunas:number}) => {linha,coluna}|null`).
- Produces: `proximaCelulaDisponivel(a: {tecla:"Enter"|"Tab"; comShift:boolean; linha:number; coluna:number; nLinhas:number; nColunas:number; disponivel:(linha:number,coluna:number)=>boolean}): {linha:number;coluna:number}|null`.

- [ ] **Step 1: Write the failing test** (`tests/unit/grade-teclado.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { proximaCelulaDisponivel } from "@/lib/grade-teclado";

// Grade 3x3. Predicado: todas disponíveis, salvo as marcadas em `bloq` (set de "L:C").
const pred = (bloq: Set<string>) => (l: number, c: number) => !bloq.has(`${l}:${c}`);

describe("proximaCelulaDisponivel", () => {
  it("Enter desce 1 linha, mesma coluna", () => {
    expect(proximaCelulaDisponivel({ tecla: "Enter", comShift: false, linha: 0, coluna: 1, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toEqual({ linha: 1, coluna: 1 });
  });
  it("Enter pula a linha de baixo travada e para na próxima livre", () => {
    expect(proximaCelulaDisponivel({ tecla: "Enter", comShift: false, linha: 0, coluna: 1, nLinhas: 3, nColunas: 3, disponivel: pred(new Set(["1:1"])) }))
      .toEqual({ linha: 2, coluna: 1 });
  });
  it("Tab anda à direita", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: false, linha: 0, coluna: 0, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toEqual({ linha: 0, coluna: 1 });
  });
  it("Tab estoura para a próxima linha no fim da linha", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: false, linha: 0, coluna: 2, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toEqual({ linha: 1, coluna: 0 });
  });
  it("Tab pula travada na horizontal", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: false, linha: 0, coluna: 0, nLinhas: 3, nColunas: 3, disponivel: pred(new Set(["0:1"])) }))
      .toEqual({ linha: 0, coluna: 2 });
  });
  it("Shift+Tab inverso", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: true, linha: 1, coluna: 0, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toEqual({ linha: 0, coluna: 2 });
  });
  it("Shift+Enter sobe", () => {
    expect(proximaCelulaDisponivel({ tecla: "Enter", comShift: true, linha: 2, coluna: 1, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toEqual({ linha: 1, coluna: 1 });
  });
  it("borda: Enter na última linha → null", () => {
    expect(proximaCelulaDisponivel({ tecla: "Enter", comShift: false, linha: 2, coluna: 1, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toBeNull();
  });
  it("todas as demais travadas → null sem loop infinito", () => {
    const bloq = new Set<string>();
    for (let l = 0; l < 3; l++) for (let c = 0; c < 3; c++) if (!(l === 0 && c === 0)) bloq.add(`${l}:${c}`);
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: false, linha: 0, coluna: 0, nLinhas: 3, nColunas: 3, disponivel: pred(bloq) }))
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/grade-teclado.test.ts`
Expected: FAIL — `Cannot find module '@/lib/grade-teclado'`.

- [ ] **Step 3: Write minimal implementation** (`src/lib/grade-teclado.ts`)

```ts
// Navegação por teclado em grades (Enter desce / Tab ao lado), pulando células travadas.
// Spec: docs/superpowers/specs/2026-11-19-navegacao-teclado-grades-design.md
import { proximaCelulaTeclado } from "@/lib/plan-tecido/calc";

export function proximaCelulaDisponivel(a: {
  tecla: "Enter" | "Tab"; comShift: boolean; linha: number; coluna: number;
  nLinhas: number; nColunas: number; disponivel: (linha: number, coluna: number) => boolean;
}): { linha: number; coluna: number } | null {
  const max = Math.max(1, a.nLinhas * a.nColunas);
  let pos: { linha: number; coluna: number } | null = { linha: a.linha, coluna: a.coluna };
  for (let i = 0; i < max; i++) {
    pos = proximaCelulaTeclado({ tecla: a.tecla, comShift: a.comShift, linha: pos.linha, coluna: pos.coluna, nLinhas: a.nLinhas, nColunas: a.nColunas });
    if (!pos) return null;
    if (a.disponivel(pos.linha, pos.coluna)) return pos;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/grade-teclado.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"
git add src/lib/grade-teclado.ts tests/unit/grade-teclado.test.ts
git commit --only src/lib/grade-teclado.ts tests/unit/grade-teclado.test.ts -m "feat(grade): proximaCelulaDisponivel — navegação de grade pulando células travadas"
```

---

### Task 2: Hook `useGradeTeclado`

**Files:**
- Modify: `src/lib/grade-teclado.ts` (acrescenta o hook)
- Test: `tests/unit/use-grade-teclado.test.ts`

**Interfaces:**
- Consumes: `proximaCelulaDisponivel` (Task 1).
- Produces: `useGradeTeclado(o: {nLinhas:number; nColunas:number}): { gridRef: RefObject<HTMLElement|null>; propsDaCelula: (linha:number, coluna:number) => { "data-grade-cel": string; onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void } }`.

- [ ] **Step 1: Write the failing test** (`tests/unit/use-grade-teclado.test.ts`)

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useGradeTeclado } from "@/lib/grade-teclado";

// Monta uma grade 2x2 de <input data-grade-cel>, liga o hook, e expõe o controlador via ref.
function montar(bloqueados: string[] = []) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let api: ReturnType<typeof useGradeTeclado> | null = null;
  function Grade() {
    const h = useGradeTeclado({ nLinhas: 2, nColunas: 2 });
    api = h;
    const ref = useRef<HTMLTableElement>(null);
    // liga o gridRef do hook à tabela
    (h.gridRef as any).current = null;
    return createElement("table", { ref: (el: HTMLTableElement) => { (h.gridRef as any).current = el; } },
      createElement("tbody", null,
        [0, 1].map((l) => createElement("tr", { key: l },
          [0, 1].map((c) => {
            const p = h.propsDaCelula(l, c);
            return createElement("td", { key: c },
              createElement("input", { ...p, disabled: bloqueados.includes(`${l}:${c}`), "data-test": `${l}:${c}` }));
          })))));
  }
  const root = createRoot(host);
  act(() => root.render(createElement(Grade)));
  return { host, api: api!, cleanup: () => { act(() => root.unmount()); host.remove(); } };
}

function tecla(host: HTMLElement, cel: string, key: string, shift = false) {
  const el = host.querySelector<HTMLInputElement>(`[data-grade-cel="${cel}"]`)!;
  el.focus();
  const ev = new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}

describe("useGradeTeclado", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("Enter foca a célula de baixo (mesma coluna)", () => {
    const { host, cleanup } = montar();
    tecla(host, "0:1", "Enter");
    act(() => vi.runAllTimers()); // resolve o requestAnimationFrame
    expect(document.activeElement?.getAttribute("data-grade-cel")).toBe("1:1");
    cleanup();
  });
  it("Tab foca a célula à direita", () => {
    const { host, cleanup } = montar();
    tecla(host, "0:0", "Tab");
    act(() => vi.runAllTimers());
    expect(document.activeElement?.getAttribute("data-grade-cel")).toBe("0:1");
    cleanup();
  });
  it("pula a célula desabilitada", () => {
    const { host, cleanup } = montar(["0:1"]); // a da direita está disabled
    tecla(host, "0:0", "Tab");
    act(() => vi.runAllTimers());
    // 0:1 disabled → estoura p/ 1:0
    expect(document.activeElement?.getAttribute("data-grade-cel")).toBe("1:0");
    cleanup();
  });
  it("Enter na borda faz preventDefault e não foca fora", () => {
    const { host, cleanup } = montar();
    const ev = tecla(host, "1:0", "Enter"); // última linha
    act(() => vi.runAllTimers());
    expect(ev.defaultPrevented).toBe(true);
    cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/use-grade-teclado.test.ts`
Expected: FAIL — `useGradeTeclado` não exportado.

- [ ] **Step 3: Write minimal implementation** (acrescentar a `src/lib/grade-teclado.ts`)

```ts
import { useCallback, useRef, type KeyboardEvent, type RefObject } from "react";

export function useGradeTeclado(o: { nLinhas: number; nColunas: number }): {
  gridRef: RefObject<HTMLElement | null>;
  propsDaCelula: (linha: number, coluna: number) => { "data-grade-cel": string; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };
} {
  const gridRef = useRef<HTMLElement | null>(null);
  const nRef = useRef(o); nRef.current = o;

  const foco = useCallback((linha: number, coluna: number): HTMLInputElement | null => {
    const raiz = gridRef.current ?? document;
    return raiz.querySelector<HTMLInputElement>(`[data-grade-cel="${linha}:${coluna}"]`);
  }, []);

  const propsDaCelula = useCallback((linha: number, coluna: number) => ({
    "data-grade-cel": `${linha}:${coluna}`,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if ((e.key !== "Enter" && e.key !== "Tab") || e.ctrlKey || e.metaKey || e.altKey) return;
      const { nLinhas, nColunas } = nRef.current;
      const alvo = proximaCelulaDisponivel({
        tecla: e.key, comShift: e.shiftKey, linha, coluna, nLinhas, nColunas,
        disponivel: (l, c) => { const el = foco(l, c); return !!el && !(el as HTMLInputElement).disabled; },
      });
      if (!alvo) { if (e.key === "Enter") e.preventDefault(); return; } // borda: Tab segue nativo
      e.preventDefault();
      const el = foco(alvo.linha, alvo.coluna);
      if (el) requestAnimationFrame(() => el.focus());
    },
  }), [foco]);

  return { gridRef, propsDaCelula };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/use-grade-teclado.test.ts`
Expected: PASS. (Se o padrão de render de hook do projeto diferir, seguir o de `tests/unit/use-regerar-ref.test.ts`/`card-drafts.test.ts`; happy-dom via `@vitest-environment happy-dom` no topo.)

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"
git add src/lib/grade-teclado.ts tests/unit/use-grade-teclado.test.ts
git commit --only src/lib/grade-teclado.ts tests/unit/use-grade-teclado.test.ts -m "feat(grade): hook useGradeTeclado (gridRef + propsDaCelula com data-grade-cel)"
```

---

### Task 3: Instrumentar `MatrizGradeResponsiva` (prop opt-in)

**Files:**
- Modify: `src/components/shared/MatrizGradeResponsiva.tsx`
- Test: `tests/unit/matriz-grade-nav.test.tsx`

**Interfaces:**
- Consumes: `useGradeTeclado` (Task 2) — o consumidor instancia o hook e passa `propsDaCelula`.
- Produces: o `MatrizGradeResponsiva` ganha uma prop opcional `posDaCelula?: (num:number, tam:string) => {linha:number; coluna:number}` e passa a posição ao `renderCell`. Nova assinatura do `renderCell`: `(num:number, tam:string, pos?: {linha:number;coluna:number}) => ReactNode`. Sem `posDaCelula`, `pos` é `undefined` e nada muda (retrocompatível).

- [ ] **Step 1: Write the failing test** (`tests/unit/matriz-grade-nav.test.tsx`)

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";

describe("MatrizGradeResponsiva — posDaCelula", () => {
  it("sem posDaCelula: renderCell recebe pos undefined (retrocompat)", () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    let posVista: unknown = "nao-chamado";
    act(() => createRoot(host).render(createElement(MatrizGradeResponsiva, {
      tamanhos: ["P"], variantes: [{ num: 1, label: "V1" }],
      total: () => 0,
      renderCell: (_n: number, _t: string, pos?: unknown) => { posVista = pos; return createElement("span"); },
    })));
    expect(posVista).toBeUndefined();
    host.remove();
  });
  it("com posDaCelula: a posição chega ao renderCell (desktop)", () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    const vistos: Array<{num:number;tam:string;pos:any}> = [];
    act(() => createRoot(host).render(createElement(MatrizGradeResponsiva, {
      tamanhos: ["P", "M"], variantes: [{ num: 7, label: "V7" }, { num: 9, label: "V9" }],
      total: () => 0,
      posDaCelula: (num: number, tam: string) => ({ linha: num === 7 ? 0 : 1, coluna: tam === "P" ? 0 : 1 }),
      renderCell: (num: number, tam: string, pos?: any) => { vistos.push({ num, tam, pos }); return createElement("span"); },
    })));
    // o desktop e o mobile ambos renderizam → a posição é a mesma nos dois; conferimos que existe e bate
    const v7P = vistos.find((v) => v.num === 7 && v.tam === "P");
    expect(v7P?.pos).toEqual({ linha: 0, coluna: 0 });
    const v9M = vistos.find((v) => v.num === 9 && v.tam === "M");
    expect(v9M?.pos).toEqual({ linha: 1, coluna: 1 });
    host.remove();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/matriz-grade-nav.test.tsx`
Expected: FAIL — `renderCell` ainda é chamado com 2 args; `posDaCelula` não existe.

- [ ] **Step 3: Write minimal implementation**

Em `src/components/shared/MatrizGradeResponsiva.tsx`: adicionar à assinatura de props `posDaCelula?: (num: number, tam: string) => { linha: number; coluna: number }` e trocar o tipo de `renderCell` para `(num: number, tam: string, pos?: { linha: number; coluna: number }) => ReactNode`. Nos DOIS layouts (desktop `<td>` e mobile empilhado), trocar `renderCell(num, t)` por `renderCell(num, t, posDaCelula?.(num, t))`. Nada mais muda.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/matriz-grade-nav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"
git add src/components/shared/MatrizGradeResponsiva.tsx tests/unit/matriz-grade-nav.test.tsx
git commit --only src/components/shared/MatrizGradeResponsiva.tsx tests/unit/matriz-grade-nav.test.tsx -m "feat(grade): MatrizGradeResponsiva passa posição da célula ao renderCell (opt-in)"
```

---

### Task 4: Ligar o hook no CQ (Pré + Pós)

**Files:**
- Modify: `src/components/producao/CqPosView.tsx` (CQ Pós)
- Modify: `src/routes/_authenticated/expedicao.cq.$modeloId.tsx` (CQ Pré)

**Interfaces:**
- Consumes: `useGradeTeclado` (Task 2); a prop `posDaCelula` + 3º arg de `renderCell` (Task 3).

- [ ] **Step 1: Ligar no CQ Pós (`CqPosView.tsx`)**

Nas matrizes de ENTRADA (as `renderCell` que devolvem `NumberInput` — a de recebimento/defeito, não a só-leitura `realByNum`): instanciar `const nav = useGradeTeclado({ nLinhas: variantes.length, nColunas: tamanhos.length })`, passar `posDaCelula={(num, t) => ({ linha: variantes.findIndex(v => v.num === num), coluna: tamanhos.indexOf(t) })}` e `gridRef` na raiz da matriz (um wrapper com `ref={nav.gridRef}`), e no `NumberInput` espalhar `{...nav.propsDaCelula(pos!.linha, pos!.coluna)}` usando o 3º arg `pos` do `renderCell`. Cada `MatrizGradeResponsiva` de entrada tem o SEU `useGradeTeclado` (escopo por matriz — Pós tem várias).

- [ ] **Step 2: Ligar no CQ Pré (`expedicao.cq.$modeloId.tsx`)**

Mesmo padrão na matriz de entrada do Pré (recebido/defeito por variante×tamanho que usa `MatrizGradeResponsiva`): `useGradeTeclado` com nº de variantes × nº de tamanhos, `posDaCelula` por índice, `gridRef` na raiz, `propsDaCelula` no input via o 3º arg.

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`
Run: `npm run build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git commit --only src/components/producao/CqPosView.tsx "src/routes/_authenticated/expedicao.cq.\$modeloId.tsx" -m "feat(cq): navegação por teclado nas grades de entrada (Pré e Pós)"
```

- [ ] **Step 5: QA (prévia localhost:5190) — registrar no relatório**

Abrir um CQ com grade de entrada: digitar num campo → Enter desce, Tab anda, Shift+Tab volta; conferir que pula tamanho fora da grade / campo travado; conferir mobile (<md) empilhado navega na mesma ordem. (Precisa de navegador — documentar como pendência se o subagente não tiver.)

---

### Task 5: Anti-regressão — `DistribuicaoTabelas` usa o hook

**Files:**
- Modify: `src/components/plan-tecido/DistribuicaoTabelas.tsx`
- Test: `tests/unit/distribuicao-nav-antiregressao.test.ts` (destinos via a lib pura)

**Interfaces:**
- Consumes: `useGradeTeclado` (Task 2).

- [ ] **Step 1: Write the failing test** (anti-regressão dos destinos — puro, sobre a lib)

```ts
import { describe, it, expect } from "vitest";
import { proximaCelulaDisponivel } from "@/lib/grade-teclado";

// A DistribuicaoTabelas é uma grade (lojas*cores) x (1 + tamanhos), tudo habilitado quando não bloqueado.
// Este teste fixa que os destinos de Enter/Tab/Shift são os de sempre (todas disponíveis).
describe("DistribuicaoTabelas navegação (anti-regressão)", () => {
  const nLinhas = 4, nColunas = 3; // ex.: 2 lojas * 2 cores, 1 base + 2 tamanhos
  const todas = () => true;
  it("Enter desce", () => {
    expect(proximaCelulaDisponivel({ tecla: "Enter", comShift: false, linha: 0, coluna: 0, nLinhas, nColunas, disponivel: todas }))
      .toEqual({ linha: 1, coluna: 0 });
  });
  it("Tab estoura no fim da linha", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: false, linha: 0, coluna: 2, nLinhas, nColunas, disponivel: todas }))
      .toEqual({ linha: 1, coluna: 0 });
  });
  it("Shift+Tab inverso", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: true, linha: 1, coluna: 0, nLinhas, nColunas, disponivel: todas }))
      .toEqual({ linha: 0, coluna: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (a lib já existe desde o Task 1)

Run: `npx vitest run tests/unit/distribuicao-nav-antiregressao.test.ts`
Expected: PASS (fixa o comportamento que a migração deve preservar).

- [ ] **Step 3: Migrar a `DistribuicaoTabelas` para o hook**

Trocar o `aoTeclar`/`caminhoCelula`/`proximaCelulaTeclado` inline por `useGradeTeclado({ nLinhas: nLinhasGrade, nColunas: nColunasGrade })`: pôr `ref={nav.gridRef}` na `<table>`, espalhar `{...nav.propsDaCelula(nav.linha, nav.coluna)}` no `NumberInput` de cada célula (onde hoje usa `onKeyDown={aoTeclar(...)}`), e adicionar `data-grade-cel` via `propsDaCelula` (o `data-colab-path` PERMANECE no mesmo input, para a co-edição). Remover o `aoTeclar`/`caminhoCelula` antigos.

- [ ] **Step 4: Type-check + build + testes colab (não regredir co-edição)**

Run: `npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`
Run: `npm run build`
Run: `npx vitest run tests/unit/grade-teclado.test.ts tests/unit/use-grade-teclado.test.ts tests/unit/matriz-grade-nav.test.tsx tests/unit/distribuicao-nav-antiregressao.test.ts`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git commit --only src/components/plan-tecido/DistribuicaoTabelas.tsx tests/unit/distribuicao-nav-antiregressao.test.ts -m "refactor(plan-tecido): DistribuicaoTabelas usa useGradeTeclado (navegação idêntica + pula travada; data-colab-path preservado)"
```

- [ ] **Step 6: QA (prévia) — Plan.Tecido**

Abrir o dialog "Distribuir por loja" e confirmar que Enter/Tab/Shift+Tab navegam como antes, e que a co-edição (anel de presença) segue funcionando no mesmo dialog.

---

## Notas de execução (subagentes)

- **Ordem:** Task 1 → 2 → 3 → 5 podem ser sequenciais; Task 4 depende de 2 e 3. Nunca em paralelo (compartilham `grade-teclado.ts` / `MatrizGradeResponsiva`).
- **Modelo:** Task 1-3 mecânicas (código no plano) → Sonnet. Task 4 e 5 tocam arquivos grandes (CQ 1976 linhas; DistribuicaoTabelas) → Sonnet, revisão Opus. **Haiku proibido** (feedback do dono).
- **Revisão final (whole-branch):** Opus, focada em (a) `proximaCelulaTeclado` intocada; (b) navegação da DistribuicaoTabelas idêntica + co-edição preservada; (c) prop `posDaCelula` retrocompatível (as outras telas que usam MatrizGradeResponsiva não mudam).
- **Commit paralelo:** sempre `git commit --only <arquivos>`.
- Front puro — o brief dos subagentes diz "ZERO migration, não tocar supabase/".
