# Salvar por card — preço/markup da revenda no Salvar único Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Os 4 campos de preço da revenda (markup atacado/varejo + preço fixo atacado/varejo) deixam de gravar onBlur e passam a gravar no Salvar único do Sheet, espelhando o padrão do importado.

**Architecture:** O rascunho dos 4 campos já vive em estado local do `useRevendaPlanejamento`. Tiramos os `onBlur→.mutate` de `RevendaSetores`, somamos esses 4 valores ao dirty-snapshot do Sheet, passamos os valores + base congelada ao `usePlanejamentoSave`, e adicionamos um bloco "revenda" no `mutationFn` (gêmeo do "n1" do importado) que chama as 2 RPCs da revenda DEPOIS do UPDATE do header, só nos canais que mudaram e sem enviar o canal varejo quando a Integração o trava.

**Tech Stack:** React + TanStack Query + Supabase (RPCs `salvar_markups_produto_acabado`, `salvar_precos_fixo_produto_acabado`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-salvar-por-card-revenda-design.md`

## Global Constraints

- Escopo: SÓ a revenda. Importado, manufaturado, endereçamento, observações, nomes e zona cinza do Plan.Tecido ficam INTOCADOS.
- Front puro: ZERO migration, ZERO mudança de banco. As 2 RPCs já existem com a assinatura atual.
- `salvar_markups_produto_acabado(_produto_id uuid, _markup_atacado numeric|null, _markup_varejo numeric|null)`.
- `salvar_precos_fixo_produto_acabado(_produto_id uuid, _tocar_atacado bool, _preco_atacado_fixo numeric|null, _tocar_varejo bool, _preco_varejo_fixo numeric|null)`.
- Base congelada: comparar o rascunho contra os valores do servidor lidos no ponto SÍNCRONO inicial do `mutationFn` (antes de qualquer `await`), NUNCA contra `baseRef.current` lido depois (fix M-2 do importado — o merge do colab pode ter avançado a base).
- Trava da Integração: só o canal VAREJO (`preco_venda`) é marcável; atacado nunca trava. Quando `travaVarejo`, o canal varejo NUNCA é enviado como valor novo (markup varejo = valor do servidor; `_tocar_varejo = false`).
- Permissão: os 4 campos só editam/gravam com `podeEditarPrecoComprado`; `planBloqueado` desabilita.
- Após imports/identificadores novos, rodar `npx tsc --noEmit | grep TS2304` (o `vite build` não faz type-check).
- Commits frequentes; nunca `git add .` (índice compartilhado) — commitar por caminho.

## Review Focus

- **Canal intocado reenviado:** editar só o atacado e Salvar deve preservar o markup varejo do servidor (via `markupCanalIntocado`), não mandar `null`/apagar — Task 1 cobre com teste.
- **Varejo travado pela Integração:** Salvar com `travaVarejo=true` nunca envia preço/markup varejo novo (senão 42501 do gatilho DEPOIS do header comitado) — Task 1 cobre.
- **Base não congelada:** se o preço do servidor mudou durante os awaits do Salvar, comparar o rascunho contra a base CONGELADA (não a nova) para não reenviar valor não-tocado por cima de edição alheia — Task 2 cobre (congela no ponto síncrono).
- **Preço fixo vs markup exclusivos:** digitar preço fixo num canal manda `_tocar_<canal>=true` (o servidor limpa o markup daquele canal); só mandar o canal que mudou — Task 1 cobre.
- **Nada mudou → não chama RPC:** abrir o card e Salvar sem tocar a revenda não dispara `salvar_markups`/`salvar_precos_fixo` (evita bump/recompute à toa e P0409 falso) — Task 1 cobre.

---

### Task 1: Helper puro `payloadRevendaParaSalvar`

Extrai a decisão "o que mandar por canal" para uma função pura e testável, hoje espalhada nos 4 onBlur de `RevendaSetores`. Isola a lógica (canal tocado vs. intocado vs. travado; markup vs. preço fixo) do React.

**Files:**
- Create: `src/lib/revenda-salvar.ts`
- Test: `tests/unit/revenda-salvar.test.ts`

**Interfaces:**
- Consumes: `markupCanalIntocado(servidor, input, enviado)` de `@/components/produto-acabado/shared` (já existe; decide o valor do canal não editado).
- Produces:
  - `type RevendaBase = { markup_atacado: number | null; markup_varejo: number | null; preco_atacado: number | null; preco_venda: number | null }`
  - `type RevendaRascunho = { markupAtacado: number | null; markupVarejo: number | null; precoAtacadoFixo: number | null; precoVarejoFixo: number | null }`
  - `type MarkupEnviado = { valor: number | null; servidorAntes: number | null | undefined } | null`
  - `type PayloadRevenda = { markups: { markup_atacado: number | null; markup_varejo: number | null } | null; fixos: { tocarAtacado: boolean; precoAtacado: number | null; tocarVarejo: boolean; precoVarejo: number | null } | null }`
  - `function payloadRevendaParaSalvar(base: RevendaBase, rasc: RevendaRascunho, travaVarejo: boolean, enviadoAtacado: MarkupEnviado, enviadoVarejo: MarkupEnviado): PayloadRevenda` — `markups`/`fixos` `null` quando aquele grupo não mudou (⇒ não chamar a RPC).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/revenda-salvar.test.ts
import { describe, it, expect } from "vitest";
import { payloadRevendaParaSalvar, type RevendaBase, type RevendaRascunho } from "@/lib/revenda-salvar";

const base: RevendaBase = { markup_atacado: 2, markup_varejo: 3, preco_atacado: null, preco_venda: null };
const rasc = (p: Partial<RevendaRascunho> = {}): RevendaRascunho => ({
  markupAtacado: 2, markupVarejo: 3, precoAtacadoFixo: null, precoVarejoFixo: null, ...p,
});

describe("payloadRevendaParaSalvar", () => {
  it("nada mudou → não manda nada", () => {
    const r = payloadRevendaParaSalvar(base, rasc(), false, null, null);
    expect(r.markups).toBeNull();
    expect(r.fixos).toBeNull();
  });

  it("só atacado mudou → manda markups com varejo intocado (valor do servidor)", () => {
    const r = payloadRevendaParaSalvar(base, rasc({ markupAtacado: 2.5 }), false, null, null);
    expect(r.markups).toEqual({ markup_atacado: 2.5, markup_varejo: 3 });
    expect(r.fixos).toBeNull();
  });

  it("varejo travado → nunca manda markup varejo novo", () => {
    const r = payloadRevendaParaSalvar(base, rasc({ markupAtacado: 2.5, markupVarejo: 9 }), true, null, null);
    expect(r.markups?.markup_atacado).toBe(2.5);
    expect(r.markups?.markup_varejo).toBe(3); // servidor, não o 9 digitado
  });

  it("preço atacado fixo digitado → tocarAtacado=true, varejo não tocado", () => {
    const r = payloadRevendaParaSalvar(base, rasc({ precoAtacadoFixo: 49.9 }), false, null, null);
    expect(r.fixos).toEqual({ tocarAtacado: true, precoAtacado: 49.9, tocarVarejo: false, precoVarejo: null });
  });

  it("preço varejo fixo com varejo travado → tocarVarejo=false (não grava no canal travado)", () => {
    const r = payloadRevendaParaSalvar(base, rasc({ precoVarejoFixo: 80 }), true, null, null);
    expect(r.fixos?.tocarVarejo).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/revenda-salvar.test.ts`
Expected: FAIL — `payloadRevendaParaSalvar` não existe (módulo não encontrado).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/revenda-salvar.ts
// Decisão pura "o que o Salvar manda para a revenda" (extraída dos onBlur de RevendaSetores).
// markup e preço fixo são mutuamente exclusivos POR CANAL no servidor; aqui só decidimos o que
// ENVIAR. Canal varejo travado pela Integração nunca recebe valor novo.
import { markupCanalIntocado } from "@/components/produto-acabado/shared";

export type RevendaBase = { markup_atacado: number | null; markup_varejo: number | null; preco_atacado: number | null; preco_venda: number | null };
export type RevendaRascunho = { markupAtacado: number | null; markupVarejo: number | null; precoAtacadoFixo: number | null; precoVarejoFixo: number | null };
export type MarkupEnviado = { valor: number | null; servidorAntes: number | null | undefined } | null;
export type PayloadRevenda = {
  markups: { markup_atacado: number | null; markup_varejo: number | null } | null;
  fixos: { tocarAtacado: boolean; precoAtacado: number | null; tocarVarejo: boolean; precoVarejo: number | null } | null;
};

export function payloadRevendaParaSalvar(
  base: RevendaBase,
  rasc: RevendaRascunho,
  travaVarejo: boolean,
  enviadoAtacado: MarkupEnviado,
  enviadoVarejo: MarkupEnviado,
): PayloadRevenda {
  // MARKUPS: manda se o canal editável mudou vs. base. O canal não-tocado vai pelo markupCanalIntocado
  // (reenvia o último enviado nesta sessão, não o valor velho do servidor pré-refetch). Varejo travado:
  // sempre o valor do servidor (base.markup_varejo), nunca o rascunho.
  const atacadoMudou = rasc.markupAtacado !== base.markup_atacado;
  const varejoMudou = !travaVarejo && rasc.markupVarejo !== base.markup_varejo;
  let markups: PayloadRevenda["markups"] = null;
  if (atacadoMudou || varejoMudou) {
    markups = {
      markup_atacado: atacadoMudou ? rasc.markupAtacado : markupCanalIntocado(base.markup_atacado, rasc.markupAtacado, enviadoAtacado),
      markup_varejo: travaVarejo
        ? base.markup_varejo
        : varejoMudou ? rasc.markupVarejo : markupCanalIntocado(base.markup_varejo, rasc.markupVarejo, enviadoVarejo),
    };
  }

  // FIXOS: só o canal cujo preço fixo mudou é "tocado". Varejo travado nunca é tocado.
  const atacadoFixoMudou = rasc.precoAtacadoFixo !== base.preco_atacado;
  const varejoFixoMudou = !travaVarejo && rasc.precoVarejoFixo !== base.preco_venda;
  let fixos: PayloadRevenda["fixos"] = null;
  if (atacadoFixoMudou || varejoFixoMudou) {
    fixos = {
      tocarAtacado: atacadoFixoMudou,
      precoAtacado: atacadoFixoMudou ? rasc.precoAtacadoFixo : null,
      tocarVarejo: varejoFixoMudou,
      precoVarejo: varejoFixoMudou ? rasc.precoVarejoFixo : null,
    };
  }

  return { markups, fixos };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/revenda-salvar.test.ts`
Expected: PASS (5 testes). Se `markupCanalIntocado` tiver assinatura diferente da suposta, ajuste a CHAMADA (não o teste) — leia `src/components/produto-acabado/shared.ts` e use a assinatura real; o teste passa `enviado=null`, que deve cair no valor do servidor.

- [ ] **Step 5: Commit**

```bash
git add src/lib/revenda-salvar.ts tests/unit/revenda-salvar.test.ts
git commit -m "feat(camada): helper puro payloadRevendaParaSalvar (revenda no Salvar)"
```

---

### Task 2: Cadeia de Salvar grava a revenda (bloco gêmeo do n1 do importado)

Adiciona ao `mutationFn` de `usePlanejamentoSave` um bloco, no ramo `d.origem === "revenda"`, que grava markups/preços fixos via as 2 RPCs, DEPOIS do UPDATE do header, usando o helper da Task 1 com a base congelada. Passa os valores do rascunho da revenda como novo argumento do hook.

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` (tipo dos args + bloco no `mutationFn`, logo após o bloco "n1" do importado, ~linha 860; e invalidações no onSuccess)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (passar os novos args ao `usePlanejamentoSave` a partir de `revenda` e congelar a base)
- Test: `tests/integration/salvar-revenda-no-save.test.ts`

**Interfaces:**
- Consumes: `payloadRevendaParaSalvar`, `RevendaBase`, `RevendaRascunho` (Task 1); o hook `revenda` (`markupAtacadoInput`, `markupVarejoInput`, `precoAtacadoDraft`, `precoVarejoDraft`, `enviadoAtacadoRef`, `enviadoVarejoRef`, `produtoRevenda`); `supabase.rpc` das 2 RPCs; `travaIntegracao` (já calculado na cadeia; `travaVarejo = travaIntegracao.has("preco_venda")`).
- Produces: nenhum export novo; muda o comportamento do Salvar para a revenda.

Novo campo do objeto de args de `usePlanejamentoSave` (adicionar ao tipo `UsePlanejamentoSaveArgs`):
```ts
  /** C7 — rascunho de preço/markup da revenda lido NO INSTANTE do Salvar (via ref, não closure de render velho).
   *  Ausente/null = card não é revenda ou sem produto espelho ⇒ bloco revenda não roda. */
  revendaSaveRef?: RefObject<{
    produtoId: string;
    base: import("@/lib/revenda-salvar").RevendaBase;
    rascunho: import("@/lib/revenda-salvar").RevendaRascunho;
    enviadoAtacado: import("@/lib/revenda-salvar").MarkupEnviado;
    enviadoVarejo: import("@/lib/revenda-salvar").MarkupEnviado;
  } | null>;
```

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/salvar-revenda-no-save.test.ts
// Prova no banco (cópia local, txn revertida) que as RPCs da revenda gravam o que o helper manda.
// NÃO exercita o React: chama as 2 RPCs com o payload que payloadRevendaParaSalvar produz, como a
// cadeia de Salvar fará, e confere produtos_acabados + o recompute de modelos.
import { describe, it, expect, beforeAll } from "vitest";
import { comTxn, sql } from "./db"; // helper padrão da suíte (txn revertida)
import { payloadRevendaParaSalvar } from "@/lib/revenda-salvar";

describe("revenda grava pelo Salvar (via RPCs)", () => {
  it("markup atacado editado → produtos_acabados.markup_atacado muda e modelos.preco_atacado recomputa", async () => {
    await comTxn(async (c) => {
      const { modeloId, produtoId } = await seedRevenda(c); // helper local: cria modelo revenda + produto espelho
      const base = await lerBaseRevenda(c, produtoId); // {markup_atacado, markup_varejo, preco_atacado, preco_venda}
      const p = payloadRevendaParaSalvar(base, { markupAtacado: 2.5, markupVarejo: base.markup_varejo, precoAtacadoFixo: base.preco_atacado, precoVarejoFixo: base.preco_venda }, false, null, null);
      expect(p.markups).not.toBeNull();
      await c.rpc("salvar_markups_produto_acabado", { _produto_id: produtoId, _markup_atacado: p.markups!.markup_atacado, _markup_varejo: p.markups!.markup_varejo });
      const depois = await lerBaseRevenda(c, produtoId);
      expect(depois.markup_atacado).toBe(2.5);
    });
  });
});
```
(O implementador escreve `seedRevenda`/`lerBaseRevenda` seguindo o harness do importado em `tests/integration/` — produto `produtos_acabados` vinculado a um `modelos.origem='revenda'`. Se não houver helper de revenda pronto, reusar o de produto-acabado.)

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run tests/integration/salvar-revenda-no-save.test.ts --no-file-parallelism`
Expected: FAIL enquanto o seed/leitura não existem (ou enquanto `payloadRevendaParaSalvar` ainda não estiver importável no contexto de integração). ⚠️ DATABASE_URL SEMPRE a cópia LOCAL 54422 (fallback = PRODUÇÃO — nunca rodar sem export).

- [ ] **Step 3: Implementação — congelar base no PlanejamentoDetail e montar o ref**

Em `src/components/planejamento/PlanejamentoDetail.tsx`, logo após `const revenda = useRevendaPlanejamento(...)` (~linha 668), montar um ref sincronizado a cada render (espelho síncrono, mesmo padrão do `fichaRef`):

```ts
import { payloadRevendaParaSalvar, type RevendaBase, type RevendaRascunho, type MarkupEnviado } from "@/lib/revenda-salvar";
// ...
const revendaSaveRef = useRef<{
  produtoId: string; base: RevendaBase; rascunho: RevendaRascunho; enviadoAtacado: MarkupEnviado; enviadoVarejo: MarkupEnviado;
} | null>(null);
revendaSaveRef.current =
  isRevenda && revenda.produtoRevenda && podeEditarPrecoComprado
    ? {
        produtoId: revenda.produtoRevenda.id,
        base: {
          markup_atacado: revenda.produtoRevenda.markup_atacado ?? null,
          markup_varejo: revenda.produtoRevenda.markup_varejo ?? null,
          preco_atacado: draft.preco_atacado ?? null,
          preco_venda: draft.preco_venda ?? null,
        },
        rascunho: {
          markupAtacado: revenda.markupAtacadoInput,
          markupVarejo: revenda.markupVarejoInput,
          precoAtacadoFixo: revenda.precoAtacadoDraft ? Number(revenda.precoAtacadoDraft) || null : null,
          precoVarejoFixo: revenda.precoVarejoDraft ? Number(revenda.precoVarejoDraft) || null : null,
        },
        enviadoAtacado: revenda.enviadoAtacadoRef.current,
        enviadoVarejo: revenda.enviadoVarejoRef.current,
      }
    : null;
```
Passar `revendaSaveRef` no objeto de args de `usePlanejamentoSave({...})` (~linha 1042).

- [ ] **Step 4: Implementação — bloco revenda no mutationFn**

Em `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts`:
1. Adicionar `revendaSaveRef?` ao tipo de args (bloco de `Interfaces` acima).
2. No ponto SÍNCRONO inicial do `mutationFn` (junto de `d`/`revCongelado`, ANTES de qualquer `await`): `const revendaCongelada = revendaSaveRef?.current ?? null;` — congela a leitura.
3. Logo APÓS o bloco "n1" do importado (~linha 860, depois do UPDATE do header e da auto-criação), adicionar:

```ts
// C7 (Camada) — REVENDA: markups/preços fixos gravam AQUI (no Salvar), não mais onBlur. Espelha o
// n1 do importado. `revendaCongelada` foi lido no ponto síncrono inicial (base congelada — fix M-2).
if (d.origem === "revenda" && revendaCongelada && podeEditarPreco) {
  const travaVarejo = travaIntegracao.has("preco_venda");
  const pay = payloadRevendaParaSalvar(
    revendaCongelada.base, revendaCongelada.rascunho, travaVarejo,
    revendaCongelada.enviadoAtacado, revendaCongelada.enviadoVarejo,
  );
  if (pay.markups) {
    const { error } = await supabase.rpc("salvar_markups_produto_acabado" as any, {
      _produto_id: revendaCongelada.produtoId,
      _markup_atacado: pay.markups.markup_atacado, _markup_varejo: pay.markups.markup_varejo,
    });
    if (error) throw error;
  }
  if (pay.fixos) {
    const { error } = await supabase.rpc("salvar_precos_fixo_produto_acabado" as any, {
      _produto_id: revendaCongelada.produtoId,
      _tocar_atacado: pay.fixos.tocarAtacado, _preco_atacado_fixo: pay.fixos.precoAtacado,
      _tocar_varejo: pay.fixos.tocarVarejo, _preco_varejo_fixo: pay.fixos.precoVarejo,
    });
    if (error) throw error;
  }
}
```
4. No `onSuccess` do Salvar, acrescentar as invalidações que as mutations faziam (só uma vez, no fim): `["modelo", modeloId]`, `["pa-produto-modelo", modeloId]`, `["produtos-acabados"]`, `["modelos-planejamento"]` — se já não estiverem lá (o importado já invalida `["modelo"]`; não duplicar).

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run tests/integration/salvar-revenda-no-save.test.ts --no-file-parallelism`
Expected: PASS.

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "usePlanejamentoSave|PlanejamentoDetail|revenda-salvar|TS2304" | head
git add src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts src/components/planejamento/PlanejamentoDetail.tsx tests/integration/salvar-revenda-no-save.test.ts
git commit -m "feat(camada): revenda grava preco/markup no Salvar unico (bloco gemeo do n1)"
```

---

### Task 3: Remover os 4 onBlur de `RevendaSetores` (os campos viram só rascunho)

Com o Salvar já gravando a revenda (Task 2), os inputs param de gravar na hora: `onBlur` só tira o foco, nada de `.mutate`. Os valores já marcam o card sujo (entram no `revendaSaveRef`, e o Sheet detecta dirty pela diferença rascunho×base — ver Step 3).

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/RevendaSetores.tsx` (4 `onBlur`, linhas ~96/113/186/205)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (incluir o rascunho da revenda no dirty do Sheet)
- Test: `tests/unit/revenda-setores-sem-onblur.test.tsx`

**Interfaces:**
- Consumes: os estados do hook `revenda` já existentes.
- Produces: nada novo.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/revenda-setores-sem-onblur.test.tsx
// Garante que editar os campos NÃO dispara mutation (o Salvar é que grava). Testa por fonte/
// comportamento: renderiza RevendaSetores com mutations espiãs e confirma que o blur não as chama.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
// ... monta um `rv` falso com salvarMarkupsRevenda.mutate = vi.fn() e salvarPrecosFixoRevenda.mutate = vi.fn()
// renderiza <RevendaSetores rv={rvFake} .../>, edita o markup atacado, dispara blur,
// e espera que rvFake.salvarMarkupsRevenda.mutate NÃO tenha sido chamada.
it("editar markup e sair do campo NÃO grava (sem onBlur→mutate)", () => {
  // ...
  expect(rvFake.salvarMarkupsRevenda.mutate).not.toHaveBeenCalled();
  expect(rvFake.salvarPrecosFixoRevenda.mutate).not.toHaveBeenCalled();
});
```
(Se montar o componente isolado for custoso pelas muitas props, o implementador pode trocar por um teste de FONTE: ler `RevendaSetores.tsx` e asseverar que nenhuma string `salvarMarkupsRevenda.mutate`/`salvarPrecosFixoRevenda.mutate` aparece no arquivo — grep no conteúdo. Esse teste de fonte é aceitável aqui porque o comportamento "não grava onBlur" é exatamente a ausência dessas chamadas.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/revenda-setores-sem-onblur.test.tsx`
Expected: FAIL — hoje o blur chama `.mutate` (ou o grep encontra as chamadas).

- [ ] **Step 3: Implementação — tirar os .mutate dos 4 onBlur**

Em `RevendaSetores.tsx`, nos 4 campos:
- markup atacado (~96) e varejo (~113): trocar `onBlur={() => { if (...) salvarMarkupsRevenda.mutate({...}); }}` por nada (remover o `onBlur` inteiro — o `onKeyDown` Enter→blur fica; o `onChange` que faz `setMarkup*Input` fica).
- preço atacado (~186) e varejo (~205): remover o `onBlur` que chama `salvarPrecosFixoRevenda.mutate`; manter `onChange`→`setPreco*Draft` e o Enter→blur.
- Remover de `disabled` a parte `|| salvarMarkupsRevenda.isPending` (não há mais mutation em voo por campo). Manter `planBloqueado`, `!podeEditarPrecoComprado`, `travaVarejo`.

Em `PlanejamentoDetail.tsx`, garantir que o rascunho da revenda conta como "não salvo": como `useDirtySnapshot(draft)` observa só o `draft` do modelo, somar um sinal de dirty da revenda. Opção mínima: derivar `revendaDirty` do mesmo `revendaSaveRef`/payload e compor com o dirty da página onde o selo/guard são calculados:
```ts
const revendaDirty = (() => {
  const s = revendaSaveRef.current;
  if (!s) return false;
  const p = payloadRevendaParaSalvar(s.base, s.rascunho, travaIntegracaoDaTela.has("preco_venda"), s.enviadoAtacado, s.enviadoVarejo);
  return !!(p.markups || p.fixos);
})();
```
e incluir `revendaDirty` no OR que já alimenta o selo "alterações não salvas" / o `useUnsavedGuard` da página (procurar onde `draftDirty`/`gradeRevendaDirty` são combinados e somar `|| revendaDirty`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/revenda-setores-sem-onblur.test.tsx`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "RevendaSetores|PlanejamentoDetail|TS2304" | head
git add src/components/planejamento/planejamento-detail/RevendaSetores.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/revenda-setores-sem-onblur.test.tsx
git commit -m "feat(camada): campos de preco da revenda viram rascunho (sem onBlur->grava)"
```

---

### Task 4: Limpeza do hook + verificação final

As mutations `salvarMarkupsRevenda`/`salvarPrecosFixoRevenda` do hook não são mais chamadas pela UI, mas a cadeia de Salvar usa as RPCs direto (Task 2). Decidir: manter as mutations no hook (caso algum outro consumidor use) ou removê-las. Conferir consumidores antes de remover.

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/useRevendaPlanejamento.ts` (só se nenhum outro consumidor usar as mutations)
- Test: gate geral (build + tsc + suíte unit tocada)

- [ ] **Step 1: Conferir se as mutations ainda têm consumidor**

Run: `grep -rn "salvarMarkupsRevenda\|salvarPrecosFixoRevenda" src/ | grep -v useRevendaPlanejamento.ts`
Expected: se SÓ `RevendaSetores` aparecia e já não usa mais (Task 3), as mutations ficaram órfãs. Se houver outro consumidor, NÃO remover.

- [ ] **Step 2: Se órfãs, remover as 2 mutations do return e a definição**

Remover `salvarMarkupsRevenda`/`salvarPrecosFixoRevenda` do objeto de `return` (linha ~221) e as duas `useMutation` (linhas ~117 e ~147). Manter `enviadoAtacadoRef`/`enviadoVarejoRef`/`markupCanalIntocado` (ainda usados pela base congelada do Salvar). Se ainda forem referenciadas em `RevendaSetores` por desestruturação, tirar da desestruturação lá.

- [ ] **Step 3: Verificação — build + tsc + unit**

```bash
npx tsc --noEmit 2>&1 | grep -E "TS[0-9]" | head
npm run build 2>&1 | tail -3
npx vitest run tests/unit/revenda-salvar.test.ts tests/unit/revenda-setores-sem-onblur.test.tsx --no-file-parallelism 2>&1 | tail -8
```
Expected: tsc 0 erros, build OK, testes passam.

- [ ] **Step 4: Commit**

```bash
git add src/components/planejamento/planejamento-detail/useRevendaPlanejamento.ts src/components/planejamento/planejamento-detail/RevendaSetores.tsx
git commit -m "chore(camada): remove mutations onBlur orfas do useRevendaPlanejamento"
```

(Se as mutations NÃO estiverem órfãs, pular Steps 2/4 e só rodar o Step 3 de verificação.)

---

## QA no navegador (:5190, após as 4 tasks)

Numa loja com produto de revenda (ex.: Loja Teste): abrir o card no Planejamento → editar markup atacado → sair do campo → confirmar que NÃO gravou (selo "alterações não salvas" acende) → Descartar volta ao servidor → editar de novo e Salvar → preço recomputado. Repetir com preço fixo. Numa loja com a Integração travando o varejo: confirmar que varejo fica read-only e o Salvar não tenta gravá-lo. Importado e manufaturado seguem salvando igual.
