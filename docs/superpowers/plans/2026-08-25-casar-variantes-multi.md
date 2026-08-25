# Casar variantes — Multi (N-pra-N) + tecidos substitutos — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** Evoluir o "Casar variantes com o Tecido 1" (Fatia 1) de **1-pra-1** para **multi (N-pra-N)**: uma variante de um bloco complementar (Tecido 2/3, Forro, Entretela) pode casar com VÁRIAS variantes do Tecido 1; e o pool de opções passa a incluir as variantes dos **tecidos substitutos** do Tecido 1 (não só o artigo principal). UX = **Direção A** (dropdown com checkboxes, popover agrupado principal/substituto; chips das selecionadas). Cardinalidade = **N-pra-N total** (sem trava: uma cor do Tecido 1 pode ter vários complementos; uma variante complementar casa com várias do Tecido 1).

**Architecture:** troca a coluna `modelo_tecido_variantes.complementa_variante_id uuid` (Fatia 1, ainda NÃO pushada) por **`complementa_variante_ids uuid[]`** (array de ids de variantes do Tecido 1). Como a Fatia 1 não foi pushada, a migração da Fatia 1 é AJUSTADA no lugar (ou uma migração nova troca a coluna) — decisão no T1. O jsonb do BOM passa `complementas` como array de arrays (paralelo a `variantes`; cada slot = array de uuids). O front vira multi-select. A grade lista todos os pares no rótulo. **Nada de abate/reserva muda** (continua Fatia 2, futura).

**Tech Stack:** Vite+React+TS, Supabase, shadcn (Checkbox/Popover/Select), Vitest.

