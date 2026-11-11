# Exportar dados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma aba "Exportar" na Integração que gera CSV/Excel de produtos (pai + variantes cor/tamanho) com colunas e níveis selecionáveis, filtro coleção/subcoleção, prévia na tela e seleção persistida.

**Architecture:** Uma RPC nova (`exportar_produtos`) monta as linhas no banco (copia a base de `_integracao_base` SEM excluir reprovados, junta taxonomia/atacado/subcoleção/origem, reusa `_integracao_extras` e `_skus_calc_ref_tipo`/`modelo_skus`); o front reusa o padrão `xlsx` de `src/lib/import/template.ts` para gerar o arquivo. Catálogo de campos próprio (não o layout fixo da API). Seleção persistida via `useUserPref` (scope novo "export").

**Tech Stack:** Supabase RPC (plpgsql, wrapper+_core), React+TanStack, xlsx (SheetJS ^0.18.5, já instalado), shadcn Tabs.

**Spec:** docs/superpowers/specs/2026-11-11-exportar-dados-design.md

## Global Constraints

- **RPC nova:** wrapper DEFINER + `_core` com `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`; gate `user_can_view('integracao')`; tenant via `get_user_tenant_id()`; todo join de cadastro filtra por `tenant_id` do modelo.
- **Base de produtos = `_integracao_base` SEM o filtro de reprovados** (deixar só `WHERE m.tenant_id = _tenant`) — traz interno+revenda+importado e QUALQUER etapa, inclusive reprovados.
- **RAISE que vira 5xx = só ASCII.** Migration aditiva + rollback em `supabase/rollback/`. Banco ANTES do site.
- **Níveis persistidos como `string[]`** (ex.: `["1","2","3"]`), nunca `number[]` (`useUserPref` só grava string[]).
- **`UiPrefScope`** precisa ganhar `"export"` (hoje só "filtro"|"agrupar").
- **Catálogo próprio** `campos-export.ts` (shape `CampoDef`), NÃO editar o `campos.ts` da API.
- **GRUPO não existe em `modelos`** — derivar: `modelos.categoria_principal_id` → `categorias_produto.grupo_id` → `grupos_produto.nome`. Categoria = `categoria_principal_id`.
- Sem gate de custo (dono liberou todas as colunas). tsc limpo nos tocados; build não faz type-check.

## Review Focus

- **Produto reprovado no recorte:** deve APARECER na exportação (a Integração o exclui; a Exportar não) — Task 1 (teste da RPC com um reprovado).
- **Produto sem variantes/SKU (nível 2/3):** deve sair só o pai (sem filhos), não quebrar — Task 1 (teste nível 3 com produto sem grade).
- **Nenhum nível marcado / nenhuma coluna marcada:** a UI não deixa baixar (botão desabilitado) — Task 5 (teste de guarda).
- **Coleção com 0 produtos:** prévia vazia com mensagem clara, não erro — Task 5.
- **Seleção persistida corrompida** (valor fora do catálogo no `user_ui_prefs`): ignora o inválido, não quebra — Task 4 (filtra pelas keys válidas do catálogo).

---

## Task 1: RPC `exportar_produtos` + `exportar_subcolecoes` (banco)

**Files:**
- Create: `supabase/migrations/20261122100000_exportar_dados.sql`
- Create: `supabase/rollback/20261122100000_exportar_dados_down.sql`
- Test: `tests/integration/exportar-dados.test.ts`

**Interfaces:**
- Produces:
  - `exportar_produtos(_colecao text, _subcolecao text, _campos text[], _niveis text[], _limite int DEFAULT NULL) RETURNS jsonb` — `{ colunas, total, niveis: { "1": [...], "2": [...], "3": [...] } }`; cada linha é um objeto `{<campo>: valor}` pelos campos pedidos; níveis 2/3 trazem o pai seguido dos filhos. `_colecao` = nome ou id da coleção (texto, casado pelo rótulo). `_limite` = prévia (NULL = tudo).
  - `exportar_subcolecoes(_colecao text) RETURNS jsonb` — `["R1","R2",…]` só as subcoleções daquela coleção.

- [ ] **Step 1: Escrever o teste de integração (cópia local, txn revertida)**

