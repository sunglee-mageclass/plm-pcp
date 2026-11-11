# F6 · Fluxo 1 — Aba Peça Teste + Filtro de Etapas + Enter na Explosão — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar os 3 itens de baixo risco do Fluxo 1 da F6: (A1) uma aba "Peça Teste" em PCP › Serviços, (A2) um filtro de Etapas no kanban do Desenvolvimento, (A3) navegação por Enter no Sheet de Explosão.

**Architecture:** Só-front, reaproveitando componentes/hooks/helpers que já existem. A aba Peça Teste reusa `usePecaTeste` (já standalone, recebe `modeloId`) + `PecaTesteSecao` (componente controlado de props) com um Salvar próprio via `salvar_peca_teste` — mesma fonte do Sheet (mão dupla, merge já existente). O filtro de Etapas é mais um `useFilterState` que filtra a lista `statusKanban` antes do render das colunas. O Enter reusa `proximaCelulaTeclado` (lib pura da F2) + o padrão `data-colab-path` + `requestAnimationFrame(focus)`.

**Tech Stack:** Vite + React + TanStack Query, shadcn/Radix, Supabase RPC (reuso, sem migration nova no Fluxo 1).

**Spec:** docs/superpowers/specs/2026-11-11-f6-etapas-pl-requisitos-design.md (Bloco A)

## Global Constraints

- **SEM migration no Fluxo 1** — só-front e reuso de RPCs existentes (`salvar_peca_teste`, `peca_teste_modelo`).
- **Mão dupla (firme):** a aba Peça Teste e a seção do Sheet editam o MESMO dado via `salvar_peca_teste`; edição simultânea = o merge colaborativo que a peça teste já tem (rev + P0409 + `mergePecaTeste`). NÃO criar cópia paralela.
- **Sheet do Dev e `PecaTesteSecao`/`usePecaTeste` INTOCADOS** — a aba só os CONSOME; não alterar o comportamento deles no Sheet.
- **Permissões:** aba abre para quem vê PCP › Serviços; EDITAR requer a permissão da tela (`producao_terceirizados`, via `useReadOnly()`) E o hook já exige `canView("criacao_planejamento:peca_teste")` internamente (`ativo`). Passar `podeEditar = !readOnly`.
- **Filtro de etapas:** individual, persiste por usuário (`useFilterState` → `user_ui_prefs`); etapa desmarcada SOME a coluna inteira (sem indicador).
- **Enter:** só navega em campo editável (`editing` ligado); borda = deixa o navegador seguir (não `preventDefault`).
- `tsc --noEmit` limpo nos arquivos tocados; build não faz type-check.

## Review Focus

- **Aba Peça Teste num modelo SEM trilha de peça teste** (nenhum serviço `exige_peca_teste`): a aba deve mostrar vazio/"não se aplica", nunca quebrar — coberto no Task 2 (render com `estado=null`).
- **Salvar da aba com conflito (outra pessoa salvou no Sheet)**: deve mostrar o conflito e NÃO gravar por cima — coberto no Task 3 (resultado `{conflito}` trava o Salvar).
- **Filtro de etapas que esconde TODAS as colunas**: o board não pode ficar quebrado/vazio sem saída — coberto no Task 5 (lista vazia = mostra todas, ou estado claro).
- **Enter na última linha/coluna da tabela da Explosão**: não pode focar `null` nem travar o Enter — coberto no Task 7 (`proximaCelulaTeclado` devolve `null` na borda → sem preventDefault).
- **Enter com a Explosão em modo leitura** (`editing=false`): não navega (não há inputs) — coberto no Task 7 (onKeyDown só nos inputs, que só existem com `editing`).

---

## Task 1: Helper de navegação por teclado DOM-based para a Explosão (A3, base)

**Files:**
- Create: `src/lib/explosao-teclado.ts`
- Test: `tests/unit/explosao-teclado.test.ts`

