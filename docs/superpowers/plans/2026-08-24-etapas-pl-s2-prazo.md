# Etapas PL — S2 (Prazo de Pagamento no Fornecedor) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Um campo "Prazo de Pagamento" (máscara "30/60/90") no cadastro do Fornecedor (empresa serviço), refletido na lista de fornecedores, e mostrado **no lugar de "Nº de parcelas"** no bloco PL do sheet do PCP (derivado da empresa selecionada, read-only).

**Architecture:** Nova coluna `empresas.prazo_pagamento text` (mesmo padrão free-text "30/60/90" das OCs); a RPC `set_empresa_categorias` (que grava colunas explícitas) passa a persistir o campo; o form/lista do cadastro ganham o campo/coluna; no bloco PL do sheet, o campo "Nº de parcelas" (NumberInput) é substituído por um display read-only de `empresaSel.prazo_pagamento`.

**Tech Stack:** Vite+React+TS, TanStack, Supabase, Tailwind+shadcn, Vitest.

## Global Constraints

- Migration em `supabase/migrations/`, aplicada via `psql "$(cat /tmp/dburl.txt)" -f <arq>` (regra 1). ⚠️ `/tmp/dburl.txt` pode não existir neste ambiente — se faltar, o executor deve OBTER a conexão do dono antes (não inventar); a migration é aditiva/não-destrutiva (ADD COLUMN) mas a RPC é CREATE OR REPLACE (diff-validar). Envolver em `BEGIN;…COMMIT;`.
- Ao alterar `set_empresa_categorias`: dump do def VIVO (`pg_get_functiondef`) como base, editar só o delta, diff-validar antes/depois (só as adições de `prazo_pagamento`).
- Máscara reusa o padrão das OCs: `prazo_pagamento` é **text livre** com placeholder "Ex: 30/60/90"; nº de parcelas é DERIVADO por split em `/[\/,-\s]+/` contando partes numéricas (ver `src/components/oc-tecido/OcTecidoForm.tsx:172-193`). NÃO criar enum.
- Front usa `as any` p/ a coluna nova (types.ts pendente). Antes de commit: `npx tsc --noEmit | grep TS2304`, `npm run build`, anti-drift.
- NÃO dropar `producao_terceirizados.numero_parcelas` (legado; S3 decide as parcelas pelo prazo). S2 só troca o DISPLAY no bloco.

---

### Task 1: Migration — `empresas.prazo_pagamento` + `set_empresa_categorias` grava o campo

**Files:**
- Create: `supabase/migrations/20260824120000_empresa_prazo_pagamento.sql`

**Interfaces:**
- Produces: coluna `empresas.prazo_pagamento text` (nullable); `set_empresa_categorias` persiste `nullif(_empresa->>'prazo_pagamento','')` no INSERT e UPDATE de `empresas`.

- [ ] **Step 1:** Dump do def VIVO: `psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public.set_empresa_categorias'::regprocedure);" > /tmp/sec_before.sql`.
- [ ] **Step 2:** Escrever a migration: `BEGIN;` + `ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS prazo_pagamento text;` + `CREATE OR REPLACE FUNCTION public.set_empresa_categorias(...)` com o corpo do def VIVO editado — adicionar `prazo_pagamento` à lista de colunas do INSERT (`..., prazo_pagamento`) e aos VALUES (`..., nullif(_empresa->>'prazo_pagamento','')`), e ao `SET` do UPDATE (`prazo_pagamento = nullif(_empresa->>'prazo_pagamento','')`). Nada mais. `COMMIT;`.
- [ ] **Step 3:** Aplicar + diff-validar: `psql -f`; dump AFTER; `diff /tmp/sec_before.sql /tmp/sec_after.sql` → só as 2 adições (INSERT col+value, UPDATE set) + confirmar a coluna (`select column_name from information_schema.columns where table_name='empresas' and column_name='prazo_pagamento';`).
- [ ] **Step 4: Commit** `git commit -m "feat(fornecedor): empresas.prazo_pagamento + set_empresa_categorias grava (diff-validado)"`

---

### Task 2: Fornecedor — campo no form + coluna na lista

**Files:**
- Modify: `src/routes/_authenticated/cadastro.servico.tsx`

**Interfaces:**
- Consumes: coluna da Task 1.
- Produces: o form de empresa serviço tem um Input "Prazo de Pagamento" (placeholder "Ex: 30/60/90"); a lista mostra a coluna "Prazo de Pgto".