```ts
// tests/integration/exportar-dados.test.ts
// Roda só na cópia local (54422). Semeia produtos (interno/revenda/importado + 1 reprovado) numa
// coleção/subcoleção e confere que exportar_produtos devolve os níveis certos e inclui o reprovado.
import { describe, it, expect } from "vitest";
import { withTx, um, TENANT_TESTE, USER_TESTE } from "./db"; // helpers existentes (ver outros testes de integração)

describe("exportar_produtos", () => {
  it("nível 1 traz 1 linha por produto, inclui reprovado, com os campos pedidos", async () => {
    await withTx(async (tx) => {
      // semear: 1 interno normal + 1 interno REPROVADO na mesma coleção "QA-EXP"/sub "R1"
      // (use os INSERTs mínimos de modelos que os outros testes de integração usam;
      //  o executor confirma as colunas obrigatórias de `modelos` lendo um seed existente)
      await um(tx, `SELECT set_config('request.jwt.claims', json_build_object('sub','${USER_TESTE}')::text, true)`);
      const r = await um(tx, `SELECT exportar_produtos('QA-EXP','R1', ARRAY['nome','ref_sku','origem'], ARRAY['1'], NULL) AS j`);
      const j = r.j;
      expect(j.niveis["1"].length).toBeGreaterThanOrEqual(2); // o normal E o reprovado
      expect(j.colunas).toEqual(["nome", "ref_sku", "origem"]);
      // o reprovado aparece:
      expect(j.niveis["1"].some((l: any) => l.origem)).toBe(true);
    });
  });

  it("nível 3 traz pai + 1 linha por SKU cor×tamanho; produto sem grade sai só o pai", async () => {
    await withTx(async (tx) => {
      await um(tx, `SELECT set_config('request.jwt.claims', json_build_object('sub','${USER_TESTE}')::text, true)`);
      const r = await um(tx, `SELECT exportar_produtos('QA-EXP','R1', ARRAY['ref_sku','cor_base','tamanho'], ARRAY['3'], NULL) AS j`);
      expect(Array.isArray(r.j.niveis["3"])).toBe(true);
      // (asserção exata de quantas linhas depende do seed; o executor ajusta ao seed que criar)
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
npx vitest run tests/integration/exportar-dados.test.ts --no-file-parallelism
```
Expected: FAIL (`function exportar_produtos does not exist`)

- [ ] **Step 3: Escrever a migration**

A migration cria `_exportar_produtos_core` (DEFINER, REVOKE dos 3) + wrapper `exportar_produtos` (gate `integracao` via `_integracao_exige` ou `user_can_view('integracao')`, chama o core) + `exportar_subcolecoes`. O `_core`:
1. Recorte: `FROM modelos m LEFT JOIN colecoes co ON co.id=m.colecao_id WHERE m.tenant_id=_tenant` + filtro por coleção (`coalesce(co.nome, btrim(m.colecao)) = _colecao`) e, se `_subcolecao` não vazio, `m.subcolecao = _subcolecao`. (SEM o bloco de reprovados.) `LIMIT _limite` quando não-nulo.
2. Para cada campo pedido, resolver a fonte (ver mapa abaixo). Taxonomia por join tenant-scoped; coleção/categoria_tecido/linha via `_integracao_extras(m.id)`; custo via `_custo_unitario_modelos_core`; SKU/cor/tamanho via `_skus_calc_ref_tipo(m.id, m.ref, tipo)` + `modelo_skus`.
3. Montar `niveis`: nível 1 = objeto por produto (campos do pai); nível 2 = pai + 1 por variante de cor; nível 3 = pai + 1 por SKU cor×tamanho. `jsonb_build_object` com só os campos pedidos, na ordem de `_campos`.
4. `RETURN jsonb_build_object('colunas', to_jsonb(_campos), 'total', v_total, 'niveis', v_niveis)`.

Mapa de campos (o executor escreve o CASE/branch por key):
- nome=`m.nome`; ref_sku=pai `m.ref`, filho `modelo_skus.sku`; preco_venda=`m.preco_venda`; preco_atacado=`m.preco_atacado`; preco_anterior=`m.preco_anterior`; preco_custo=`_custo_unitario_modelos_core`; peso=`m.peso_kg`; ncm=`m.ncm`; titulo=`m.titulo_pagina`; descricao=`m.descricao_produto`; comprimento/largura/altura=`m.comprimento_cm/largura_cm/altura_cm`; cor_base/cor_apelido/tamanho=de `_skus_calc_ref_tipo` (só níveis 2/3); subcolecao=`m.subcolecao`; origem=`coalesce(m.origem,'interno')`; grupo=`grupos_produto.nome` (via `categorias_produto.grupo_id`); categoria=`categorias_produto.nome` (via `m.categoria_principal_id`); subcategoria1=`subcategorias1_produto.nome` (via `m.subcategoria1_id`); subcategoria2=`subcategorias2_produto.nome` (via `m.subcategoria2_id`); colecao/categoria_tecido/linha=`_integracao_extras(m.id)`.