**Interfaces:**
- Produces: `focarProximoInput(atual: HTMLElement, tabela: HTMLElement, tecla: "Enter"|"Tab", comShift: boolean): boolean` — acha o próximo `[data-colab-path]` dentro de `tabela` na ordem do DOM e foca; retorna `true` se focou, `false` se era borda (deixa o navegador seguir). DOM-based (não coordenadas) porque as 3 tabelas da Explosão têm estruturas diferentes.

- [ ] **Step 1: Escrever o teste falhando**

```ts
// tests/unit/explosao-teclado.test.ts
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { focarProximoInput } from "@/lib/explosao-teclado";

function montaTabela(n: number): { tabela: HTMLElement; inputs: HTMLInputElement[] } {
  const tabela = document.createElement("table");
  const inputs: HTMLInputElement[] = [];
  for (let i = 0; i < n; i++) {
    const inp = document.createElement("input");
    inp.setAttribute("data-colab-path", `c${i}`);
    tabela.appendChild(inp);
    inputs.push(inp);
    inp.focus = () => { (document as any)._focado = inp; };
  }
  document.body.appendChild(tabela);
  return { tabela, inputs };
}

describe("focarProximoInput", () => {
  it("Enter foca o PRÓXIMO input na ordem do DOM e retorna true", () => {
    const { tabela, inputs } = montaTabela(3);
    const ok = focarProximoInput(inputs[0], tabela, "Enter", false);
    expect(ok).toBe(true);
    expect((document as any)._focado).toBe(inputs[1]);
  });
  it("Shift+Enter foca o ANTERIOR", () => {
    const { tabela, inputs } = montaTabela(3);
    const ok = focarProximoInput(inputs[2], tabela, "Enter", true);
    expect(ok).toBe(true);
    expect((document as any)._focado).toBe(inputs[1]);
  });
  it("Enter no ÚLTIMO input retorna false (borda)", () => {
    const { tabela, inputs } = montaTabela(2);
    const ok = focarProximoInput(inputs[1], tabela, "Enter", false);
    expect(ok).toBe(false);
  });
  it("tabela com 1 input: retorna false", () => {
    const { tabela, inputs } = montaTabela(1);
    expect(focarProximoInput(inputs[0], tabela, "Enter", false)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/unit/explosao-teclado.test.ts --no-file-parallelism`
Expected: FAIL ("Cannot find module '@/lib/explosao-teclado'")

- [ ] **Step 3: Implementar o helper**

```ts
// src/lib/explosao-teclado.ts
// F6 Fluxo 1 (A3) — navegação por teclado nas tabelas do Sheet de Explosão.
// DOM-based (ordem dos inputs `[data-colab-path]` dentro da própria <table>), porque as 3 seções
// (metragem, aviamentos, insumos) têm estruturas diferentes. Enter/Shift+Enter andam na ordem do
// DOM; borda (sem próximo) = retorna false e o chamador NÃO dá preventDefault (deixa o Tab nativo).
export function focarProximoInput(
  atual: HTMLElement,
  tabela: HTMLElement,
  tecla: "Enter" | "Tab",
  comShift: boolean,
): boolean {
  const campos = Array.from(tabela.querySelectorAll<HTMLInputElement>("input[data-colab-path]"));
  const i = campos.indexOf(atual as HTMLInputElement);
  if (i < 0) return false;
  const passo = comShift ? -1 : 1;
  const alvo = campos[i + passo];
  if (!alvo) return false;
  requestAnimationFrame(() => alvo.focus());
  return true;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run tests/unit/explosao-teclado.test.ts --no-file-parallelism`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/explosao-teclado.ts tests/unit/explosao-teclado.test.ts
