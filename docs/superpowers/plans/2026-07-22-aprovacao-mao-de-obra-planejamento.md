# Aprovação de mão de obra no Planejamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) ou superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Consolidar a aprovação do custo de serviços numa única aprovação por modelo, feita no card do Planejamento de Produto, separando materiais de mão de obra (previsto→real) e integrando ao gate de lançar + kanban.

**Architecture:** Novo flag `modelos.custo_terceirizados_aprovado` (fonte única). O card do Planejamento aprova/reprova; a bolinha e o gate de lançar passam a usar o flag; a RPC de custo devolve o componente de mão de obra (prev+real); a condição kanban `servico_aprovado` é repontada pro flag; o checkbox por-bloco do Serviços sai.

**Tech Stack:** Vite+React+TS, TanStack Query, Supabase (Postgres+RLS+RPC), Vitest (unit + integração transacional via psql).

## Global Constraints

- Migration por arquivo em `supabase/migrations/` + aplicar com `psql "$(cat /tmp/dburl.txt)" -f <arq>`. Migration destrutiva → `BEGIN;…COMMIT;` + guards idempotentes.
- RPC DEFINER: padrão wrapper+`_core` com `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (invariante #9). Ao alterar função, diff-validar `pg_get_functiondef` antes/depois.
- Antes de commit: `npm run build` + `npx tsc --noEmit 2>&1 | grep TS2304`. Rótulo "Lançamento" = ordinal (não mexer). types.ts está atrasado → usar `as any` p/ colunas novas.
- Ao mexer no kanban: catálogo TS + branch RPC + teste anti-drift verde + atualizar CLAUDE.md/memória.
- `nome` do flag: `custo_terceirizados_aprovado` (boolean, default false = reprovado, 2 estados).

---

### Task 1: Migration — coluna `custo_terceirizados_aprovado`

**Files:**
- Create: `supabase/migrations/20260722120000_mao_obra_aprovada.sql`

**Interfaces:**
- Produces: coluna `modelos.custo_terceirizados_aprovado boolean not null default false`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Aprovação (por modelo) do custo de mão de obra / serviços previstos.
-- 2 estados: true=aprovado, false=reprovado (default). Substitui a aprovação
-- por-bloco (producao_terceirizados.aprovado), que vira órfã.
ALTER TABLE public.modelos
  ADD COLUMN IF NOT EXISTS custo_terceirizados_aprovado boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Aplicar + verificar**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260722120000_mao_obra_aprovada.sql && psql "$(cat /tmp/dburl.txt)" -tA -c "select column_name from information_schema.columns where table_name='modelos' and column_name='custo_terceirizados_aprovado';"`
Expected: `custo_terceirizados_aprovado`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260722120000_mao_obra_aprovada.sql
git commit -m "feat(db): coluna modelos.custo_terceirizados_aprovado (aprovação mão de obra)"
```

---

### Task 2: RPC `custo_unitario_modelos` — devolver mão de obra prev+real

**Files:**
- Create: `supabase/migrations/20260722120500_custo_unit_mao_obra.sql` (CREATE OR REPLACE da função)

**Interfaces:**
- Produces: cada valor do jsonb ganha `mao_obra_previsto` (= `m.custo_terceirizados_previsto`) e `mao_obra_real` (= `servico_total/grade`, o mesmo já computado no ramo `real`). `previsto`/`real` totais inalterados.

- [ ] **Step 1: Capturar a def atual (diff-validate baseline)**

Run: `psql "$(cat /tmp/dburl.txt)" -tA -c "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='custo_unitario_modelos';" > /tmp/custo_before.sql`

- [ ] **Step 2: Migration — CREATE OR REPLACE adicionando as 2 chaves**

No `jsonb_build_object(m.id::text, jsonb_build_object( … ))`, adicionar duas chaves ao objeto interno, reusando os CTEs `materials`/`servico_total`/`grade` já existentes:

```sql
-- ... dentro do jsonb_build_object por modelo, junto de 'previsto'/'real':
'mao_obra_previsto', coalesce(m.custo_terceirizados_previsto, 0),
'mao_obra_real', coalesce(case when grade > 0 then servico_total / grade else 0 end, 0),
```

Copiar o corpo de `/tmp/custo_before.sql`, inserir as 2 chaves, salvar como a migration. Manter assinatura/segurança idênticas (mesmo REVOKE/GRANT).

- [ ] **Step 3: Aplicar + diff-validar**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260722120500_custo_unit_mao_obra.sql`
Run: `psql "$(cat /tmp/dburl.txt)" -tA -c "select (custo_unitario_modelos(array[(select id from modelos limit 1)]))::text;" | grep -o "mao_obra_previsto"`
Expected: `mao_obra_previsto`