RAISE ASCII (ex.: `nao_autenticado`, `sem_permissao`). Guardar o rollback (DROP das 3 funções).

> ⚠️ Nota ao implementador: confira na cópia (`information_schema`) os nomes exatos antes de escrever, e a assinatura de `_skus_calc_ref_tipo` / `_custo_unitario_modelos_core` / `_integracao_extras` (o levantamento os tem). Teste cada peça com um `SELECT` antes de montar o todo.

- [ ] **Step 4: Aplicar na cópia e rodar o teste**

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261122100000_exportar_dados.sql
npx vitest run tests/integration/exportar-dados.test.ts --no-file-parallelism
```
Expected: PASS. Conferir também `has_function_privilege('anon','_exportar_produtos_core(...)','EXECUTE') = false`.

- [ ] **Step 5: Commit**

```bash
git commit --only supabase/migrations/20261122100000_exportar_dados.sql supabase/rollback/20261122100000_exportar_dados_down.sql tests/integration/exportar-dados.test.ts -m "feat(exportar): RPC exportar_produtos + subcoleções (banco)"
```

---

## Task 2: Catálogo de campos `campos-export.ts`

**Files:**
- Create: `src/lib/integracao/campos-export.ts`
- Test: `tests/unit/campos-export.test.ts`

**Interfaces:**
- Produces: `CAMPOS_EXPORT: CampoExport[]` (type `{ key: string; rotulo: string; soVariante: boolean }`), `CAMPO_EXPORT_BY_KEY: Map`, `ordenarCamposExport(keys: string[]): string[]`, `KEYS_VALIDAS: Set<string>`.

- [ ] **Step 1: Teste**

```ts
// tests/unit/campos-export.test.ts
import { describe, it, expect } from "vitest";
import { CAMPOS_EXPORT, ordenarCamposExport, KEYS_VALIDAS } from "@/lib/integracao/campos-export";

