# Lote de demandas front (19/nov) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quatro ajustes de front do Plan.Tecido/Grade — base de distribuição nasce 0 (auto só quando o total bate com o cadastro), sigla da cor na Grade do Sheet, filtro sticky no Plan.Tecido, e inserir OC manualmente no Modo Plano — todos zero-banco, para ir no mesmo deploy da navegação por teclado.

**Architecture:** 4 tarefas independentes. T1 muda a lógica pura de distribuição (`distribuicao-produto.ts`) + o dialog. T2 adiciona um helper de rótulo com sigla (só para a Grade do Dev, sem tocar a fonte única). T3 é CSS/layout (sticky). T4 reusa o mecanismo manual de vínculo de OC (`SlotOcHint`/`plan_tecido_set_slot_oc`) no Modo Plano.

**Tech Stack:** React + TypeScript + Vitest/happy-dom. Reusa `plan_tecido_set_slot_oc`, `loja_base_linha_ler`, `baseDaCor`, `SlotOcHint`.

**Spec:** `docs/superpowers/specs/2026-11-19-demandas-front-lote-design.md`

## Global Constraints

- **ZERO migration, ZERO banco** nas 4. Reusam RPCs/dados existentes.
- T2 (sigla): NÃO alterar `varianteLabel`/`labelVarianteRow`/`corApelidoLabel` em `src/lib/variante.ts` — adicionar helper SEPARADO. As demais telas de variante não mudam.
- T1 (base): a lógica de decisão é PURA em `src/lib/distribuicao-produto.ts`. "Total bate com o cadastro" = existe entrada em `config[String(total)]` (ou seja `baseDaCor(config, total)` não-vazio). Nasce 0 = `devePrePreencher` deixa de pré-preencher na abertura.
- Testes: padrão do projeto; teste de hook/DOM usa `act`+`createRoot`+`// @vitest-environment happy-dom`, NÃO `@testing-library/react`. Arquivo `.test.ts` (não .tsx — vitest.config só inclui `*.test.ts`).
- Após imports: `npx tsc --noEmit 2>&1 | grep TS2304`; `npm run build`.
- Commit paralelo sempre `git commit --only <arquivos>`.

## Review Focus

- **T1: total digitado == cadastro vs ≠** — bate aplica base, não-bate fica manual (começando de 0). Testado no T1.
- **T1: cor sem config no cadastro** — qualquer total → sempre manual (`baseDaCor` vazio). Testado no T1.
- **T1: cor já distribuída (salva)** — a mudança de "nasce 0" não pode reverter distribuição já salva (só afeta a abertura sem distribuição). Testado no T1.
- **T2: cor sem sigla** — label sai "AMARELO () - AMARELO (019)" (parênteses vazios), não quebra. Testado no T2.
- **T4: slot não salvo** — adicionar OC chama `onEnsureSaved` antes (FK do slot). Verificado no T4.

---

### Task 1: Base de distribuição nasce 0; auto só quando o total bate (demanda 3)

**Files:**
- Modify: `src/lib/distribuicao-produto.ts`
- Modify: `src/components/plan-tecido/DistribuirPorLojaDialog.tsx`
- Test: `tests/unit/distribuicao-base-nasce-zero.test.ts`

**Interfaces:**
- Consumes: `baseDaCor(config, qtd) → Record<loja,number>` (existe), `aplicarBaseConfig`, `definirBase`, `temDistribuicao`, tipo `BaseConfigLinha`, `Distribuicao` (todos de `distribuicao-produto.ts`).
- Produces: `function baseAutoSeCasa(config: BaseConfigLinha | null | undefined, total: number): Record<string, number> | null` — devolve a base por loja SE `config` tem entrada para `total` (total bate); senão `null` (fica manual). E `devePrePreencher` passa a devolver `false` sempre (nasce 0) — OU é removido do fluxo de abertura (ver step 3).

