# Casar variantes — Fatia 2B (consumo/necessidade no FRONT pela grade do par) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** Corrigir o "consumo total"/necessidade de tecido calculado no FRONT-END: quando uma variante de bloco complementar (Tecido 2/3, Forro, Entretela) está CASADA com variantes do Tecido 1, o consumo usa a Σ das grades das cores casadas (via `complementa_variante_ids`), não a grade da própria posição. Espelha a correção do banco (Fatia 2 Task 1, helper `_grade_soma_pares`). Bloco SEM casamento = grade da posição (como hoje). SEM ceil.

**Bug (Blusa Teste v5):** entretela off white casada com Tempestade de Areia (grade 60) mostrava consumo 120 (grade da ordem 1) — deveria ser 60. Causa: os cálculos de front usam `gradeTotalByPos(ordem)` posicional, ignorando o casamento.

**Escopo (decisão do dono):** SÓ os 3 sites do Grupo A. **Plan. Tecido FICA COMO ESTÁ** (fora de escopo).

**Architecture:** um HELPER PURO compartilhado `gradeEfetivaPar(...)` em `src/lib` (com teste), espelhando `_grade_soma_pares`, usado nos 3 sites. Threadar `complementa_variante_ids` onde falta (CAD variante state).

**Tech Stack:** Vite+React+TS, Vitest.

## Global Constraints
- Helper PURO + teste unitário (`src/lib/...` + `tests/unit/...`). Sem drift entre os 3 sites.
- SEM ceil (fracionado). Bloco complementar sem casamento OU Tecido 1 = grade da posição (comportamento de hoje, byte-idêntico).
- `complementa_variante_ids` é `variante_tecido_id[]` do Tecido 1. Somar as grades das variantes do Tecido 1 casadas = para cada id, achar a `ordem` da variante do Tecido 1 (mapa `variante_tecido_id → ordem` do bloco Tecido 1), pegar `grade_total` daquela ordem, somar. Id órfão (variante do Tecido 1 removida) → não soma.
- `npm run build` NÃO roda tsc → `npx tsc --noEmit`. Teste: `npx vitest run --no-file-parallelism`. Anti-drift verde.
- NÃO tocar `_estoque_tecido_core`/banco (já feito na Fatia 2 Task 1). NÃO tocar Plan. Tecido.

---

### Task 1: Helper puro `gradeEfetivaPar` + teste

**Files:** Create `src/lib/casar-variantes-grade.ts`, `tests/unit/casar-variantes-grade.test.ts`

**Interfaces:** Produz:
```ts
// Grade efetiva (peças) de uma variante de bloco, considerando casamento.
// - Tecido 1 (isTecido1) ou sem casamento → grade da própria posição (gradePosicao).
// - Complementar casado → Σ grade_total das variantes do Tecido 1 casadas.
export function gradeEfetivaPar(args: {
  isTecido1: boolean;
  complementaIds: string[] | null | undefined;   // ids das variantes do Tecido 1 casadas (deste slot)
  gradePosicao: number;                            // grade_total da própria ordem (fallback/hoje)
  gradePorVarianteTecido1: Map<string, number>;    // variante_tecido_id (Tecido 1) → grade_total
}): number
```
Regra:
```ts
if (isTecido1) return gradePosicao;
const ids = (complementaIds ?? []).filter(Boolean);
if (ids.length === 0) return gradePosicao;   // complementar sem casamento = hoje
return ids.reduce((s, id) => s + (gradePorVarianteTecido1.get(id) ?? 0), 0);  // órfão → +0
```

- [ ] **Step 1:** Escrever o helper (puro, sem deps de React/Supabase).
- [ ] **Step 2:** Teste (`--no-file-parallelism` não necessário p/ unit puro): (a) Tecido 1 → gradePosicao; (b) complementar sem casamento (ids vazio/null) → gradePosicao; (c) complementar casado com 1 cor → grade dela; (d) casado com 2 cores → soma; (e) id órfão (não no mapa) → não soma (+0); (f) casado com cor de grade 0 → 0. Casos numéricos exatos (ex.: casado com Tempestade 60 → 60; casado com Tempestade 60 + Malha Tessa 120 → 180).
- [ ] **Step 3: Commit** `feat(dev): helper puro gradeEfetivaPar (consumo de tecido pelo par casado) + teste`

---

### Task 2: Card de Desenvolvimento — `need` da alocação de OC usa a grade do par

**Files:** `src/components/desenvolvimento/modelo-detail/ModeloTecidosSection.tsx`

**Interfaces:** Consome `gradeEfetivaPar`. O `need` (~:540) passa a usar a grade efetiva do par.

- [ ] **Step 1:** Construir, no `TecidoBlockEditor` (ou passado do pai), o mapa `gradePorVarianteTecido1: Map<variante_tecido_id, grade_total>` das variantes do Tecido 1. O pai (`ModeloTecidosSection`) já tem `blocoTecido1` + `tecido1Variantes` (id) + `grades`; derivar: para cada variante do Tecido 1 (por `ordem`), `map.set(variante_tecido_id, gradeTotalByPos(ordem))`. Passar ao editor como prop.
- [ ] **Step 2:** No `need` (~:540): trocar `gradeTotalByPos(i + 1)` por
  ```ts
  gradeEfetivaPar({
    isTecido1: block.tipo === "tecido" && block.numero === 1,
    complementaIds: complementaAt(i),          // já existe (array do slot)
    gradePosicao: gradeTotalByPos(i + 1),
    gradePorVarianteTecido1,
  })
  ```
  (o resto do `need` — consumo, loss, multAt — igual). Só o fator de grade muda.
