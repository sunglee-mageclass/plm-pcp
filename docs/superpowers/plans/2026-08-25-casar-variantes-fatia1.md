# Casar variantes de 2 tecidos — Fatia 1 (só UI + persistência do vínculo, SEM abate) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** No Desenvolvimento, o bloco de um tecido COMPLEMENTAR (Tecido 2/B, forro, etc.) pode ser marcado como "complementa o Tecido 1", e cada variante dele é ligada (dropdown) a uma variante do Tecido 1. O vínculo é PERSISTIDO. A grade continua a atual (do Tecido 1), só ganha no rótulo "casada com B·X". **NADA do cálculo de consumo/reserva/abate é tocado nesta fatia** (isso é a Fatia 2). Mockup aprovado: artifact `d911f600`.

**Architecture:** coluna nova `modelo_tecido_variantes.complementa_variante_id uuid` (nullable, FK→variantes_tecido, aponta pra variante do Tecido 1 que este slot complementa); a função que salva o BOM grava a coluna do jsonb; o front (bloco de tecido no Dev) ganha o checkbox "complementa Tecido 1" + os dropdowns por variante; a grade mostra o par no rótulo. **Aditivo e reversível** — nenhuma RPC de estoque muda.

**Tech Stack:** Vite+React+TS, Supabase, shadcn, Vitest.

## Global Constraints

- Migration via `psql -f`; `BEGIN;…COMMIT;`. A coluna é ADD COLUMN nullable (aditivo). A função que salva o BOM (`INSERT INTO modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)` — achar a função VIVA que faz isso: `salvar_modelo_bom` e/ou `_enviar_modelo_para_cad_core`, migration base `20260803190000`) é CREATE OR REPLACE diff-validado — SÓ acrescenta `complementa_variante_id` à lista de colunas e ao VALUES (do jsonb `t->'complementas'->>(v_idx-1)` ou equivalente). NADA mais.
- **NÃO tocar** `_estoque_tecido_core`, `reservar`, `baixar_estoque_tecido_corte`, nem a fórmula de consumo. Esta fatia é só o VÍNCULO + UI.
- Coluna nova fora do types.ts → `as any` na leitura. Antes de commit front: `tsc --noEmit | grep TS2304`, `npm run build`, anti-drift.
- Padrões: `<DateField>` n/a; sem hex/px cru; labels visíveis (rótulo por dropdown).
- O CAD espelha o BOM (`cad_tecido_variantes`) — a Fatia 1 propaga `complementa_variante_id` p/ o CAD? SIM, o espelho deve levar a coluna (senão perde ao Confirmar CAD). Adicionar a coluna em `cad_tecido_variantes` também + o copy no `_enviar_modelo_para_cad_core`. (Ainda SEM usar no abate.)

---

### Task 1: Migration — coluna `complementa_variante_id` + gravar no BOM e no espelho CAD

**Files:** Create `supabase/migrations/20260825120000_casar_variantes_fatia1.sql`

**Interfaces:** Produces colunas `modelo_tecido_variantes.complementa_variante_id uuid` + `cad_tecido_variantes.complementa_variante_id uuid` (nullable, FK→variantes_tecido ON DELETE SET NULL); a função de salvar BOM e a de espelho CAD gravam a coluna.

- [ ] **Step 1:** `BEGIN;` + `ALTER TABLE public.modelo_tecido_variantes ADD COLUMN IF NOT EXISTS complementa_variante_id uuid REFERENCES public.variantes_tecido(id) ON DELETE SET NULL;` + idem `cad_tecido_variantes`.
- [ ] **Step 2:** Descobrir a(s) função(ões) VIVA(s) que fazem `INSERT INTO modelo_tecido_variantes (...)` e `INSERT INTO cad_tecido_variantes (...)` (dump `pg_get_functiondef`; a base é `20260803190000` / `20260820160000`). Para CADA uma: CREATE OR REPLACE com o corpo VIVO + SÓ o delta: adicionar `complementa_variante_id` à lista de colunas do INSERT e `NULLIF(t->'complementas'->>(v_idx-1),'')::uuid` (ou o formato real do jsonb de variantes — CONFIRMAR como as variantes vêm no `_tecidos`/`_grades` jsonb: hoje `t->'variantes'` + `t->'multiplicadores'`; adicionar `t->'complementas'` paralelo). Diff-validar (só o delta). Restatar REVOKE se houver.
  - No espelho CAD (`_enviar_modelo_para_cad_core`): copiar `complementa_variante_id` de `modelo_tecido_variantes` → `cad_tecido_variantes` no INSERT...SELECT. Diff-validado.
- [ ] **Step 3:** Aplicar + diff-validar cada função (só as adições de `complementa_variante_id`). ACLs preservadas. QA SQL (txn/rollback): salvar um BOM com `complementas` no jsonb → a coluna grava; sem → NULL.
- [ ] **Step 4: Commit** `feat(dev): coluna complementa_variante_id (casar variantes) + grava no BOM e espelho CAD (diff-validado)`

---

### Task 2: Front — bloco de tecido ganha "complementa Tecido 1" + dropdowns por variante

**Files:** Modify `src/components/desenvolvimento/modelo-detail/ModeloTecidosSection.tsx` (+ types.ts, + o payload do salvar BOM no `ModeloDetailPanel.tsx`)

**Interfaces:** Consumes a coluna. Produces: no card de um bloco NÃO-Tecido-1 (tecido 2/3, forro), um checkbox "Complementa o Tecido 1 (casar variantes)"; quando ligado, cada variante do bloco ganha um `<Select>` "Complementa a variante A.x" (opções = variantes do Tecido 1). O vínculo entra no draft e no payload do salvar BOM.