git commit -m "feat(explosao): helper de navegação por teclado (F6 Fluxo 1 A3)"
```

---

## Task 2: Ligar o Enter nas 3 seções da Explosão (A3)

**Files:**
- Modify: `src/components/producao/explosao/ExplosaoMetragemSection.tsx` (input NumberInput do `metragem_enviada`)
- Modify: `src/components/producao/explosao/ExplosaoAviamentosSection.tsx` (input `aSeparar`)
- Modify: `src/components/producao/explosao/ExplosaoInsumosSection.tsx` (input `aEnviar`)

**Interfaces:**
- Consumes: `focarProximoInput` (Task 1).

- [ ] **Step 1: Criar um handler compartilhado inline em cada seção**

Em CADA uma das 3 seções, adicionar ao `<NumberInput>` editável o `onKeyDown` abaixo (o `closest("table")` acha a tabela ancestral; cada seção tem sua própria `<table>`):

```tsx
// no topo do arquivo:
import { focarProximoInput } from "@/lib/explosao-teclado";

// no NumberInput editável (ex.: ExplosaoInsumosSection.tsx ~linha 118):
onKeyDown={(e) => {
  if ((e.key !== "Enter" && e.key !== "Tab") || e.ctrlKey || e.metaKey || e.altKey) return;
  const tabela = e.currentTarget.closest("table");
  if (!tabela) return;
  const foco = focarProximoInput(e.currentTarget, tabela, e.key as "Enter" | "Tab", e.shiftKey);
  if (foco || e.key === "Enter") e.preventDefault(); // Enter nunca "submete"; Tab só intercepta se achou alvo
}}
```

Aplicar o MESMO bloco nos 3 inputs: `ExplosaoMetragemSection.tsx` (~163-172), `ExplosaoAviamentosSection.tsx` (~91-100), `ExplosaoInsumosSection.tsx` (~118-126).

- [ ] **Step 2: Verificar o build e o tsc**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep -E "Explosao(Metragem|Aviamentos|Insumos)Section|explosao-teclado" | head`
Expected: build OK; grep vazio (sem erros nos arquivos tocados)

- [ ] **Step 3: QA manual na prévia (anotar, sem automatizar aqui)**

Na prévia (5190), abrir um Sheet de Explosão, clicar no lápis (editing), preencher um campo "a separar/enviar" e apertar Enter → o foco vai para o próximo input da mesma tabela. Na última linha, o Enter não trava.

- [ ] **Step 4: Commit**

```bash
git add src/components/producao/explosao/ExplosaoMetragemSection.tsx src/components/producao/explosao/ExplosaoAviamentosSection.tsx src/components/producao/explosao/ExplosaoInsumosSection.tsx
git commit -m "feat(explosao): Enter navega para o próximo campo (F6 Fluxo 1 A3)"
```

---

## Task 3: Filtro de Etapas no kanban do Desenvolvimento (A2)

**Files:**
- Modify: `src/routes/_authenticated/criacao.desenvolvimento.tsx` (novo `useFilterState` "Etapas"; filtrar `statusKanban` nos 2 renders de coluna; objeto no `<FilterButton>`)
- Test: `tests/unit/etapas-filtro-colunas.test.ts` (função pura de filtragem de colunas)

**Interfaces:**
- Consumes: `useFilterState("desenvolvimento", "Etapas", [])` → `[string[], (v:string[])=>void]`; `statusKanban: {key,label}[]`.
- Produces: helper puro `colunasVisiveis(statusKanban, etapasSel): {key,label}[]` (extraído para testar sem React).

- [ ] **Step 1: Escrever o teste da função pura de filtragem**

```ts
// tests/unit/etapas-filtro-colunas.test.ts
import { describe, it, expect } from "vitest";
import { colunasVisiveis } from "@/lib/kanban-colunas-visiveis";

const COLS = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }];

describe("colunasVisiveis", () => {
  it("seleção VAZIA = mostra TODAS (sem filtro)", () => {
    expect(colunasVisiveis(COLS, [])).toEqual(COLS);
  });
  it("seleção parcial = só as marcadas, na ordem original", () => {
    expect(colunasVisiveis(COLS, ["c", "a"])).toEqual([{ key: "a", label: "A" }, { key: "c", label: "C" }]);
  });
  it("key inexistente na seleção é ignorada", () => {
    expect(colunasVisiveis(COLS, ["x", "b"])).toEqual([{ key: "b", label: "B" }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/etapas-filtro-colunas.test.ts --no-file-parallelism`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar a função pura**