- [ ] **Step 1:** Form — em `EmpresasMultiCatTab`: add `prazo_pagamento: ""` ao `emptyEmpresaForm` (`:1026-1041`); um `<div>` com `<Label>Prazo de Pagamento</Label>` + `<Input placeholder="Ex: 30/60/90" value={form.prazo_pagamento} onChange=...>` no dialog (~`:1533`, no grid do topo); incluir `prazo_pagamento: nullif...` no `_empresa` jsonb do `saveMut` (`:1239-1257`); add `prazo_pagamento` ao select do `openEdit` re-fetch (`:1192`) e ao objeto `next` (`:1201-1216`).
- [ ] **Step 2:** Lista — add `prazo_pagamento` ao select da query `["empresas-multi"]` (`:1075`); add ao type `EmpresaRow` (`:1016-1021`); `<TableHead>Prazo de Pgto</TableHead>` (`:1389-1401`) + `<TableCell>{row.prazo_pagamento ?? "—"}</TableCell>` (`:1404-1473`); **bumpar `colSpan`** de `isAdmin ? 5 : 4` → `isAdmin ? 6 : 5` nas linhas loading/empty (`:1407`,`:1414`).
- [ ] **Step 3:** `npx tsc --noEmit | grep -E 'TS2304|servico'`; `npm run build`; QA :5173 — editar um fornecedor serviço, pôr "30/60/90", salvar, ver na lista.
- [ ] **Step 4: Commit** `git commit -m "feat(fornecedor): campo Prazo de Pagamento no form + coluna na lista"`

---

### Task 3: Bloco PL — Prazo (do fornecedor) no lugar de "Nº de parcelas"

**Files:**
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx`

**Interfaces:**
- Consumes: `empresaSel` (já resolvido, `:1116`) + a coluna `prazo_pagamento`.
- Produces: no bloco PL, onde havia o NumberInput "Nº de parcelas", passa a mostrar **read-only** `empresaSel?.prazo_pagamento` (ou "—" sem empresa), rotulado "Prazo de Pagamento".

- [ ] **Step 1:** Add `prazo_pagamento` ao select da query `empresasServico` (`["empresas-servico-sel"]`, `:357-359`) — assim `empresaSel.prazo_pagamento` popula.
- [ ] **Step 2:** Substituir o campo `:1385-1398` (`!b.interno` guard): trocar o `<Label>Nº de parcelas</Label>` + `<NumberInput numero_parcelas>` por `<Label>Prazo de Pagamento</Label>` + um display read-only (mesmo estilo dos outros read-only do bloco, ex. Custo Total) mostrando `(empresaSel?.prazo_pagamento as string) || "—"` + um hint pequeno "(do fornecedor)". Manter `b.numero_parcelas` no estado/payload intacto (NÃO remover do type/load/save — só o DISPLAY muda; S3 usará o prazo).
- [ ] **Step 3:** `npx tsc --noEmit | grep -E 'TS2304|servicos'`; `npm run build`; anti-drift; QA :5173 — abrir um modelo com bloco PL, escolher uma empresa que tem prazo → o bloco mostra "Prazo de Pagamento: 30/60/90" no lugar de Nº de parcelas.
- [ ] **Step 4: Commit** `git commit -m "feat(pcp): bloco PL mostra Prazo (do fornecedor) no lugar de Nº de parcelas"`

---

## Self-Review

**Spec coverage:** prazo no fornecedor (form+lista) → T2; persistência → T1; substitui Nº de parcelas no bloco PL → T3. **Fora do S2:** as PARCELAS geradas pelo prazo (S3) — S2 só coloca o campo e o display.

**Placeholder scan:** T1 tem o método (dump+diff) e o delta exato; T2/T3 são UI com arquivo:linha exatos do mapeamento. Sem JSX linha-a-linha (depende do estado real dos arquivos), mas com âncoras precisas.

**Type consistency:** `prazo_pagamento` (text) idêntico em T1/T2/T3. `empresaSel` reusado (não recriar).

**Riscos:** (a) `/tmp/dburl.txt` pode faltar (Global Constraints trata); (b) o `colSpan` da lista tem que subir junto com a coluna (T2 Step 2 destaca); (c) não dropar `numero_parcelas` (S3 depende do conceito de parcela, agora guiado pelo prazo).