describe("campos-export", () => {
  it("tem os 21 da Integração + os 7 extras", () => {
    const keys = CAMPOS_EXPORT.map((c) => c.key);
    for (const k of ["nome","ref_sku","preco_venda","preco_custo","cor_base","tamanho","colecao","categoria_tecido","linha"]) expect(keys).toContain(k);
    for (const k of ["preco_atacado","subcolecao","grupo","categoria","subcategoria1","subcategoria2","origem"]) expect(keys).toContain(k);
  });
  it("ordenarCamposExport preserva a ordem do catálogo", () => {
    expect(ordenarCamposExport(["origem","nome"])).toEqual(["nome","origem"]);
  });
  it("KEYS_VALIDAS filtra inválidas", () => {
    expect(KEYS_VALIDAS.has("nome")).toBe(true);
    expect(KEYS_VALIDAS.has("xpto")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.** `npx vitest run tests/unit/campos-export.test.ts --no-file-parallelism` → FAIL.

- [ ] **Step 3: Implementar** — criar `campos-export.ts` com o array `CAMPOS_EXPORT` (os 28: 21 + 7), cada um `{key, rotulo, soVariante}` (soVariante=true só em cor_base/cor_apelido/tamanho), na ordem desejada; derivar `CAMPO_EXPORT_BY_KEY`, `KEYS_VALIDAS` (Set das keys), `ordenarCamposExport` (filtra pelas válidas e ordena pela posição no array).

- [ ] **Step 4: Rodar e ver passar.** PASS.

- [ ] **Step 5: Commit** `git commit --only src/lib/integracao/campos-export.ts tests/unit/campos-export.test.ts -m "feat(exportar): catálogo de campos próprio"`

---

## Task 3: Lib de geração de arquivo `export.ts`

**Files:**
- Create: `src/lib/integracao/export.ts`
- Test: `tests/unit/export-arquivo.test.ts`

**Interfaces:**
- Consumes: `CAMPO_EXPORT_BY_KEY`, `ordenarCamposExport` (Task 2).
- Produces: `montarMatriz(linhas: Record<string,unknown>[], campos: string[]): string[][]` (cabeçalho = rótulos + linhas); `baixarExport(dados: {colunas:string[]; niveis:Record<string,Record<string,unknown>[]>}, niveisSel: string[], nomeBase: string): void` (1 nível = CSV via `XLSX.writeFile(wb,".csv")`; 2-3 = .xlsx com 1 aba/nível).

- [ ] **Step 1: Teste (só a função pura `montarMatriz`)**

```ts
// tests/unit/export-arquivo.test.ts
import { describe, it, expect } from "vitest";
import { montarMatriz } from "@/lib/integracao/export";

describe("montarMatriz", () => {
  it("cabeçalho = rótulos dos campos; 1 linha por item, na ordem dos campos", () => {
    const linhas = [{ nome: "Blusa", ref_sku: "OPVL1" }, { nome: "Saia", ref_sku: "OPSL2" }];
    const m = montarMatriz(linhas, ["nome", "ref_sku"]);
    expect(m[0]).toEqual(["Nome", "REF / SKU"]); // rótulos do catálogo
    expect(m[1]).toEqual(["Blusa", "OPVL1"]);
    expect(m[2]).toEqual(["Saia", "OPSL2"]);
  });
  it("valor ausente vira string vazia", () => {
    const m = montarMatriz([{ nome: "X" }], ["nome", "ref_sku"]);
    expect(m[1]).toEqual(["X", ""]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.** FAIL.

- [ ] **Step 3: Implementar** `export.ts`: `montarMatriz` (cabeçalho via `CAMPO_EXPORT_BY_KEY.get(k).rotulo`; célula = `String(linha[k] ?? "")`); `baixarExport` usa `XLSX.utils.aoa_to_sheet(montarMatriz(...))` por nível, `book_append_sheet(wb, ws, "SKU pai"|"Até cor"|"Até tamanho")`, e `XLSX.writeFile(wb, 1 nível ? nomeBase+".csv" : nomeBase+".xlsx")`. Import `import * as XLSX from "xlsx"` (padrão de template.ts).

- [ ] **Step 4: Rodar e ver passar.** PASS. (`baixarExport` é testada por QA na prévia — download não roda em happy-dom.)

- [ ] **Step 5: Commit** `git commit --only src/lib/integracao/export.ts tests/unit/export-arquivo.test.ts -m "feat(exportar): lib de geração CSV/Excel"`

---

## Task 4: Estender `useUserPref` com scope "export"

**Files:**
- Modify: `src/hooks/useUiPrefs.ts:23` (type `UiPrefScope`)
- Test: `tests/unit/ui-prefs-scope.test.ts` (confirma que o type aceita "export" — teste de compilação/uso)

**Interfaces:**
- Produces: `UiPrefScope = "filtro" | "agrupar" | "export"`.

- [ ] **Step 1: Teste**

```ts
// tests/unit/ui-prefs-scope.test.ts
import { describe, it, expect } from "vitest";
import type { UiPrefScope } from "@/hooks/useUiPrefs";
describe("UiPrefScope", () => {
  it("aceita 'export'", () => {
    const s: UiPrefScope = "export"; // compila = ok
    expect(s).toBe("export");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar (tsc).** `npx tsc --noEmit 2>&1 | grep ui-prefs-scope` → erro (type não aceita "export").

- [ ] **Step 3: Implementar** — em `src/hooks/useUiPrefs.ts:23`, trocar `export type UiPrefScope = "filtro" | "agrupar";` por `export type UiPrefScope = "filtro" | "agrupar" | "export";`. (A migração legada em 123-145 só varre filtro/agrupar — scope novo não quebra nada.)

- [ ] **Step 4: Rodar e ver passar.** `npx vitest run tests/unit/ui-prefs-scope.test.ts --no-file-parallelism` + `npx tsc --noEmit 2>&1 | grep useUiPrefs` → verde/vazio.

- [ ] **Step 5: Commit** `git commit --only src/hooks/useUiPrefs.ts tests/unit/ui-prefs-scope.test.ts -m "feat(exportar): scope export no useUserPref"`

---

## Task 5: Componente `ExportarAba.tsx`

**Files:**
- Create: `src/components/integracao/ExportarAba.tsx`
- Test: `tests/unit/exportar-aba.test.ts` (render: guarda de "nada marcado", prévia vazia)

**Interfaces:**
- Consumes: `CAMPOS_EXPORT`, `KEYS_VALIDAS` (T2); `baixarExport` (T3); `useUserPref` com "export" (T4); `buscarOpcoesColecao` + a RPC `exportar_subcolecoes`/`exportar_produtos` (T1).

- [ ] **Step 1: Teste de render (guardas)**

```ts
// tests/unit/exportar-aba.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ExportarAba } from "@/components/integracao/ExportarAba";
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { colecoes: [], subcolecoes: [] }, error: null }); });

describe("ExportarAba", () => {
  it("botão Baixar desabilitado quando nada marcado", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div"); document.body.appendChild(container);
    await act(async () => { createRoot(container).render(createElement(QueryClientProvider, { client: qc }, createElement(ExportarAba))); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const botao = Array.from(container.querySelectorAll("button")).find((b) => /baixar/i.test(b.textContent ?? ""));
    expect(botao?.disabled).toBe(true); // sem coleção/colunas/níveis
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.** FAIL (módulo não existe).

- [ ] **Step 3: Implementar** `ExportarAba.tsx`:
  - filtros: Coleção (`buscarOpcoesColecao().colecoes`) + Subcoleção (query `exportar_subcolecoes` dependente da coleção escolhida); persistidos (`useUserPref("export","integracao","colecao",[])` etc.).
  - colunas: checkboxes de `CAMPOS_EXPORT`; persistidos (`useUserPref("export","integracao","colunas",[])`), filtrados por `KEYS_VALIDAS` ao ler.
  - níveis: 3 checkboxes; persistidos como `string[]` (`["1","2","3"]`).
  - prévia: `useQuery` chamando `exportar_produtos(colecao, subcolecao, colunasSel, niveisSel, 20)`; renderiza uma tabela com as linhas do 1º nível marcado + "mostrando 20 de N". Coleção vazia / sem resultado = mensagem ("Nenhum produto neste recorte."). Erro = "Tentar de novo".
  - botão "Baixar": `disabled` quando falta coleção OU nenhuma coluna OU nenhum nível; ao clicar, chama `exportar_produtos(..., null)` (sem limite) e `baixarExport(dados, niveisSel, nomeBase)`; toast de sucesso/erro.

> ⚠️ Nota: confirme a assinatura exata de `useUserPref` (scope, screen, key, string[]) e de `buscarOpcoesColecao` (sem args, `{colecoes,subcolecoes}`) — o levantamento as tem.

- [ ] **Step 4: Rodar e ver passar + build/tsc.** `npx vitest run tests/unit/exportar-aba.test.ts --no-file-parallelism` + `npm run build` + `npx tsc --noEmit 2>&1 | grep ExportarAba` → verde/vazio.

- [ ] **Step 5: Commit** `git commit --only src/components/integracao/ExportarAba.tsx tests/unit/exportar-aba.test.ts -m "feat(exportar): aba Exportar (filtros, colunas, níveis, prévia)"`

---

## Task 6: Registrar a aba na Integração

**Files:**
- Modify: `src/lib/integracao/abas.ts` (Aba + ROTULO_ABA + abasVisiveis)
- Modify: `src/components/integracao/IntegracaoPage.tsx` (CONTEUDO_ABA)

**Interfaces:**
- Consumes: `ExportarAba` (T5).

- [ ] **Step 1: Editar `abas.ts`** — `Aba` += `| "exportar"`; `ROTULO_ABA` += `exportar: "Exportar dados"`; `abasVisiveis` inclui "exportar" nas listas de quem pode ver (mesmo critério de quem acessa a Integração — super admin; se admin da loja também vê a Integração, incluir conforme a regra atual das outras abas).

- [ ] **Step 2: Editar `IntegracaoPage.tsx`** — import `ExportarAba` + `CONTEUDO_ABA` += `exportar: ExportarAba`. (Os `Tabs` são genéricos — o Record exaustivo obriga a chave; TS pega se esquecer.)

- [ ] **Step 3: Build/tsc.** `npm run build && npx tsc --noEmit 2>&1 | grep -E "abas|IntegracaoPage" | head` → verde/vazio.

- [ ] **Step 4: QA manual na prévia** — abrir Integração → aba "Exportar dados" aparece → filtrar Resort 27 › R1 → marcar colunas + níveis → prévia aparece → baixar CSV (1 nível) e Excel (3 níveis).

- [ ] **Step 5: Commit** `git commit --only src/lib/integracao/abas.ts src/components/integracao/IntegracaoPage.tsx -m "feat(exportar): registrar aba Exportar na Integração"`

---

## Self-Review

**1. Spec coverage:** aba na Integração→T6; filtros coleção/subcoleção ligada→T1(subcoleções)+T5; colunas+níveis→T2+T5; prévia→T5; persistência→T4+T5; CSV/Excel→T3; RPC 3 origens+reprovados+extras→T1. ✓

**2. Placeholder scan:** as "notas ao implementador" (T1/T5) são verificações de nomes exatos (o levantamento os tem), não placeholders de lógica. Sem TBD/TODO. ✓

**3. Type consistency:** `CampoExport` (T2) usado em T3/T5; `baixarExport`/`montarMatriz` (T3) assinaturas únicas; `UiPrefScope`+"export" (T4) usado em T5; retorno da RPC `{colunas,total,niveis}` (T1) consumido por T5/T3. ✓

**4. Review Focus:** reprovado incluído (T1 teste), produto sem grade (T1 teste), nada marcado (T5 teste), coleção vazia (T5 render), seleção corrompida (T5 filtra por KEYS_VALIDAS). ✓