- [ ] **Step 3:** `npx tsc --noEmit | grep -E 'TS2304|Tecidos'` = vazio; `npm run build`; anti-drift. QA :5173 (reusar vite do dono): abrir Blusa Teste v5 (loja Teste) → a entretela off white (casada com Tempestade de Areia grade 60) mostra consumo **60**, não 120. Variante não-casada = igual. Screenshot.
- [ ] **Step 4: Commit** `fix(dev): consumo de tecido complementar casado no card usa a grade do par (não a posição)`

---

### Task 3: Auto-cálculo do CAD (Metr. Planejada/Folhas) usa a grade do par — 2 arquivos

**Files:** `src/components/desenvolvimento/ModeloDetailPanel.tsx`, `src/routes/_authenticated/pcp.cad.$modeloId.tsx`

**Interfaces:** Consome `gradeEfetivaPar`. `metragem_planejada`/`quantidade_folhas` do CAD passam a usar a grade do par p/ variante complementar casada.

- [ ] **Step 1 — threadar `complementa_variante_ids` no CAD variante state.** Em `ModeloDetailPanel.tsx`, a query de `modelo_tecido_variantes` (~:417) já traz `complementa_variante_ids`; nos pontos que constroem `cadTecidosState[].variantes` (CadVarianteRow — procurar onde monta `{variante_tecido_id, ordem, multiplicador, ...}`, ~:1039/1072/1962), adicionar `complementa_variante_ids: v.complementa_variante_ids ?? null`. Atualizar o tipo `CadVarianteRow` (achar a def) p/ incluir o campo. Idem em `pcp.cad.$modeloId.tsx` (o `varFromModelo` já ganhou o campo no fix da Fatia 2 Task 2; confirmar que o auto-folhas o enxerga; a query :146 já seleciona).
- [ ] **Step 2 — mapa Tecido1 + aplicar no auto-folhas.** Nos DOIS arquivos, no `useEffect` de auto-folhas (`ModeloDetailPanel.tsx:1149-1175`, `pcp.cad:883-905`): construir `gradePorVarianteTecido1` (das variantes do Tecido 1: `variante_tecido_id → gradeTotalByNumeroDev(ordem)`; o bloco Tecido 1 está em `cadTecidosState`/`tecidos` como `tipo==='tecido' && numero===1`), e trocar `gradeTotalByNumeroDev(v.ordem)` (linha 1158 / `gradeTotalByNumero(v.ordem)` linha 892) por:
  ```ts
  gradeEfetivaPar({
    isTecido1: t.tipo === "tecido" && t.numero === 1,
    complementaIds: v.complementa_variante_ids,
    gradePosicao: gradeTotalByNumeroDev(v.ordem),   // (ou gradeTotalByNumero no pcp.cad)
    gradePorVarianteTecido1,
  }) * mult
  ```
  Resto do cálculo (`pecas`, `metragem_planejada`, folhas) igual.
- [ ] **Step 3:** `npx tsc --noEmit | grep -E 'TS2304|DetailPanel|cad'` = vazio; `npm run build`; `npx vitest run --no-file-parallelism` verde (4 pre-existentes ok); anti-drift. QA :5173: em Blusa Teste v5, na seção 4 CAD (auto-folhas ligado), a Metr. Planejada da entretela casada reflete grade 60 (não 120). (pcp.cad é rota redirecionada/inalcançável — verificar por identidade de código com o ModeloDetailPanel + tsc/build.) Screenshot.
- [ ] **Step 4: Commit** `fix(cad): auto-cálculo de folhas/metragem usa a grade do par p/ tecido complementar casado (Dev + pcp.cad)`

---

### Task 4: Fechamento
- [ ] **Step 1:** `tsc`=0; build; anti-drift; `npx vitest run --no-file-parallelism` (novo teste do helper verde + 4 pre-existentes). QA end-to-end na Blusa Teste v5: consumo do card + Metr. Planejada do CAD refletem a grade do par (entretela off white = 60). Modelo sem casamento = idêntico. Screenshots.
- [ ] **Step 2:** Review final (opus): helper puro espelha `_grade_soma_pares`; os 3 sites usam o helper (sem drift); complementar sem casamento e Tecido 1 byte-idênticos; SEM ceil; `complementa_variante_ids` threaded no CAD state; Plan. Tecido intocado. Atualizar memória + CLAUDE.md (nota: o consumo/metragem de front do par).

## Self-Review
**Spec coverage:** helper+teste (T1); need do card (T2); auto-folhas CAD ×2 (T3). **Fora:** Plan. Tecido (decisão do dono); ceil; banco (feito).
**Riscos:** (a) o CAD state não carrega `complementa_variante_ids` hoje — T3 Step 1 threda (senão o helper não vê o par no CAD); (b) drift entre os 3 sites — o helper puro centraliza; (c) mapa Tecido1 `variante_tecido_id→grade` tem que vir do bloco Tecido 1 do MESMO modelo; (d) zero regressão p/ não-casado — teste (e) + QA.