- [ ] **Step 1: Write the failing test** (`tests/unit/distribuicao-base-nasce-zero.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { baseAutoSeCasa, type BaseConfigLinha } from "@/lib/distribuicao-produto";

// Config de Cadastro>Lojas: para a qtd 96, a base é E-commerce 60 + Física 36 (soma 96).
const config: BaseConfigLinha = { "96": { ecom: 60, fisica: 36 }, "48": { ecom: 30, fisica: 18 } };

describe("baseAutoSeCasa", () => {
  it("total digitado BATE com o cadastro → devolve a base por loja", () => {
    expect(baseAutoSeCasa(config, 96)).toEqual({ ecom: 60, fisica: 36 });
  });
  it("outro total cadastrado também bate", () => {
    expect(baseAutoSeCasa(config, 48)).toEqual({ ecom: 30, fisica: 18 });
  });
  it("total NÃO cadastrado → null (fica manual)", () => {
    expect(baseAutoSeCasa(config, 100)).toBeNull();
  });
  it("cor sem config nenhum → null (manual)", () => {
    expect(baseAutoSeCasa(null, 96)).toBeNull();
    expect(baseAutoSeCasa({}, 96)).toBeNull();
  });
  it("total 0 → null (não aplica base)", () => {
    expect(baseAutoSeCasa(config, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/distribuicao-base-nasce-zero.test.ts`
Expected: FAIL — `baseAutoSeCasa` não exportado.

- [ ] **Step 3: Write minimal implementation**

Em `src/lib/distribuicao-produto.ts`, acrescentar:

```ts
/** Demanda 3 (19/nov): a base por loja só é aplicada automaticamente quando o total digitado da cor
 *  COINCIDE com um total cadastrado em Cadastro>Lojas (`config` tem a chave daquele total). Senão,
 *  devolve null e a distribuição fica manual (o usuário reparte à mão, começando de 0). PURA. */
export function baseAutoSeCasa(config: BaseConfigLinha | null | undefined, total: number): Record<string, number> | null {
  const t = Math.round(Number(total) || 0);
  if (t <= 0) return null;
  const base = baseDaCor(config, t);           // {} quando não há entrada para `t`
  return Object.keys(base).length > 0 ? base : null;
}
```

E o pré-preenchimento na ABERTURA deixa de acontecer: no `DistribuirPorLojaDialog.tsx`, onde hoje usa `devePrePreencher` + `aplicarConfigPorCor` para semear a base ao abrir, REMOVER esse semeio inicial (a célula nasce 0 / sem distribuição). Preservar o congelamento de cor JÁ distribuída (salva) — só não semear as cores sem distribuição. (Não mudar `devePrePreencher`/`aplicarConfigPorCor` em si, para não afetar o "↺ recalcular pela config", que é ação explícita do usuário e deve continuar.)

No `DistribuirPorLojaDialog.tsx`, no handler que recebe o TOTAL digitado de uma cor (o input de quantidade da cor), chamar:

```ts
// ao digitar/confirmar o total de uma cor:
const auto = baseAutoSeCasa(baseConfig, totalDigitado);
if (auto) {
  // total bate com o cadastro → aplica a base por loja automaticamente
  setDists((prev) => ({ ...prev, [corKey]: aplicarBaseConfig(prev[corKey] ?? {}, auto, lojasIds, prop, tamanhos, grade) }));
}
// se auto === null: não mexe — fica manual (base 0, usuário distribui à mão)
```

(Confirmar no arquivo os nomes reais: `baseConfig` da query `loja-base-linha`, `setDists`/estado das distribuições, `lojasIds`, `prop`, `tamanhos`, `grade`, e o ponto onde o total da cor é editado.)

- [ ] **Step 4: Run test + build**

Run: `npx vitest run tests/unit/distribuicao-base-nasce-zero.test.ts` → PASS.
Run: `npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`; `npm run build` → OK.

- [ ] **Step 5: Commit**

```bash
git commit --only src/lib/distribuicao-produto.ts src/components/plan-tecido/DistribuirPorLojaDialog.tsx tests/unit/distribuicao-base-nasce-zero.test.ts -m "feat(plan-tecido): base de distribuição nasce 0; auto só quando o total bate com o cadastro (Cadastro>Lojas)"
```

- [ ] **Step 6: QA (prévia) — registrar no relatório**

Abrir "Distribuir por loja" num produto: a base nasce 0; digitar o total cadastrado (ex. 96) → reparte automático pelas lojas; digitar um total diferente (ex. 100) → fica manual (0, usuário distribui); cor sem cadastro → sempre manual. Cor já distribuída antes não é zerada.

---

### Task 2: Sigla da cor na Grade do Sheet (demanda 4)

**Files:**
- Modify: `src/lib/variante.ts` (helper NOVO, sem tocar os existentes)
- Modify: `src/components/desenvolvimento/ModeloDetailPanel.tsx` (query `tecido1VariantesLabels` traz sigla + usa o helper)
- Test: `tests/unit/variante-sigla.test.ts`

**Interfaces:**
- Produces: `function labelVarianteComSigla(p: { nome?: string|null; cor?: string|null; corSigla?: string|null; apelido?: string|null; apelidoSigla?: string|null }): string` — monta "NOME - COR (SIGLA) - APELIDO (SIGLA)", pondo `(SIGLA)` após cada cor presente; sigla ausente/vazia → `()`. Partes de cor vazias são omitidas (como `varianteLabel`).

- [ ] **Step 1: Write the failing test** (`tests/unit/variante-sigla.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { labelVarianteComSigla } from "@/lib/variante";

describe("labelVarianteComSigla", () => {
  it("cor base e apelido com sigla", () => {
    expect(labelVarianteComSigla({ cor: "AMARELO", corSigla: "AM", apelido: "AMARELO", apelidoSigla: "019" }))
      .toBe("AMARELO (AM) - AMARELO (019)");
  });
  it("cor sem sigla → parênteses vazios", () => {
    expect(labelVarianteComSigla({ cor: "AMARELO", corSigla: null, apelido: "AMARELO", apelidoSigla: "019" }))
      .toBe("AMARELO () - AMARELO (019)");
  });
  it("sem apelido → só a cor base com sigla", () => {
    expect(labelVarianteComSigla({ cor: "PRETO", corSigla: "PT" })).toBe("PRETO (PT)");
  });
  it("com nome de variante na frente", () => {
    expect(labelVarianteComSigla({ nome: "Tec1", cor: "PRETO", corSigla: "PT" })).toBe("Tec1 - PRETO (PT)");
  });
  it("apelido sem sigla → ()", () => {
    expect(labelVarianteComSigla({ cor: "AZUL", corSigla: "AZ", apelido: "MARINHO", apelidoSigla: "" }))
      .toBe("AZUL (AZ) - MARINHO ()");
  });
  it("sem cor nenhuma → '—'", () => {
    expect(labelVarianteComSigla({})).toBe("—");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/variante-sigla.test.ts`
Expected: FAIL — `labelVarianteComSigla` não exportado.

- [ ] **Step 3: Write minimal implementation** (acrescentar a `src/lib/variante.ts`, sem alterar o resto)

```ts
/** Demanda 4 (19/nov): rótulo de variante com a SIGLA de cada cor entre parênteses, para a seção
 *  Grade do Sheet. "NOME - COR (SIGLA) - APELIDO (SIGLA)". Sigla ausente/vazia → "()". Helper
 *  SEPARADO — NÃO substitui varianteLabel/labelVarianteRow (fonte única de outras telas). */
export function labelVarianteComSigla(p: {
  nome?: string | null; cor?: string | null; corSigla?: string | null;
  apelido?: string | null; apelidoSigla?: string | null;
}): string {
  const comSigla = (texto?: string | null, sigla?: string | null) => {
    const t = (texto ?? "").trim();
    if (!t) return "";
    return `${t} (${(sigla ?? "").trim()})`;
  };
  const partes = [(p.nome ?? "").trim(), comSigla(p.cor, p.corSigla), comSigla(p.apelido, p.apelidoSigla)]
    .filter(Boolean);
  return partes.length ? partes.join(" - ") : "—";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/variante-sigla.test.ts` → PASS.

- [ ] **Step 5: Ligar no ModeloDetailPanel (a query `tecido1VariantesLabels`)**

Em `src/components/desenvolvimento/ModeloDetailPanel.tsx`, a query `tecido1VariantesLabels` (~linha 1521) que monta o label de cada variante: acrescentar a `sigla` da cor base e do apelido ao embed/select (as variantes de tecido têm `cor:cor_id(nome, sigla)` e `apelido:cor_apelido_id(nome, sigla)` — confirmar o nome da coluna de sigla em `cores`/`cores_apelido`), e montar o label com `labelVarianteComSigla({ nome, cor, corSigla, apelido, apelidoSigla })` em vez do rótulo atual. NÃO mudar outras queries/telas.

- [ ] **Step 6: Type-check + build + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"; npm run build
git commit --only src/lib/variante.ts src/components/desenvolvimento/ModeloDetailPanel.tsx tests/unit/variante-sigla.test.ts -m "feat(grade): variante com sigla da cor na Grade do Sheet (helper próprio; fonte única intocada)"
```

- [ ] **Step 7: QA (prévia)** — abrir o Sheet, seção Grade: cada variante aparece "COR (SIGLA) - APELIDO (SIGLA)"; cor sem sigla mostra "()"; outras telas de variante inalteradas.

---

### Task 3: Filtro sticky no Plan.Tecido (demanda 2)

**Files:**
- Modify: `src/routes/_authenticated/criacao.plan-tecido.tsx`

**Interfaces:** nenhuma (CSS/layout).

- [ ] **Step 1: Localizar o container de filtros**

`grep -n "filtro\|Filtro\|sticky\|top-0\|header" src/routes/_authenticated/criacao.plan-tecido.tsx` — achar o bloco que contém os controles de filtro e o header sticky já existente (há um `header sticky` citado em comentário ~:126).

- [ ] **Step 2: Tornar o container de filtros sticky**

Envolver/ajustar o container dos filtros com `className="sticky z-20 bg-background"` e um `top` que fique ABAIXO do header sticky já existente (se o header é `top-0`, o filtro usa `top-[<altura do header>]` ou ambos num mesmo wrapper sticky). Garantir `bg-background` (senão o conteúdo aparece por trás ao rolar) e z-index acima da lista mas abaixo de modais (z-50) e barras (z-40) — usar `z-20`/`z-30`. Respeitar `env(safe-area)` se o header já respeita. NÃO quebrar o scroll da lista (o sticky é no filtro, não num ancestral com `overflow` que anule o sticky).

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`; `npm run build` → OK.

- [ ] **Step 4: Commit**

```bash
git commit --only src/routes/_authenticated/criacao.plan-tecido.tsx -m "feat(plan-tecido): header de filtros fixo (sticky) ao rolar"
```

- [ ] **Step 5: QA (prévia) — desktop e mobile**

Rolar a página do Plan.Tecido: os filtros ficam fixos e usáveis; não cobrem o conteúdo nem brigam com o header; no mobile (<md) idem; sem scroll horizontal novo.

---

### Task 4: Inserir OC manualmente no Modo Plano (demanda 1)

**Files:**
- Modify: `src/components/plan-tecido/ModoPlanoView.tsx`

**Interfaces:**
- Consumes: `SlotOcHint` (`src/components/plan-tecido/SlotOcHint.tsx`) — props `{ colecaoId, slotId, ocsAplicadas, selected, categoriaLane?, slotArtigos?, onEnsureSaved? }`, grava por `plan_tecido_set_slot_oc`. O Modo Plano já tem `itens` (com `slot` por produto), `colecaoId`/coleção, e recebe (ou pode receber) `ocsAplicadas`/`onEnsureSaved` do pai (confirmar no `PlanTecidoSheet.tsx` o que já é passado ao `ModoPlanoView`).

- [ ] **Step 1: Confirmar o que o Modo Plano já tem**

`grep -n "ocsAplicadas\|onEnsureSaved\|colecaoId\|slotOcMap\|selected\|SlotOcHint\|itens" src/components/plan-tecido/ModoPlanoView.tsx` e no `PlanTecidoSheet.tsx` ver o que é passado ao `ModoPlanoView`. Se `ocsAplicadas`/`onEnsureSaved` ainda não chegam ao Modo Plano, passá-los do pai (o `ModelCard` do modo não-plano já os recebe — mesma origem).

- [ ] **Step 2: Expor o "adicionar OC" por produto no Modo Plano**

Onde o Modo Plano mostra "OCs vinculadas" de um produto/slot (a seção `ocsDoGrupo`/por card), adicionar o `SlotOcHint` daquele slot — exatamente como o `ModelCard` faz (`<SlotOcHint colecaoId={colecaoId} slotId={slot.id} ocsAplicadas={ocsAplicadas} selected={slotOcIds} categoriaLane={slot.categoria_tecido_id} slotArtigos={artigosDoSlot} onEnsureSaved={onEnsureSaved} />`). O `selected` é o conjunto de `oc_ids` já vinculados àquele slot (`slotOcMap[slot.id]`). Isso dá o mesmo picker de adicionar OC manual do modo não-plano.

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"`; `npm run build` → OK.

- [ ] **Step 4: Commit**

```bash
git commit --only src/components/plan-tecido/ModoPlanoView.tsx -m "feat(plan-tecido): inserir OC manualmente no Modo Plano (reusa SlotOcHint, como no modo normal)"
```

- [ ] **Step 5: QA (prévia)**

No Modo Plano, num produto: aparece a opção de adicionar OC (igual ao modo normal); adicionar vincula a OC ao slot (RPC `plan_tecido_set_slot_oc`), ela passa a aparecer nas OCs vinculadas; se o slot não estava salvo, o `onEnsureSaved` salva antes; a prévia/resumo reage.

---

## Notas de execução (subagentes)

- **Ordem:** T1, T2, T3, T4 são INDEPENDENTES (arquivos diferentes). Podem ser seriais na ordem dada; NÃO paralelizar (compartilham o index do git). T1 e T2 têm testes unitários; T3 e T4 são integração/UI (QA na prévia).
- **Modelo:** todas Sonnet (código no plano / escopo claro). T2 e T4 tocam arquivos grandes (ModeloDetailPanel, ModoPlanoView) — atenção, mas mudança localizada. **Haiku proibido** (feedback do dono).
- **Revisão final (whole-branch):** Opus — focada em (T2) `varianteLabel` global intocado; (T1) cor já distribuída não é zerada + "total bate" correto; (T4) `onEnsureSaved` antes do vínculo; (T3) sticky não quebra scroll/mobile.
- Front puro — brief diz "ZERO migration, não tocar supabase/".
- Esta branch (`feature/plan-tecido-a1`) já tem a navegação por teclado; estas 4 vão JUNTAS no mesmo deploy (só site).