```ts
// src/lib/kanban-colunas-visiveis.ts
// F6 Fluxo 1 (A2) — filtro de Etapas do kanban: a pessoa escolhe quais colunas ver (individual,
// persiste via useFilterState). Seleção VAZIA = sem filtro (todas). Preserva a ordem original.
export function colunasVisiveis<T extends { key: string }>(colunas: readonly T[], selecao: readonly string[]): T[] {
  if (selecao.length === 0) return [...colunas];
  const sel = new Set(selecao);
  return colunas.filter((c) => sel.has(c.key));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/etapas-filtro-colunas.test.ts --no-file-parallelism`
Expected: PASS

- [ ] **Step 5: Fiar na tela do Desenvolvimento**

Em `src/routes/_authenticated/criacao.desenvolvimento.tsx`:
1. Declarar o filtro junto dos outros (~linha 162): `const [fEtapas, setFEtapas] = useFilterState("desenvolvimento", "Etapas", []);`
2. Import: `import { colunasVisiveis } from "@/lib/kanban-colunas-visiveis";`
3. Logo após `statusKanban` (~235): `const colunasKanban = colunasVisiveis(statusKanban, fEtapas);`
4. Nos DOIS renders de coluna (desktop ~943 e mobile ~1111), trocar `statusKanban.map((s) => ...)` por `colunasKanban.map((s) => ...)`. (A coluna terminal "Reprovado" via `TERMINAL_DEV` fica FORA do filtro — sempre aparece, como hoje.)
5. No array `filters` do `<FilterButton>` (~881), acrescentar: `{ label: "Etapas", value: fEtapas, onChange: setFEtapas, options: statusKanban.map((s) => ({ id: s.key, nome: s.label })) }`.

- [ ] **Step 6: Verificar build/tsc**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep -E "criacao.desenvolvimento|kanban-colunas-visiveis" | head`
Expected: build OK; grep vazio

- [ ] **Step 7: Commit**

```bash
git add src/lib/kanban-colunas-visiveis.ts tests/unit/etapas-filtro-colunas.test.ts src/routes/_authenticated/criacao.desenvolvimento.tsx
git commit -m "feat(kanban-dev): filtro de Etapas esconde colunas (F6 Fluxo 1 A2)"
```

---

## Task 4: Componente da aba Peça Teste (A1 — wrapper standalone)

**Files:**
- Create: `src/components/producao/servicos/PecaTesteAba.tsx`
- Test: `tests/unit/peca-teste-aba.test.ts` (render estático: monta com `modeloId` e checa que não quebra sem trilha)

**Interfaces:**
- Consumes: `usePecaTeste({ modeloId, habilitado, podeEditar, fornecedorMo: null, mini: null })` (já standalone); `PecaTesteSecao` (props); `salvarComConfirmacaoEstorno` (`usePecaTeste.ts:68`).
- Produces: `<PecaTesteAba modeloId={string} podeEditar={boolean} />` — a aba completa com Salvar próprio.

- [ ] **Step 1: Escrever o teste de render (não quebra sem trilha / sem permissão)**

```ts
// tests/unit/peca-teste-aba.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => true, canEdit: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PecaTesteAba } from "@/components/producao/servicos/PecaTesteAba";

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null }); });