- [ ] **Step 4: Teste transacional (integração)**

Adicionar em `tests/integration/` um teste que chama a RPC p/ um modelo semeado e afirma que `previsto = materiais + mao_obra_previsto` (dentro de tolerância). (Seguir o padrão de `tests/integration/*.test.ts` com BEGIN/ROLLBACK.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260722120500_custo_unit_mao_obra.sql tests/integration/*.test.ts
git commit -m "feat(db): custo_unitario_modelos devolve mão de obra prev+real"
```

---

### Task 3: Kanban — repontar `servico_aprovado` p/ o flag

**Files:**
- Modify: `src/lib/kanban-condicoes.ts:70` (label/descrição)
- Create: `supabase/migrations/20260722121000_kanban_mao_obra.sql` (CREATE OR REPLACE de `avaliar_condicoes_kanban`)
- Test: `tests/unit/kanban-condicoes.test.ts` (anti-drift; já existe)

**Interfaces:**
- Consumes: `modelos.custo_terceirizados_aprovado` (Task 1).
- Produces: condição `servico_aprovado` agora = `custo_terceirizados_aprovado = true`.

- [ ] **Step 1: Catálogo — relabel**

Em `src/lib/kanban-condicoes.ts` linha 70:
```ts
  { key: "servico_aprovado", label: "Mão de obra aprovada", modulo: "servicos" },
```

- [ ] **Step 2: Migration — trocar o branch `servico_aprovado`**

Capturar a def (`/tmp/kanban_before.sql`), e no branch `'servico_aprovado', ( … )` substituir a subquery de `producao_terceirizados` por:
```sql
'servico_aprovado', coalesce(m.custo_terceirizados_aprovado, false),
```
(onde `m` é a linha de `modelos` no laço da função). Manter as demais chaves iguais.

- [ ] **Step 3: Aplicar + anti-drift**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260722121000_kanban_mao_obra.sql`
Run: `npx vitest run tests/unit/kanban-condicoes.test.ts`
Expected: PASS (chaves catálogo ↔ RPC batem)

- [ ] **Step 4: Commit**

```bash
git add src/lib/kanban-condicoes.ts supabase/migrations/20260722121000_kanban_mao_obra.sql
git commit -m "feat(kanban): servico_aprovado agora = mão de obra aprovada (flag do modelo)"
```

---

### Task 4: RPC `lancar_modelo` — gate = CQ liberado E mão de obra aprovada

**Files:**
- Create: `supabase/migrations/20260722121500_lancar_gate_mao_obra.sql`
- Test: `tests/integration/lancar-gate.test.ts`

**Interfaces:**
- Consumes: `custo_terceirizados_aprovado`, `_cq_liberado(cad_id)` (já existe).

- [ ] **Step 1: Capturar def + localizar o check de serviço**

Run: `psql "$(cat /tmp/dburl.txt)" -tA -c "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='lancar_modelo';" > /tmp/lancar_before.sql`

- [ ] **Step 2: Migration — trocar a validação de serviço aprovado**

Onde a função valida "valor de serviço aprovado" (via producao_terceirizados/`servico_aprovacao`), substituir por:
```sql
if not coalesce((select custo_terceirizados_aprovado from modelos where id = _modelo_id), false) then
  raise exception 'Mão de obra não aprovada';
end if;
```
Manter o check de CQ liberado (`_cq_liberado`) como está.

- [ ] **Step 3: Aplicar + teste transacional RED→GREEN**

Teste: semear modelo com CQ liberado + `custo_terceirizados_aprovado=false` → `lancar_modelo` RAISE; setar true → sucede. (BEGIN/ROLLBACK.)

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260722121500_lancar_gate_mao_obra.sql && npx vitest run tests/integration/lancar-gate.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260722121500_lancar_gate_mao_obra.sql tests/integration/lancar-gate.test.ts
git commit -m "feat(db): lancar_modelo exige CQ liberado E mão de obra aprovada"
```

---

### Task 5: Planejamento — card (custo split, ícones, bolinha, foguete, layout)

**Files:**
- Modify: `src/routes/_authenticated/criacao.planejamento.tsx` (query ~304; `custoMap`/`aprovacaoMap`; `lancStatusDe` ~365; `ModeloCard` ~809-889; mutation nova)

**Interfaces:**
- Consumes: RPC de custo (Task 2, chaves `mao_obra_previsto`/`mao_obra_real`), flag `custo_terceirizados_aprovado`.
- Produces: mutation `setMaoObraAprovado(modeloId, boolean)`.

- [ ] **Step 1: Query dos cards + custoMap**

Adicionar ao `.select(...)` (linha ~304): `custo_peca_previsto, custo_terceirizados_previsto, custo_terceirizados_aprovado, data_lancamento`. O `custoMap` (RPC) já traz agora `mao_obra_previsto`/`mao_obra_real`.

- [ ] **Step 2: Mutation aprovar/reprovar**

```tsx
const setMaoObra = useMutation({
  mutationFn: async ({ id, aprovado }: { id: string; aprovado: boolean }) => {
    const { error } = await supabase.from("modelos").update({ custo_terceirizados_aprovado: aprovado } as any).eq("id", id);
    if (error) throw error;
  },
  onSuccess: () => { qc.invalidateQueries({ queryKey: ["modelos-planejamento"] }); },
  onError: (e: any) => toast.error(mensagemErro(e, "Erro ao aprovar mão de obra")),
});
```

- [ ] **Step 3: `lancStatusDe` usa o flag**

Trocar `servicoOk` por `m.custo_terceirizados_aprovado === true` na condição de "pronto":
```tsx
const lancStatusDe = (m: Modelo): "lancado" | "pronto" | null => {
  if (m.lancado) return "lancado";
  return (cqLiberadoMap[m.id] && m.custo_terceirizados_aprovado) ? "pronto" : null;
};
```
(remover o uso de `aprovacaoMap` no gate; a bolinha passa a usar o flag — próximo passo.)

- [ ] **Step 4: `ModeloCard` — props novas + render**

Passar props: `custoMat` (materiais = total − mão de obra), `maoObra` (mão de obra prev/real conforme lancStatus), `maoObraAprovado` (flag), `dataLancamento`, `onAprovar/onReprovar`. Render (dentro do corpo cheio, linhas ~868-883):
```tsx
{/* Coleção | Subcoleção */}
<div className="grid grid-cols-2 gap-x-3 [&>span]:truncate text-xs text-muted-foreground">
  <span>{modelo.colecao ?? "—"}</span><span>{modelo.subcolecao || "—"}</span>