- [ ] **Step 1:** Modelo de dados no front: cada variante do bloco (hoje um id + ordem + multiplicador) ganha `complementa_variante_id?: string | null`. Ler do BOM carregado (`as any`), incluir no draft.
- [ ] **Step 2:** UI no card do bloco — o checkbox "Complementa o Tecido 1" aparece em **QUALQUER bloco que NÃO seja o Tecido 1** (decisão do dono): Tecido 2, Tecido 3, forro E entretela. O Tecido 1 (tipo `tecido` numero `1`) é a âncora, NUNCA mostra o checkbox. Guardar o "casado" como derivado de "tem algum `complementa_variante_id` preenchido" OU um flag próprio por bloco (preferir derivado, pra não precisar de coluna a mais). Quando ligado, renderizar por variante do bloco um `<Select>` com as variantes do Tecido 1 (label via `varianteLabel`), gravando `complementa_variante_id`. Idioma: espelhar o `<Select>` de variante que já existe no bloco (`ModeloTecidosSection.tsx` ~:319).
- [ ] **Step 3:** Payload do salvar BOM: no `ModeloDetailPanel.tsx` onde monta o `_tecidos` jsonb (os `variantes`/`multiplicadores` por bloco), adicionar o array paralelo `complementas` (o `complementa_variante_id` por variante, ordem-alinhado). Confirmar o formato que a função da Task 1 lê.
- [ ] **Step 4:** `tsc --noEmit | grep -E 'TS2304|Tecidos|DetailPanel'`; `npm run build`; anti-drift. QA :5173: abrir um modelo com 2 tecidos → no bloco do 2º, marcar "complementa Tecido 1" → aparecem os dropdowns → casar B·X com A·Y → Salvar → reabrir → o vínculo persistiu.
- [ ] **Step 5: Commit** `feat(dev): bloco de tecido complementar casa variantes com o Tecido 1 (UI + persiste)`

---

### Task 3: Front — grade mostra "casada com B·X" no rótulo da variante

**Files:** Modify `src/components/desenvolvimento/ModeloDetailPanel.tsx` (o `tecido1VariantesInfo` que alimenta a grade) + `src/components/desenvolvimento/modelo-detail/ModeloGradeSection.tsx` (rótulo)

**Interfaces:** A grade continua a atual (do Tecido 1); no rótulo de cada variante, além de "Tecido · cor", mostra "· casada com {B · cor complementar}" quando houver um bloco complementar apontando pra essa variante do Tecido 1.

- [ ] **Step 1:** Em `ModeloDetailPanel.tsx`, ao montar `tecido1VariantesInfo` (a lista de variantes do Tecido 1 com label), derivar, para cada variante do Tecido 1, se ALGUM bloco complementar tem `complementa_variante_id` apontando pra ela → montar o label do complementar (`{nome do tecido B} · {cor da variante B}`). Passar como `complemento?: string` no `GradeVarianteInfo`.
- [ ] **Step 2:** `ModeloGradeSection.tsx`: no rótulo (onde já mostra `tecido · label`), acrescentar, se `complemento`, `· casada com {complemento}` (discreto, `text-muted-foreground`). NÃO mudar a estrutura da grade.
- [ ] **Step 3:** `tsc`; build; anti-drift. QA :5173: com o par casado (Task 2), a grade do Tecido 1 mostra "casada com B·X" no rótulo da variante. NENHUMA célula/cálculo muda.
- [ ] **Step 4: Commit** `feat(dev): grade mostra a variante complementar casada no rótulo`

---

### Task 4: Fechamento

- [ ] **Step 1:** `tsc`=0; build; anti-drift. QA visual do fluxo completo da Fatia 1 (casar → salvar → reabrir → grade mostra o par). Confirmar que NADA de estoque/reserva/abate mudou (grep: `_estoque_tecido_core` intocado; nenhuma migration de estoque nova).
- [ ] **Step 2:** Review final (opus): a coluna é aditiva/nullable; o BOM+CAD gravam e espelham o vínculo (diff-validado); a UI casa 1-1 e persiste; a grade só mostra o rótulo (estrutura/cálculo intocados); ZERO mudança no abate. Confirmar que o caminho "sem casar" (modelo de 1 tecido) fica 100% igual.

## Self-Review

**Spec coverage (só Fatia 1):** vínculo persistido (T1); UI de casar no bloco B (T2); rótulo do par na grade (T3). **Fora (Fatia 2):** grade-única-por-par de verdade, o ABATE independente com arredondamento, os pares na Ficha Técnica. **Fora sempre:** Caso 1 (continuação A.1→A.2).

**Placeholder scan:** T1 tem o método (achar as funções vivas, diff-validar); T2/T3 têm arquivo + a âncora (o `<Select>` de variante ~:319, o `tecido1VariantesInfo`). O formato exato do jsonb `_tecidos` (como `variantes`/`multiplicadores` vêm) o agente confirma lendo `ModeloDetailPanel` + a função.

**Type consistency:** `complementa_variante_id: uuid|null` idêntico em T1(2 tabelas)/T2(draft/payload)/T3(deriva o rótulo). `complemento?: string` no GradeVarianteInfo.

**Riscos:** (a) o jsonb do BOM — achar como as variantes/multiplicadores são serializados hoje e adicionar `complementas` paralelo (T1 Step 2/T2 Step 3 destacam); (b) espelho CAD tem que levar a coluna senão perde ao Confirmar CAD (T1 trata); (c) NÃO tocar estoque (o gate do fechamento confirma); (d) diff-validação das funções de BOM/CAD (grandes).