describe("PecaTesteAba", () => {
  it("monta sem quebrar quando o modelo não tem trilha (estado null)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(
        createElement(QueryClientProvider, { client: qc }, createElement(PecaTesteAba, { modeloId: "m1", podeEditar: true })),
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.textContent).toBeTruthy(); // renderizou algo (ex.: "Sem peça teste" / seção vazia), não lançou
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/peca-teste-aba.test.ts --no-file-parallelism`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar o wrapper**

```tsx
// src/components/producao/servicos/PecaTesteAba.tsx
// F6 Fluxo 1 (A1) — a MESMA seção de Peça Teste do Sheet do Planejamento, trazida para PCP › Serviços,
// para o PCP trabalhar a peça teste sem entrar no Sheet do time de estilo. MÃO DUPLA: edita o MESMO dado
// (RPC salvar_peca_teste + trilha por modelo); o merge/P0409 do próprio hook cobre edição simultânea.
// Standalone: usePecaTeste recebe modeloId e lê/salva pelas próprias RPCs (fornecedorMo/mini = null aqui).
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePecaTeste, salvarComConfirmacaoEstorno } from "@/components/planejamento/planejamento-detail/usePecaTeste";
import { PecaTesteSecao } from "@/components/planejamento/planejamento-detail/PecaTesteSecao";
import { mensagemErro } from "@/lib/erro-mensagem";

export function PecaTesteAba({ modeloId, podeEditar }: { modeloId: string; podeEditar: boolean }) {
  const pt = usePecaTeste({ modeloId, habilitado: true, podeEditar, fornecedorMo: null, mini: null });
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (pt.pecaTesteSave.conflitos() > 0) {
      toast.error("Resolva os conflitos da Peça Teste antes de salvar.");
      return;
    }
    const captura = pt.pecaTesteSave.capturar();
    if (!captura) { toast.success("Nada para salvar."); return; }
    setSalvando(true);
    try {
      // salvarComConfirmacaoEstorno pede confirmação se há estorno de baixa pendente (padrão do Sheet).
      const res = await salvarComConfirmacaoEstorno(pt.pecaTesteSave, async () => true, async () => pt.pecaTesteSave.salvar(captura));
      if (res && "ok" in res && res.ok) { pt.pecaTesteSave.aposSalvar(captura); toast.success("Peça teste salva."); }
      else if (res && "conflito" in res) toast.error("Outra pessoa salvou — confira os conflitos na seção.");
      else if (res && "erro" in res) toast.error(mensagemErro(res.erro, "Não foi possível salvar a peça teste."));
    } finally { setSalvando(false); }
  };

  return (
    <div className="space-y-3">
      <PecaTesteSecao
        estado={pt.estado}
        base={pt.base}
        fornecedores={[]}
        somenteLeitura={!podeEditar}
        carregando={pt.carregando}
        erro={pt.erro}
        onTentarDeNovo={pt.tentarDeNovo}
        conflitos={pt.conflitos}
        onResolverConflito={pt.resolverConflito}
        avisos={pt.avisos}
        onEditarAtual={pt.editarAtual}
        onAprovar={pt.aprovarAtual}
        onDesfazer={pt.desfazerAtual}
        onReprovar={pt.reprovarAtual}
        onTrocarFornecedor={pt.trocarFornecedor}
        onEditarMini={pt.editarMini}
        onEditarMiniTentativa={pt.editarMiniTentativa}
        defaultAberta
      />
      {podeEditar && pt.dirty && (
        <div className="flex justify-end">
          <Button size="sm" onClick={salvar} disabled={salvando || pt.conflitos.length > 0}>
            {salvando ? "Salvando…" : "Salvar peça teste"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

> ⚠️ Nota ao implementador: confirme no `usePecaTeste.ts` os nomes EXATOS dos handlers retornados (`editarAtual`/`aprovarAtual`/`desfazerAtual`/`reprovarAtual`/`trocarFornecedor`/`editarMini`/`editarMiniTentativa`, `estado`, `base`, `dirty`, `conflitos`, `resolverConflito`, `avisos`, `carregando`, `erro`, `tentarDeNovo`, `pecaTesteSave`) e as props EXATAS do `PecaTesteSecao` (o levantamento listou todas). Se `fornecedores` precisar vir populado (lista de empresas de serviço da loja) para o seletor de fornecedor funcionar na aba, carregue-as como a tela de Serviços já faz; se o levantamento mostrar que a troca de fornecedor na aba não é prioridade, `[]` basta e o campo fica só-leitura.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/peca-teste-aba.test.ts --no-file-parallelism`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/producao/servicos/PecaTesteAba.tsx tests/unit/peca-teste-aba.test.ts
git commit -m "feat(pcp-servicos): componente da aba Peça Teste standalone (F6 Fluxo 1 A1)"
```

---

## Task 5: Toggle "Serviços | Peça Teste" na tela de Serviços (A1 — fiação)

**Files:**
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx` (estado `vista`; toggle no topo; render condicional da aba)

**Interfaces:**
- Consumes: `PecaTesteAba` (Task 4); `useReadOnly()` (já importado na tela); `modeloId` (já disponível).

- [ ] **Step 1: Adicionar o estado da vista e o toggle**

Em `pcp.servicos.$modeloId.tsx`, perto do `tabEtapa` (~523):
```tsx
const [vista, setVista] = useState<"servicos" | "peca_teste">("servicos");
```
No cabeçalho (~1547, mesmo nível do toggle Pré/Pós, FORA do `<fieldset>`), adicionar o toggle Serviços|Peça Teste seguindo o padrão exato do toggle Pré/Pós (linha 1569):
```tsx
<div className="flex rounded-md border p-0.5 w-fit">
  <Button type="button" size="sm" variant={vista === "servicos" ? "secondary" : "ghost"} onClick={() => setVista("servicos")}>Serviços</Button>
  <Button type="button" size="sm" variant={vista === "peca_teste" ? "secondary" : "ghost"} onClick={() => setVista("peca_teste")}>Peça Teste</Button>
</div>
```

- [ ] **Step 2: Render condicional**

O corpo atual de Serviços (o `<fieldset>` + abas Pré/Pós) só renderiza quando `vista === "servicos"`. Quando `vista === "peca_teste"`, renderizar:
```tsx
{vista === "peca_teste" && modeloId && (
  <PecaTesteAba modeloId={modeloId} podeEditar={!readOnly} />
)}
```
(Import no topo: `import { PecaTesteAba } from "@/components/producao/servicos/PecaTesteAba";`. O toggle Pré/Pós e o fieldset de Serviços ficam dentro de `{vista === "servicos" && (...)}`.)

- [ ] **Step 3: Verificar build/tsc**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep -E "pcp.servicos|PecaTesteAba" | head`
Expected: build OK; grep vazio

- [ ] **Step 4: QA manual na prévia**

Na prévia (5190), abrir um modelo em PCP › Serviços → alternar "Serviços | Peça Teste" → a aba Peça Teste mostra a mesma seção do Sheet; editar uma data e Salvar → reflete no Sheet do Planejamento (mão dupla).

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/pcp.servicos.$modeloId.tsx
git commit -m "feat(pcp-servicos): toggle Serviços|Peça Teste (F6 Fluxo 1 A1)"
```

---

## Self-Review

**1. Spec coverage (Bloco A):** A1 (aba Peça Teste) → Tasks 4+5; A2 (filtro de etapas) → Task 3; A3 (Enter) → Tasks 1+2. Gate simples da aba = herda o `enviado_corte` da tela (não precisa tarefa própria). Mão dupla = coberta pelo reuso de `salvar_peca_teste` (Task 4). ✓

**2. Placeholder scan:** sem TBD/TODO. A nota ao implementador na Task 4 é uma verificação de nomes exatos (o levantamento os tem), não um placeholder de lógica. ✓

**3. Type consistency:** `focarProximoInput` (Task 1) usado igual na Task 2; `colunasVisiveis` (Task 3) assinatura única; `PecaTesteAba` props `{modeloId, podeEditar}` iguais nas Tasks 4 e 5. ✓

**4. Review Focus:** modelo sem trilha (Task 4 teste), conflito ao salvar (Task 4 — resultado `{conflito}` trava), filtro esconde tudo (Task 3 — seleção vazia = todas), Enter na borda (Task 1 teste), Enter em leitura (Task 2 — onKeyDown só nos inputs editáveis). ✓