</div>
{/* Linha | Categoria | Markup */}
<div className="grid grid-cols-3 gap-x-3 [&>span]:truncate text-xs text-muted-foreground">
  <span>{linhaNome ?? "—"}</span><span>{categoriaNome ?? "—"}</span>
  <span>Markup: {markup != null ? Number(markup).toLocaleString("pt-BR",{maximumFractionDigits:2}) : "—"}</span>
</div>
<p className="text-xs text-muted-foreground truncate">{custoReal ? "Custo" : "Custo prev."}: {custoMat != null ? brl(custoMat) : "—"}</p>
<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
  <span className="truncate">Mão de obra{custoReal ? "" : " prev."}: {maoObra != null ? brl(maoObra) : "—"}</span>
  <button type="button" aria-label="Aprovar" onClick={(e) => { e.stopPropagation(); onAprovar(); }}
    className={`shrink-0 ${maoObraAprovado ? "text-emerald-600" : "text-muted-foreground/40 hover:text-emerald-600"}`}><Check className="h-3.5 w-3.5" /></button>
  <button type="button" aria-label="Reprovar" onClick={(e) => { e.stopPropagation(); onReprovar(); }}
    className={`shrink-0 ${!maoObraAprovado ? "text-red-600" : "text-muted-foreground/40 hover:text-red-600"}`}><X className="h-3.5 w-3.5" /></button>
</div>
```

- [ ] **Step 5: Bolinha (canto sup. direito) = flag**

Trocar a bolinha `aprovacao` (linha ~841) por: `${maoObraAprovado ? "bg-emerald-500" : "bg-red-500"}` com title "Mão de obra aprovada/reprovada".

- [ ] **Step 6: Foguete substitui o badge "Pronto/Lançado"**

Remover o badge de texto (linhas ~831-836). Na linha de lançamento da descrição:
```tsx
<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
  <span className="truncate">Lançamento: {dataLancamento ? fmtDataBR(dataLancamento) : "—"}</span>
  {lancStatus && <Rocket className={`h-3.5 w-3.5 shrink-0 ${lancStatus === "lancado" ? "text-emerald-600" : "text-amber-500"}`} />}