## Global Constraints
- Migration via `psql -f`; `BEGIN;…COMMIT;`; CREATE OR REPLACE diff-validado; REVOKE restatado (invariante #9). **NÃO tocar** `_estoque_tecido_core`/reserva/abate.
- A Fatia 1 (commits `7cc26bb`, `7a394c0`, `4a51ab3`, `1114855`) NÃO foi pushada — pode-se reescrever/estender a coluna. Preferir: nova migração `20260825140000_casar_variantes_multi.sql` que faz `ALTER ... ADD COLUMN complementa_variante_ids uuid[]`, migra o singular→array (`complementa_variante_id` não-nulo vira `ARRAY[id]`), e DROPA a coluna singular; espelhar em `cad_tecido_variantes`; atualizar `_salvar_modelo_bom_core` (guard de tenant sobre TODOS os elementos dos arrays) + `_enviar_modelo_para_cad_core`. (Manter o singular como coluna morta seria confuso — dropar, já que nada externo depende.)
- `complementas` no jsonb: array POSICIONAL paralelo a `variantes`; cada elemento = **array de uuids** (`[]`/null quando não casa). O core itera `variantes` por v_idx e lê `t->'complementas'->(v_idx-1)` como array.
- Coluna nova fora do types.ts → `as any`. `tsc --noEmit | grep TS2304`, `npm run build`, anti-drift.
- UI: `Checkbox`/`Popover`/`Select` primitivos; rótulos visíveis; chips = padrão dos substitutos; sem hex/px cru.
- Pool de opções do dropdown de complemento = variantes do Tecido 1 do artigo PRINCIPAL **+ substitutos** (`artigoIdsExtra` do bloco Tecido 1), agrupadas por artigo, etiqueta "substituto" nas de artigo substituto, ordenadas alfabeticamente.

---

### Task 1: Migration — `complementa_variante_ids uuid[]` (troca o singular) + BOM/CAD gravam array

**Files:** Create `supabase/migrations/20260825140000_casar_variantes_multi.sql`

**Interfaces:** Produz `modelo_tecido_variantes.complementa_variante_ids uuid[]` + `cad_tecido_variantes.complementa_variante_ids uuid[]` (nullable, default NULL); dropa `complementa_variante_id`; `_salvar_modelo_bom_core` grava o array do jsonb (com guard de tenant por elemento); `_enviar_modelo_para_cad_core` espelha.

- [ ] **Step 1:** `BEGIN;` + em `modelo_tecido_variantes`: `ADD COLUMN IF NOT EXISTS complementa_variante_ids uuid[];` migrar dados (`UPDATE ... SET complementa_variante_ids = ARRAY[complementa_variante_id] WHERE complementa_variante_id IS NOT NULL;` — deve ser 0 linhas em prod, mas idempotente); `DROP COLUMN IF EXISTS complementa_variante_id;`. Idem `cad_tecido_variantes`. (Sem FK — array de uuid não referencia; a validação de tenant vive no `_core`.)
- [ ] **Step 2:** dump VIVO de `_salvar_modelo_bom_core`; CREATE OR REPLACE com SÓ o delta:
  - INSERT das variantes: `complementa_variante_id` → `complementa_variante_ids`, valor = `CASE WHEN jsonb_typeof(t->'complementas'->(v_idx-1))='array' THEN ARRAY(SELECT (e#>>'{}')::uuid FROM jsonb_array_elements(t->'complementas'->(v_idx-1)) e WHERE jsonb_typeof(e)<>'null') ELSE NULL END`.
  - GUARD de tenant: substituir o guard de `tt->'complementas'` (Fatia 1, que assumia escalares) por um que valida TODOS os elementos de TODOS os sub-arrays: `CROSS JOIN LATERAL jsonb_array_elements(tt->'complementas') cc CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cc)='array' THEN cc ELSE '[]'::jsonb END) ce WHERE ... NOT EXISTS (variantes_tecido do tenant)` → RAISE 42501. Diff-validar. Restatar REVOKE.
- [ ] **Step 3:** `_enviar_modelo_para_cad_core`: `mtv.complementa_variante_id` → `mtv.complementa_variante_ids` no INSERT...SELECT (a coluna do cad agora é array). Diff-validar.
- [ ] **Step 4:** Aplicar; diff-validar; ACLs preservadas; QA txn (rolled back): salvar BOM com `complementas:[null,["<var-t1-mesmo-tenant-A>","<var-t1-B>"],null]` → grava `{A,B}` na variante certa; cross-tenant no array → 42501; sem complementas → NULL.
- [ ] **Step 5: Commit** `feat(dev): complementa_variante_ids uuid[] (casar multi) + BOM/CAD gravam array (diff-validado)`

---

### Task 2: Front — modelo de dados multi + pool com substitutos

**Files:** `src/components/desenvolvimento/modelo-detail/types.ts`, `ModeloDetailPanel.tsx`, `ModeloTecidosSection.tsx`

**Interfaces:** `TecidoBlock.complementas: (string[] | null)[]` (por slot: array de ids do Tecido 1). Hidratação lê `complementa_variante_ids`. Pool do dropdown = variantes do Tecido 1 (principal + substitutos).

- [ ] **Step 1:** `types.ts`: `complementas` passa de `(string|null)[]` para `(string[] | null)[]`. `makeEmptyBlocks` → `Array(10).fill(null)`. `removerVarianteDoBloco`: splice mantém (array de arrays). `hideBlock`: `Array(10).fill(null)`.
- [ ] **Step 2:** `ModeloDetailPanel.tsx` hidratação (~loader): `complementas[ord] = Array.isArray(v.complementa_variante_ids) ? v.complementa_variante_ids : (v.complementa_variante_ids ?? null)`. Select da query: `complementa_variante_id` → `complementa_variante_ids`. Payload `tecidosPayload`: `complementas` = por slot, o array (`b.complementas?.[i] ?? null`); Tecido 1 → todos null. `updateBlockVariante` swap: `complementas[vIdx]=null` ao trocar.
- [ ] **Step 3:** `ModeloTecidosSection.tsx` — o PAI monta o **pool do Tecido 1 com substitutos**: `tecido1Variantes: { id; label; artigoNome; isSubstituto }[]` — pool = variantes de `[t1.artigo_id, ...t1.artigoIdsExtra]` que estão em `t1.variantes` OU (decisão: incluir TODAS as variantes desses artigos? Não — só as que o Tecido 1 usa? o dono quer "substitutos" como opção, mesmo que não estejam nos slots do Tecido 1). **Decisão a confirmar no início do T2:** o pool são as variantes que aparecem nos SLOTS do Tecido 1 (principal+substituto já escolhidos) — que é o conjunto real de cores do modelo. Ordenar alfabético; marcar `isSubstituto = artigoNome !== nome do artigo principal do bloco Tecido 1`.
- [ ] **Step 4:** UI multi (Direção A) no `TecidoBlockEditor`: por slot com variante, um `<Popover>` com trigger "N variantes selecionadas" + chips das selecionadas (com ×) + conteúdo agrupado por artigo (grupo "principal"/"substituto"), cada opção um `<Checkbox>` + label. Marcar/desmarcar edita `complementas[i]` (array). Checkbox "Casar variantes com o Tecido 1" = derivado de `complementas.some(a => a && a.length)`.
- [ ] **Step 5:** `tsc`/build/anti-drift/test. QA :5173: casar Off White com 3 cores do Tecido 1 (1 principal + 1 substituto) → salvar → reabrir → os 3 persistem.
- [ ] **Step 6: Commit** `feat(dev): casar variantes multi (N-pra-N) + pool inclui substitutos do Tecido 1 (UI + persiste)`

---

### Task 3: Front — grade lista TODOS os pares no rótulo

**Files:** `ModeloDetailPanel.tsx` (paresComplementares), `ModeloGradeSection.tsx`

- [ ] **Step 1:** `paresComplementares`: para cada slot complementar, expandir o ARRAY `complementas[i]` em N pares `{t1id, compVarId}` (um por elemento). Resto igual à Fatia 1.
- [ ] **Step 2:** `tecido1VariantesInfo.complemento`: já agrega todos os pares com `t1id===id` — com o array, um forro casado com 3 cores gera 3 pares (um por cor), cada cor do Tecido 1 recebe seu rótulo. Sem mudança estrutural além do expand no Step 1. Confirmar que múltiplos complementos por cor (N-pra-N) juntam com vírgula.
- [ ] **Step 3:** `tsc`/build/anti-drift. QA: grade mostra os rótulos certos com o multi.
- [ ] **Step 4: Commit** `feat(dev): grade reflete casamento multi no rótulo`

---

### Task 4: Fechamento
- [ ] **Step 1:** `tsc`=0; build; anti-drift; test. QA fluxo completo multi + substitutos. Confirmar ZERO mudança em abate/estoque/reserva; nenhuma migração de estoque nova.
- [ ] **Step 2:** Review final (opus): coluna array migrada limpo (singular dropado, dados migrados); BOM+CAD gravam/espelham o array com guard de tenant por elemento; UI multi N-pra-N + pool com substitutos; grade lista todos os pares; ZERO abate. Caminho sem-casar (1 tecido) 100% igual.

## Self-Review
**Spec coverage:** multi N-pra-N (T1/T2); pool com substitutos (T2); grade com todos os pares (T3). **Fora (Fatia 2):** abate independente com arredondamento; pares na Ficha Técnica.
**Riscos:** (a) troca de coluna singular→array — como Fatia 1 não foi pushada, migrar+dropar é limpo, mas o guard de tenant tem que cobrir CADA elemento de CADA sub-array (senão reabre o furo do final review da Fatia 1); (b) o pool com substitutos — confirmar no T2 que "substituto" = variante de artigo ≠ principal do bloco Tecido 1; (c) N-pra-N sem trava = a mesma variante complementar pode aparecer em vários pares e uma cor do Tecido 1 em vários blocos — a grade tem que juntar sem duplicar rótulo idêntico.