</div>
```
Import `Rocket` de lucide-react; `Check`, `X` idem; `fmtDataBR` já usado no projeto.

- [ ] **Step 7: build + tsc + conferência**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: build ✓, `0`

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/criacao.planejamento.tsx
git commit -m "feat(planejamento): card separa materiais/mão de obra + aprovar/reprovar + foguete"
```

---

### Task 6: Serviços — remover checkbox de aprovação

**Files:**
- Modify: `src/routes/_authenticated/producao.terceirizados.$modeloId.tsx` (remover `aprovacaoMut` ~598-606 + o Checkbox de aprovação no render)
- Modify: `src/routes/_authenticated/producao.terceirizados.index.tsx:184` (bolinha reflete o novo flag)

- [ ] **Step 1: Remover o checkbox + a mutation de aprovação no detalhe**

Remover a `<Checkbox>` que chama `aprovacaoMut` e a própria `aprovacaoMut`. Manter o resto (dados reais dos serviços seguem).

- [ ] **Step 2: Bolinha da lista reflete o flag**

Em `producao.terceirizados.index.tsx`: trocar a fonte de `aprovacao` (blocos) por `custo_terceirizados_aprovado` do modelo (adicionar à query ~41) → verde se true, vermelho se false.

- [ ] **Step 3: build + tsc + commit**

```bash
npm run build && git add src/routes/_authenticated/producao.terceirizados.\$modeloId.tsx src/routes/_authenticated/producao.terceirizados.index.tsx
git commit -m "feat(servicos): remove checkbox de aprovação (agora no Planejamento)"
```

---

### Task 7: Desenvolvimento — badge read-only

**Files:**
- Modify: `src/components/desenvolvimento/ModeloDetailPanel.tsx` (query `modelo`/resumo já traz colunas; passar flag ao bloco de custos) + `src/components/desenvolvimento/modelo-detail/ModeloCustos*.tsx` (badge ao lado de Serviços previstos)

- [ ] **Step 1: Badge**

Ao lado do campo de Serviços previstos (`custoTerceirizados`), renderizar:
```tsx
<span className={`ml-2 text-[11px] rounded px-1.5 py-0.5 ${modelo?.custo_terceirizados_aprovado ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
  {modelo?.custo_terceirizados_aprovado ? "Mão de obra aprovada" : "Mão de obra reprovada"}
</span>
```
(o `modelo` já vem de `select("*")`; usar `as any` p/ a coluna nova.)

- [ ] **Step 2: build + tsc + commit**

```bash
npm run build && git add src/components/desenvolvimento/
git commit -m "feat(desenvolvimento): badge read-only de mão de obra aprovada/reprovada"
```

---

### Task 8: Docs — CLAUDE.md + memória

**Files:**
- Modify: `plm-pcp/CLAUDE.md` (bloco kanban: `servico_aprovado` agora = mão de obra; invariante de launch gate: "CQ liberado E mão de obra aprovada")
- Modify/Create: memória do projeto (`memory/`) via docs-keeper

- [ ] **Step 1: Atualizar CLAUDE.md** (kanban `servico_aprovado` + gate de lançar).
- [ ] **Step 2: Escrever memória** do fluxo consolidado (fonte única `custo_terceirizados_aprovado`, aprovar no Planejamento, checkbox Serviços removido, gate lançar).
- [ ] **Step 3: Commit + push**

```bash
git add plm-pcp/CLAUDE.md && git commit -m "docs: mão de obra aprovada (kanban + gate de lançar)" && git push origin main
```

---

## Self-Review

- **Cobertura do spec:** migration (T1), RPC custo (T2), card+ícones+bolinha+foguete+layout+real (T5), Serviços checkbox (T6), gate lançar (T4), kanban (T3), Desenvolvimento badge (T7), docs (T8). ✔
- **Refinamento vs spec:** kanban REPONTA `servico_aprovado` (em vez de nova key `mao_obra_aprovada`) — evita órfão que travaria status. Permissão dos ícones = `producao_servico_aprovacao` (a mesma da aprovação de serviço, só que agora no Planejamento).
- **Ordem:** T1→T2/T3/T4 (banco) antes de T5/T6/T7 (front consomem o flag/RPC). T8 por último.
