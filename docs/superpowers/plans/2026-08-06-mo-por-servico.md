# MO por serviço + toggle de serviços — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** transformar a Mão de Obra (MO) do modelo de um valor único aprovado num flag por modelo para **um valor por serviço**, cada um aprovado/reprovado individualmente, mantendo o gate `custo_terceirizados_aprovado` funcionando como flag DERIVADO; e dar às categorias de serviço um toggle `ativo` (soft-hide) para desligar os fixos (Corte/Oficina).

**Architecture:** tabela nova `modelo_servico_mo` (1 linha por modelo×serviço, `categoria_terceirizado_id` NULL = "Geral (legado)"). O flag `modelos.custo_terceirizados_aprovado` deixa de ser escrito pela UI e passa a ser **derivado** das linhas por dois gatilhos: um `AFTER` em `modelo_servico_mo` que repinta o modelo, e um `BEFORE` em `modelos` que re-deriva o flag em qualquer UPDATE (torna a coluna à prova de adulteração). O trigger histórico `trg_enforce_maodeobra_aprovacao` é aposentado; a permissão de aprovar migra para um trigger **por linha** em `modelo_servico_mo`. Todos os consumidores atuais (`lancar_modelo`, kanban `servico_aprovado`, dashboards, badges) seguem lendo o flag sem mudança. Escrita e leitura de valores via RPCs `salvar_modelo_servico_mo` / `aprovar_servico_mo` / `modelo_mo_resumo` (wrapper+core, REVOKE dos três). Front: editor por serviço no Planejamento e card "MO Aprovada" no PCP passando a ler a MO planejada aprovada.

**Tech Stack:** Postgres (Supabase próprio, ref `ruinwcuabilumcspeyjk`) + RLS + triggers + RPCs `SECURITY DEFINER`; Vite + React + TypeScript + TanStack Query/Router; Vitest (unit puro + integração transacional `BEGIN…ROLLBACK`).

## Global Constraints

Todas as tasks herdam estas regras (valores exatos do spec + CLAUDE.md):

- **Migração:** cada migração é um arquivo em `supabase/migrations/` aplicado com `psql "$(cat /tmp/dburl.txt)" -f <arquivo>`. Migração destrutiva/consolidação (`DROP`, `DELETE`, backfill) **envolvida em `BEGIN; … COMMIT;`** e **idempotente** (`IF NOT EXISTS`/`IF EXISTS`/`ADD COLUMN IF NOT EXISTS`/`CREATE OR REPLACE`/`DROP … IF EXISTS`), para poder reaplicar.
- **REVOKE dos TRÊS** em todo `_core`: `REVOKE EXECUTE ON FUNCTION public._xxx_core(args) FROM PUBLIC, anon, authenticated;` — o default ACL concede a **PUBLIC** e anon/authenticated HERDAM. Verificar com `has_function_privilege('anon','_xxx_core(args)','EXECUTE') = false` e idem `authenticated` (invariante #9).
- **Erros de negócio em PT via `RAISE`** com `USING ERRCODE = 'P0001'` (o `erro-mensagem.ts` só repassa a mensagem custom de P0001/42501; **nunca** 23514, que é engolido). Erros de permissão seguem `42501` (padrão do repo).
- **Front:** datas sempre `<DateField>` (nunca `<input type=date>`); toasts sempre `mensagemErro(e, fallback)` (`@/lib/erro-mensagem`); **queryKey única por tela**; forms com Salvar usam `useUnsavedGuard` + `<UnsavedChangesGuard>` + `useDirtySnapshot`.
- **FK `modelo_servico_mo.categoria_terceirizado_id` = `ON DELETE RESTRICT`** (não apagar serviço com MO); desabilitar serviço = toggle `ativo=false` (soft-hide), nunca excluir os fixos.
- **UNIQUE composta** `(modelo_id, categoria_terceirizado_id)` é segura; NÃO criar UNIQUE/FK numa coluna ÚNICA embedada. Máximo 1 legado por modelo via **índice único parcial** `WHERE categoria_terceirizado_id IS NULL`.
- **Kanban:** o catálogo TS (`src/lib/kanban-condicoes.ts`), o branch na RPC `avaliar_condicoes_kanban` e o teste anti-drift (`tests/unit/kanban-condicoes.test.ts`) andam JUNTOS. **Este plano NÃO adiciona nem remove chaves de kanban** — a chave `servico_aprovado` permanece lendo `coalesce(modelos.custo_terceirizados_aprovado,false)`, agora um flag derivado; o teste anti-drift deve seguir verde sem alteração de chaves.
- **Testes de integração** rodam em `BEGIN…ROLLBACK` via `tests/integration/db.ts` (`withTx`, `comoUsuario`, `semUsuario`, `um`, `TENANT_TESTE`, `USER_TESTE`); sem credencial, auto-pulam (`describe.skipIf(!hasDb)`). Rodam contra PRODUÇÃO em txn revertida.
- **Build:** `npm run build` antes de qualquer commit; após mexer em imports rode `npx tsc --noEmit 2>&1 | grep TS2304`. Lint só nos arquivos tocados.
- **types.ts desatualizado:** o `src/integrations/supabase/types.ts` não tem `categorias_terceirizado.ativo` nem a tabela `modelo_servico_mo` (regen pende de `supabase login`). Todo acesso novo à coluna/tabela pelo cliente tipado usa `(supabase.from("…") as any)` / `supabase.rpc("…" as any, …)`, seguindo o padrão já usado no arquivo (ex.: `criacao.planejamento.tsx` linha 1458).

---

## Fatos verificados do código/schema (base do plano)

- `categorias_terceirizado` colunas: `id, tenant_id, nome varchar(255), created_at, ordem int NOT NULL default 0, etapa text NOT NULL default 'ate_costura' CHECK IN ('ate_costura','pos_costura')`. UNIQUE `(tenant_id, nome)`. Trigger `set_tenant_id_trg BEFORE INSERT`. **Não tem `ativo` nem `updated_at`.** Semeados: Corte, Oficina, Bordado, PL, Entretela, Caseado.
- `modelos` colunas relevantes: `custo_terceirizados_previsto numeric NULL`, `custo_terceirizados_aprovado boolean NULL` (**3 estados: null/true/false — NÃO é NOT NULL default false**; ver §Divergências), `custo_simulado jsonb NULL` (campo `mao_obra`), `observacoes_mao_obra text NULL`, `motivo_reprovacao_mao_obra text NULL`, `lancado boolean NOT NULL default false`. Trigger `trg_enforce_maodeobra_aprovacao BEFORE UPDATE`.
- `lancar_modelo(_modelo_id uuid, _data_lancamento date, _send boolean=true)` lê o flag **DIRETO**: `IF NOT COALESCE((SELECT custo_terceirizados_aprovado FROM modelos WHERE …), false) THEN RAISE 'Aprove a mão de obra antes de lançar.' USING ERRCODE='42501'`.
- `avaliar_condicoes_kanban(uuid[])`: branch `'servico_aprovado', coalesce(m.custo_terceirizados_aprovado, false)`.
- `custo_unitario_modelos(uuid[])` = wrapper (retorna `'{}'` se `NOT _pode_ver_custos()`) → `_custo_unitario_modelos_core(uuid[])`. No core, `'mao_obra_previsto', coalesce(m.custo_terceirizados_previsto,0)` e `'mao_obra_real'` = serviço executado ÷ grade. **Só `mao_obra_previsto` muda** (passa a somar `modelo_servico_mo.valor`).
- `enforce_maodeobra_aprovacao()`: `IF NEW.custo_terceirizados_aprovado IS DISTINCT FROM OLD.… THEN IF NOT user_can_edit('producao_servico_aprovacao') THEN RAISE 42501`.
- `user_can_edit(text)` / `user_can_view(text)` = SQL STABLE DEFINER: super_admin OR admin OR tenant_admin OR `user_permissions(pode_editar|pode_visualizar)`.
- `_pode_ver_custos()` = `user_can_view` de `criacao_planejamento:custos` OR `criacao_desenvolvimento:custos` OR `producao_terceirizados:precos` OR `dashboard_custos` OR `dashboard_comercial`.
- `set_tenant_id()` BEFORE INSERT preenche `NEW.tenant_id := get_user_tenant_id()` se NULL e RAISE se nil sentinela sem super_admin.
- **Edição de `categorias_terceirizado`** = componente genérico `AttributeTab` (`src/components/attribute-tab.tsx`) dirigido por config em `src/routes/_authenticated/cadastro.atributos.tsx` (bloco `value:"cat_terceirizado"`, linhas 295–324): `table:"categorias_terceirizado"`, `nameField:"nome"`, `orderField:"ordem"`, `extraEnum` = etapa, `protectedNames:["corte","oficina"]` (conceito de "fixo" já existente: sem editar/excluir, badge "fixo"). Query key `["attr","categorias_terceirizado",""]`, `.select("*")`, `.from(config.table as any)`. Consumidor por lista de colunas: `pcp.servicos.$modeloId.tsx:257` (`.select("id, nome, etapa")`).
- Planejamento (`criacao.planejamento.tsx`): seção "Simulação de custo" com input "Mão de obra (R$)" (`custo_simulado.mao_obra`, ~l.2040) e seção "Mão de obra" com botões Aprovar/Reprovar únicos + `<ObsMaoObraField>` (~l.2059). Card (`ModeloCard`) mostra badge MO 3-estados a partir do flag (~l.1041) + botões aprovar/reprovar (`setMaoObra`, ~l.232). Detalhe: `setMaoObraDetalhe` (~l.1471) + `custoData` de `custo_unitario_modelos` (queryKey `["plan-custo-unit", modeloId]`, ~l.1367). `maoObraDev = custoData.mao_obra_previsto` (~l.1413).
- PCP (`pcp.servicos.$modeloId.tsx`): card "MO Aprovada" (~l.866) mostra `servicoTotal` (Σ blocos executados) + estado do flag; gated `podeVerPrecos = canView("producao_terceirizados:precos")`.

## Divergências da spec encontradas no código (decisões deste plano)

1. **`custo_terceirizados_aprovado` é NULLABLE (3 estados), não NOT NULL default false** como o brief assumiu. Consequência para o rollup derivado: a fórmula `liberada = NOT EXISTS(linha aprovado IS DISTINCT FROM true)` produz um **boolean** (true/false). Depois da virada, o nível-MODELO deixa de ter o estado "pendente(null)" — pendência passa a viver **por linha** (`modelo_servico_mo.aprovado = NULL`), e o flag do modelo é `false` enquanto houver linha pendente OU reprovada. Isso é 100% compatível com os consumidores, que já fazem `coalesce(flag,false)` (null e false bloqueiam igual). O DISPLAY 3-estados (badge pendente/reprovada/aprovada) NÃO pode mais sair só do flag → passa a sair do **estado derivado das linhas** (`modelo_mo_resumo.estado`, Task 4/5/6).
2. **`lancar_modelo` e o kanban leem o flag DIRETO** (`COALESCE(flag,false)`), não via predicado — por isso o flag DERIVADO mantém tudo funcionando sem tocar essas funções.
3. **`categorias_terceirizado` é editado só via `AttributeTab` genérico** (não há segunda UI). Adicionar o toggle `ativo` = nova capacidade `toggleField` no `AttributeTab` + config; como o componente já usa `.from(table as any)`/`.select("*")`, não precisa regen de types.
4. **O gate de permissão de aprovação hoje é o trigger `trg_enforce_maodeobra_aprovacao` em `modelos`**. Ele CONFLITA com o flag derivado (adicionar uma linha pendente muda o flag true→false e o trigger exigiria permissão de quem só editou valor). Solução: **aposentar** esse trigger e mover a permissão para um trigger **por linha** em `modelo_servico_mo`; a tamper-proofing do flag fica num trigger `BEFORE UPDATE` em `modelos` que re-deriva o valor (sem gate). Documentar a mudança do invariante #12 (Task 7).

## Mapa de arquivos

**Migrações (criar):**
- `supabase/migrations/20260806100000_categorias_terceirizado_ativo.sql` — Task 1.
- `supabase/migrations/20260806110000_modelo_servico_mo.sql` — Task 2 (tabela + índices + RLS + set_tenant_id + backfill legado).
- `supabase/migrations/20260806120000_modelo_servico_mo_rollup.sql` — Task 3 (helper `_mo_liberada` + trigger derive em `modelos` + trigger rollup em `modelo_servico_mo` + aposenta enforce + recompute + repinta `_custo_unitario_modelos_core`).
- `supabase/migrations/20260806130000_modelo_servico_mo_rpcs.sql` — Task 4 (trigger de permissão por linha + RPCs salvar/aprovar/resumo wrapper+core, REVOKE dos três).

**Lib pura (criar):** `src/lib/mao-obra.ts` — helpers puros `moLiberada`/`estadoMO`/`somaAprovada`/`somaTotal` (Task 3, usados no front das Tasks 5/6).

**Front (modificar/criar):**
- `src/components/attribute-tab.tsx` + `src/routes/_authenticated/cadastro.atributos.tsx` + `src/routes/_authenticated/pcp.servicos.$modeloId.tsx` (filtro `ativo` nos botões de categoria) — Task 1.
- `src/components/planejamento/MaoObraEditor.tsx` (criar) + `src/routes/_authenticated/criacao.planejamento.tsx` (fiar o editor, sim calc, badge do card) — Task 5.
- `src/routes/_authenticated/pcp.servicos.$modeloId.tsx` (card "MO Aprovada" lê `modelo_mo_resumo`) — Task 6.

**Testes (criar):**
- `tests/unit/mao-obra.test.ts` — helpers puros (Task 3).
- `tests/integration/mo-por-servico.test.ts` — rollup, permissão por linha, custo_unitario, toggle (Tasks 3/4).

**Docs (modificar):** `CLAUDE.md` (invariantes #8/#12 + bloco kanban), `docs/mapeamento-campos-calculos.md`, memória do projeto — Task 7.

---

### Task 1: Coluna `ativo` em `categorias_terceirizado` + toggle no cadastro

**Files:**
- Create: `supabase/migrations/20260806100000_categorias_terceirizado_ativo.sql`
- Modify: `src/components/attribute-tab.tsx` (tipo `AttributeTabConfig` ~l.67-85; render de linha ~l.465-588)
- Modify: `src/routes/_authenticated/cadastro.atributos.tsx` (bloco `cat_terceirizado` ~l.295-324)
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx` (query de categorias ~l.256-260; botões de categoria)

**Interfaces:**
- Produces: coluna `categorias_terceirizado.ativo boolean NOT NULL DEFAULT true`. Capacidade `AttributeTabConfig.toggleField?: { field: string; label: string; hint?: string }`. Consumidores filtram `ativo !== false` para NOVOS usos.
- Consumes: nada de tasks anteriores.

- [ ] **Step 1: Escrever a migração idempotente**

`supabase/migrations/20260806100000_categorias_terceirizado_ativo.sql`:

```sql
-- Toggle de serviço (soft-hide) — Parte B do design MO por serviço (2026-08-06).
-- `ativo=false` some da seleção de NOVOS usos (Planejamento/PCP); usos históricos persistem.
-- Aditivo e idempotente (sem BEGIN/COMMIT: um único ADD COLUMN IF NOT EXISTS).
ALTER TABLE public.categorias_terceirizado
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
```

- [ ] **Step 2: Aplicar e verificar a migração**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260806100000_categorias_terceirizado_ativo.sql
psql "$(cat /tmp/dburl.txt)" -c "\d categorias_terceirizado" | grep ativo
```
Expected: linha `ativo | boolean | not null | true`. Reaplicar o `-f` uma 2ª vez não deve dar erro (idempotente).

- [ ] **Step 3: Escrever o teste (integração) do default e do toggle**

Adicionar em `tests/integration/mo-por-servico.test.ts` (arquivo será criado — pode começar por este bloco):

```ts
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("MO por serviço — Task 1: toggle ativo em categorias_terceirizado", () => {
  it("coluna ativo existe, NOT NULL default true", async () => {
    await withTx(async (c) => {
      const r = await um<{ is_nullable: string; column_default: string }>(
        c,
        `select is_nullable, column_default from information_schema.columns
          where table_name='categorias_terceirizado' and column_name='ativo'`,
      );
      expect(r.is_nullable).toBe("NO");
      expect(r.column_default).toMatch(/true/);
    });
  });

  it("categoria nova nasce ativa; desativar não a exclui", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cat = await um<{ id: string; ativo: boolean }>(
        c,
        `insert into categorias_terceirizado (tenant_id, nome, etapa)
         values ($1, 'Serviço Teste MO', 'ate_costura') returning id, ativo`,
        [TENANT_TESTE],
      );
      expect(cat.ativo).toBe(true);
      await c.query(`update categorias_terceirizado set ativo=false where id=$1`, [cat.id]);
      const still = await um<{ n: string }>(
        c, `select count(*) as n from categorias_terceirizado where id=$1`, [cat.id],
      );
      expect(Number(still.n)).toBe(1);
    });
  });
});
```

- [ ] **Step 4: Rodar o teste (deve passar após a migração)**

Run: `npm run test:int -- mo-por-servico`
Expected: PASS (os 2 casos da Task 1). Se `hasDb` for falso, o describe se auto-pula — nesse caso rode `psql` manual do Step 2 como verificação.

- [ ] **Step 5: Adicionar a capacidade `toggleField` ao `AttributeTab`**

Em `src/components/attribute-tab.tsx`, no tipo `AttributeTabConfig` (após o campo `orderField`, ~l.84), adicionar:

```ts
  /** Toggle booleano por linha (soft-hide). Coluna `field` bool NOT NULL. Ex.: ativo. */
  toggleField?: { field: string; label: string; hint?: string };
```

Adicionar a mutation (perto de `updateEnumMut`, ~l.313):

```ts
  const updateToggleMut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      if (!config.toggleField) return;
      const { data, error } = await supabase
        .from(config.table as any)
        .update({ [config.toggleField.field]: value })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Sem permissão para editar este item.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: listKey }); onChanged?.(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao alterar")),
  });
```

No render da linha (dentro do `sorted.map`, junto às outras células, antes da célula de Ações ~l.573), adicionar uma célula de toggle usando o `<Switch>` do shadcn (import `import { Switch } from "@/components/ui/switch";` no topo se ainda não houver):

```tsx
                {config.toggleField && (
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row[config.toggleField.field] !== false}
                        onCheckedChange={(v) => updateToggleMut.mutate({ id: row.id, value: v })}
                        aria-label={config.toggleField.label}
                        disabled={updateToggleMut.isPending}
                      />
                      <span className="text-xs text-muted-foreground">
                        {row[config.toggleField.field] !== false ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                  </td>
                )}
```

E no cabeçalho da tabela (onde ficam os `<th>` das colunas extras), adicionar `{config.toggleField && <th className="px-2 py-1.5 text-left text-xs font-medium">{config.toggleField.label}</th>}` na mesma posição relativa. (Localize o `<thead>`/linha de `<th>` do componente e insira a coluna antes de "Ações".)

- [ ] **Step 6: Ligar o toggle na config `cat_terceirizado`**

Em `src/routes/_authenticated/cadastro.atributos.tsx`, no objeto do bloco `value:"cat_terceirizado"` (dentro de `ATTRIBUTES`, ~l.295-324), adicionar o campo:

```ts
      toggleField: { field: "ativo", label: "Ativo", hint: "Desligar esconde o serviço de novos usos (não exclui)." },
```

- [ ] **Step 7: Respeitar `ativo` nos botões de categoria do PCP (novos usos)**

Em `src/routes/_authenticated/pcp.servicos.$modeloId.tsx`, na query de categorias (~l.256-260), incluir a coluna:

```ts
        .from("categorias_terceirizado")
        .select("id, nome, etapa, ativo")
        .order("ordem")
        .order("nome")
```
(o cliente tipado não conhece `ativo` — use `(supabase.from("categorias_terceirizado") as any)` se o TS reclamar.)

Onde os botões "Categorias do Serviço" são renderizados para ADICIONAR um bloco novo, filtrar as inativas **que ainda não têm bloco no modelo**: um serviço inativo só aparece como botão se já existir um bloco (`producao_terceirizados`) daquele `categoria_terceirizado_id` no modelo (esmaecido). Concretamente, ao montar a lista de botões da aba, use:

```ts
  const catsDaAba = categorias.filter((cat) =>
    cat.etapa === abaEtapa &&
    (cat.ativo !== false || blocos.some((b) => b.categoria_terceirizado_id === cat.id)),
  );
```
e aplique `className` esmaecido (`opacity-60`) quando `cat.ativo === false`. (Substitua o filtro atual da aba pelo acima; mantenha o resto do render igual.)

- [ ] **Step 8: Build + tsc + commit**

Run:
```bash
npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"
```
Expected: build OK; nenhum TS2304.

```bash
git add supabase/migrations/20260806100000_categorias_terceirizado_ativo.sql \
        src/components/attribute-tab.tsx src/routes/_authenticated/cadastro.atributos.tsx \
        src/routes/_authenticated/pcp.servicos.\$modeloId.tsx \
        tests/integration/mo-por-servico.test.ts
git commit -m "feat(servicos): coluna ativo + toggle soft-hide em categorias_terceirizado"
```

---

### Task 2: Tabela `modelo_servico_mo` + RLS + migração do legado

**Files:**
- Create: `supabase/migrations/20260806110000_modelo_servico_mo.sql`
- Test: `tests/integration/mo-por-servico.test.ts` (novo bloco)

**Interfaces:**
- Produces: tabela `public.modelo_servico_mo(id uuid pk, tenant_id uuid, modelo_id uuid FK modelos ON DELETE CASCADE, categoria_terceirizado_id uuid NULL FK categorias_terceirizado ON DELETE RESTRICT, valor numeric NOT NULL DEFAULT 0, aprovado boolean NULL, motivo_reprovacao text, observacoes text, created_at timestamptz, updated_at timestamptz)`. UNIQUE `(modelo_id, categoria_terceirizado_id)` + índice único parcial `ux_msm_legado (modelo_id) WHERE categoria_terceirizado_id IS NULL`. RLS SELECT NÃO existe (leitura só via RPC gated); escrita só via RPC DEFINER (Task 4). Linha legado (categoria NULL) por modelo com lump migrado.
- Consumes: nada; usa `modelos`, `categorias_terceirizado` (Task 1 já aplicada).

- [ ] **Step 1: Escrever o teste (falha antes da migração)**

Adicionar bloco em `tests/integration/mo-por-servico.test.ts`:

```ts
describe.skipIf(!hasDb)("MO por serviço — Task 2: tabela + backfill legado", () => {
  it("tabela existe com FK RESTRICT na categoria e índice parcial do legado", async () => {
    await withTx(async (c) => {
      const restrict = await um<{ n: string }>(
        c,
        `select count(*) as n from pg_constraint
          where conname='modelo_servico_mo_categoria_terceirizado_id_fkey' and confdeltype='r'`,
      );
      expect(Number(restrict.n)).toBe(1); // 'r' = RESTRICT
      const parcial = await um<{ n: string }>(
        c,
        `select count(*) as n from pg_indexes
          where tablename='modelo_servico_mo' and indexname='ux_msm_legado'`,
      );
      expect(Number(parcial.n)).toBe(1);
    });
  });

  it("índice parcial barra 2º legado (categoria NULL) no mesmo modelo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string }>(
        c, `insert into modelos (tenant_id, nome) values ($1,'M legado') returning id`, [TENANT_TESTE],
      );
      await c.query(
        `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor)
         values ($1,$2,NULL,10)`, [TENANT_TESTE, m.id],
      );
      await expect(
        c.query(`insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor)
                 values ($1,$2,NULL,20)`, [TENANT_TESTE, m.id]),
      ).rejects.toThrow(/duplicate key|ux_msm_legado/);
    });
  });

  it("FK RESTRICT impede excluir categoria com MO", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cat = await um<{ id: string }>(
        c, `insert into categorias_terceirizado (tenant_id, nome, etapa)
            values ($1,'Serv RESTRICT','ate_costura') returning id`, [TENANT_TESTE],
      );
      const m = await um<{ id: string }>(
        c, `insert into modelos (tenant_id, nome) values ($1,'M restrict') returning id`, [TENANT_TESTE],
      );
      await c.query(
        `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor)
         values ($1,$2,$3,5)`, [TENANT_TESTE, m.id, cat.id],
      );
      await expect(
        c.query(`delete from categorias_terceirizado where id=$1`, [cat.id]),
      ).rejects.toThrow(/violates foreign key|modelo_servico_mo/);
    });
  });
});
```

- [ ] **Step 2: Rodar o teste (deve falhar — tabela inexistente)**

Run: `npm run test:int -- mo-por-servico`
Expected: FAIL nos 3 casos da Task 2 (`relation "modelo_servico_mo" does not exist`).

- [ ] **Step 3: Escrever a migração (tabela + índices + RLS + set_tenant_id + backfill)**

`supabase/migrations/20260806110000_modelo_servico_mo.sql`:

```sql
-- MO por serviço — Parte A (2026-08-06): tabela modelo_servico_mo + backfill do legado.
-- Idempotente; envolve backfill em BEGIN/COMMIT (consolida dado de produção).
-- Escrita só por RPC DEFINER (Task 4); por isso NÃO há policy de INSERT/UPDATE/DELETE.
-- Leitura de VALOR é custo → gated pela RPC modelo_mo_resumo; por isso também NÃO há
-- policy de SELECT ampla (evita vazar valor a quem não pode ver custos — invariante #12).
BEGIN;

CREATE TABLE IF NOT EXISTS public.modelo_servico_mo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  categoria_terceirizado_id uuid REFERENCES public.categorias_terceirizado(id) ON DELETE RESTRICT,
  valor numeric NOT NULL DEFAULT 0,
  aprovado boolean,                       -- NULL = pendente / true / false
  motivo_reprovacao text,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE composta (segura p/ embed): 1 linha por modelo×serviço.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='modelo_servico_mo_modelo_categoria_key') THEN
    ALTER TABLE public.modelo_servico_mo
      ADD CONSTRAINT modelo_servico_mo_modelo_categoria_key UNIQUE (modelo_id, categoria_terceirizado_id);
  END IF;
END $$;

-- No máx. 1 legado (categoria NULL) por modelo (UNIQUE composta não cobre NULL).
CREATE UNIQUE INDEX IF NOT EXISTS ux_msm_legado
  ON public.modelo_servico_mo (modelo_id) WHERE categoria_terceirizado_id IS NULL;

-- Índices de apoio.
CREATE INDEX IF NOT EXISTS idx_msm_modelo ON public.modelo_servico_mo (modelo_id);
CREATE INDEX IF NOT EXISTS idx_msm_tenant ON public.modelo_servico_mo (tenant_id);

-- RLS: liga; sem policy de escrita (RPC DEFINER) e sem SELECT amplo (valor é custo).
ALTER TABLE public.modelo_servico_mo ENABLE ROW LEVEL SECURITY;

-- set_tenant_id no INSERT (mesmo trigger padrão das outras tabelas de negócio).
DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.modelo_servico_mo;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.modelo_servico_mo
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

-- Backfill "Geral (legado)": 1 linha (categoria NULL) por modelo com MO/aprovação atual.
-- valor = lump (custo_simulado.mao_obra, senão custo_terceirizados_previsto).
-- aprovado = estado atual EXATO do modelo (pode ser null/true/false).
-- Idempotente: só insere onde não há legado (ON CONFLICT no índice parcial não é acionável
-- por WHERE — usamos NOT EXISTS).
INSERT INTO public.modelo_servico_mo
  (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado, motivo_reprovacao)
SELECT m.tenant_id, m.id, NULL,
       COALESCE(NULLIF((m.custo_simulado->>'mao_obra')::numeric, 0), m.custo_terceirizados_previsto, 0),
       m.custo_terceirizados_aprovado,
       m.motivo_reprovacao_mao_obra
FROM public.modelos m
WHERE (
    COALESCE(NULLIF((m.custo_simulado->>'mao_obra')::numeric, 0), 0) > 0
    OR COALESCE(m.custo_terceirizados_previsto, 0) > 0
    OR m.custo_terceirizados_aprovado = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.modelo_servico_mo s
    WHERE s.modelo_id = m.id AND s.categoria_terceirizado_id IS NULL
  );

COMMIT;
```

Nota: o rollup/derive do flag e o trigger de permissão NÃO entram aqui — o backfill precisa gravar `aprovado` (true/false/null) sem o gate de permissão. Eles chegam nas Tasks 3 e 4 (ordem deliberada: permissão só passa a valer depois do backfill).

- [ ] **Step 4: Aplicar a migração e rodar os testes**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260806110000_modelo_servico_mo.sql
npm run test:int -- mo-por-servico
```
Expected: os 3 casos da Task 2 PASSAM (e os da Task 1 seguem passando). Reaplicar o `-f` não deve dar erro nem duplicar legado.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260806110000_modelo_servico_mo.sql tests/integration/mo-por-servico.test.ts
git commit -m "feat(mo): tabela modelo_servico_mo + RLS + backfill do legado"
```

---

### Task 3: Rollup derivado do flag + repontar custo_unitario + helper puro + teste anti-drift

**Files:**
- Create: `supabase/migrations/20260806120000_modelo_servico_mo_rollup.sql`
- Create: `src/lib/mao-obra.ts`
- Create: `tests/unit/mao-obra.test.ts`
- Test: `tests/integration/mo-por-servico.test.ts` (novo bloco de rollup)

**Interfaces:**
- Produces: helper SQL `public._mo_liberada(uuid) → boolean`. Trigger `trg_modelo_mo_flag BEFORE INSERT OR UPDATE ON modelos` (re-deriva `custo_terceirizados_aprovado`). Trigger `trg_modelo_servico_mo_rollup AFTER INSERT OR UPDATE OR DELETE ON modelo_servico_mo` (repinta o flag do modelo). `_custo_unitario_modelos_core.mao_obra_previsto` = Σ `modelo_servico_mo.valor`. Helpers TS puros em `src/lib/mao-obra.ts`: `moLiberada`, `estadoMO`, `somaAprovada`, `somaTotal` + tipo `MoLinha`.
- Consumes: `modelo_servico_mo` (Task 2). O trigger histórico `trg_enforce_maodeobra_aprovacao` é APOSENTADO aqui.

- [ ] **Step 1: Escrever o helper puro TS**

`src/lib/mao-obra.ts`:

```ts
/**
 * MO por serviço — helpers puros (espelham a lógica do rollup no banco).
 * `aprovado`: null = pendente / true / false. A regra de LIBERAÇÃO é a mesma do
 * trigger `_mo_liberada`: liberada = nenhuma linha com aprovado ≠ true (sem linha = liberada).
 */
export type MoLinha = {
  categoria_terceirizado_id: string | null;
  nome?: string | null;
  valor?: number | null;
  aprovado: boolean | null;
  motivo_reprovacao?: string | null;
};

/** Liberada p/ lançar? = nenhuma linha pendente/reprovada. Vazio = true. */
export function moLiberada(linhas: MoLinha[]): boolean {
  return !linhas.some((l) => l.aprovado !== true);
}

export type EstadoMO = "sem_servico" | "reprovada" | "pendente" | "aprovada";

/** Estado de exibição do modelo derivado das linhas (para o badge 3-estados). */
export function estadoMO(linhas: MoLinha[]): EstadoMO {
  if (linhas.length === 0) return "sem_servico";
  if (linhas.some((l) => l.aprovado === false)) return "reprovada";
  if (linhas.some((l) => l.aprovado == null)) return "pendente";
  return "aprovada";
}

/** Σ dos valores das linhas APROVADAS (aprovado === true). */
export function somaAprovada(linhas: MoLinha[]): number {
  return linhas.reduce((s, l) => s + (l.aprovado === true ? Number(l.valor) || 0 : 0), 0);
}

/** Σ de todos os valores (planejado total). */
export function somaTotal(linhas: MoLinha[]): number {
  return linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
}
```

- [ ] **Step 2: Escrever o teste unit do helper**

`tests/unit/mao-obra.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { moLiberada, estadoMO, somaAprovada, somaTotal, type MoLinha } from "@/lib/mao-obra";

const L = (aprovado: boolean | null, valor = 0): MoLinha => ({ categoria_terceirizado_id: "x", aprovado, valor });

describe("mao-obra helpers", () => {
  it("moLiberada: vazio = liberada", () => { expect(moLiberada([])).toBe(true); });
  it("moLiberada: todas true = liberada", () => { expect(moLiberada([L(true), L(true)])).toBe(true); });
  it("moLiberada: uma pendente = bloqueada", () => { expect(moLiberada([L(true), L(null)])).toBe(false); });
  it("moLiberada: uma reprovada = bloqueada", () => { expect(moLiberada([L(true), L(false)])).toBe(false); });

  it("estadoMO: sem linha", () => { expect(estadoMO([])).toBe("sem_servico"); });
  it("estadoMO: reprovada tem prioridade", () => { expect(estadoMO([L(true), L(false), L(null)])).toBe("reprovada"); });
  it("estadoMO: pendente antes de aprovada", () => { expect(estadoMO([L(true), L(null)])).toBe("pendente"); });
  it("estadoMO: todas aprovadas", () => { expect(estadoMO([L(true), L(true)])).toBe("aprovada"); });

  it("somaAprovada: só as aprovadas", () => { expect(somaAprovada([L(true, 10), L(false, 5), L(null, 7)])).toBe(10); });
  it("somaTotal: tudo", () => { expect(somaTotal([L(true, 10), L(false, 5), L(null, 7)])).toBe(22); });
});
```

- [ ] **Step 3: Rodar o teste unit (deve falhar — módulo inexistente)**

Run: `npm run test:unit -- mao-obra`
Expected: FAIL (Cannot find module `@/lib/mao-obra`) até o Step 1 estar salvo; após salvar o Step 1, deve PASSAR. (Se salvou o Step 1 antes, este step confirma PASS.)

- [ ] **Step 4: Escrever o teste de integração do rollup**

Adicionar bloco em `tests/integration/mo-por-servico.test.ts`:

```ts
describe.skipIf(!hasDb)("MO por serviço — Task 3: rollup derivado do flag", () => {
  async function novoModeloComLinhas(c: any, aprovados: (boolean | null)[]) {
    const m = await um<{ id: string }>(
      c, `insert into modelos (tenant_id, nome) values ($1,'M rollup') returning id`, [TENANT_TESTE],
    );
    for (let i = 0; i < aprovados.length; i++) {
      const cat = await um<{ id: string }>(
        c, `insert into categorias_terceirizado (tenant_id, nome, etapa)
            values ($1,$2,'ate_costura') returning id`, [TENANT_TESTE, `Serv rollup ${i} ${m.id.slice(0,8)}`],
      );
      await c.query(
        `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado)
         values ($1,$2,$3,10,$4)`, [TENANT_TESTE, m.id, cat.id, aprovados[i]],
      );
    }
    return m.id;
  }
  async function flag(c: any, id: string) {
    const r = await um<{ f: boolean }>(c, `select custo_terceirizados_aprovado as f from modelos where id=$1`, [id]);
    return r.f;
  }

  it("sem linha → flag true (sem serviço = liberada)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, []);
      expect(await flag(c, id)).toBe(true);
    });
  });
  it("todas aprovadas → flag true", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [true, true]);
      expect(await flag(c, id)).toBe(true);
    });
  });
  it("uma pendente → flag false", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [true, null]);
      expect(await flag(c, id)).toBe(false);
    });
  });
  it("uma reprovada → flag false; ao aprovar todas → volta true", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [true, false]);
      expect(await flag(c, id)).toBe(false);
      await c.query(`update modelo_servico_mo set aprovado=true where modelo_id=$1`, [id]);
      expect(await flag(c, id)).toBe(true);
      await c.query(`delete from modelo_servico_mo where modelo_id=$1`, [id]);
      expect(await flag(c, id)).toBe(true); // sem serviço = liberada
    });
  });
  it("flag é à prova de adulteração: UPDATE direto é re-derivado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [null]); // pendente → derivado false
      await c.query(`update modelos set custo_terceirizados_aprovado=true where id=$1`, [id]);
      expect(await flag(c, id)).toBe(false); // trigger BEFORE UPDATE re-derivou
    });
  });
  it("custo_unitario.mao_obra_previsto passou a somar modelo_servico_mo.valor", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c, `select position('modelo_servico_mo' in
              pg_get_functiondef('public._custo_unitario_modelos_core(uuid[])'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });
  it("enforce_maodeobra_aprovacao foi aposentado (trigger não existe mais)", async () => {
    await withTx(async (c) => {
      const r = await um<{ n: string }>(
        c, `select count(*) as n from pg_trigger where tgname='trg_enforce_maodeobra_aprovacao'`,
      );
      expect(Number(r.n)).toBe(0);
    });
  });
});
```

- [ ] **Step 5: Rodar o teste de integração (deve falhar — sem rollup)**

Run: `npm run test:int -- mo-por-servico`
Expected: FAIL nos casos da Task 3 (flag não deriva; trigger enforce ainda existe; core ainda usa `custo_terceirizados_previsto`).

- [ ] **Step 6: Escrever a migração do rollup**

`supabase/migrations/20260806120000_modelo_servico_mo_rollup.sql`:

```sql
-- MO por serviço — rollup derivado (2026-08-06). Torna custo_terceirizados_aprovado DERIVADO:
--   liberada = NOT EXISTS(linha do modelo com aprovado IS DISTINCT FROM true); sem linha = true.
-- Dois gatilhos: (M) BEFORE em modelos re-deriva o flag em qualquer write (à prova de adulteração);
-- (S) AFTER em modelo_servico_mo repinta o modelo. Aposenta trg_enforce_maodeobra_aprovacao
-- (o flag deixa de ser escrito pela UI; a permissão vira per-linha na Task 4). Repinta o
-- custo_unitario. Envolvido em BEGIN/COMMIT (troca de trigger + recompute de dado).
BEGIN;

-- Helper (invariante #9: REVOKE dos três).
CREATE OR REPLACE FUNCTION public._mo_liberada(_modelo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.modelo_servico_mo s
    WHERE s.modelo_id = _modelo_id AND s.aprovado IS DISTINCT FROM true
  );
$function$;
REVOKE EXECUTE ON FUNCTION public._mo_liberada(uuid) FROM PUBLIC, anon, authenticated;

-- (M) modelos: força o flag = derivado em todo INSERT/UPDATE (ignora o valor do cliente).
CREATE OR REPLACE FUNCTION public.fn_modelo_mo_flag_derivada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.custo_terceirizados_aprovado := public._mo_liberada(NEW.id);
  RETURN NEW;
END $function$;

-- (S) modelo_servico_mo: qualquer mudança de linha repinta o flag do modelo (dispara M).
CREATE OR REPLACE FUNCTION public.fn_modelo_servico_mo_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_modelo uuid := COALESCE(NEW.modelo_id, OLD.modelo_id);
BEGIN
  UPDATE public.modelos
     SET custo_terceirizados_aprovado = public._mo_liberada(v_modelo)
   WHERE id = v_modelo;
  RETURN COALESCE(NEW, OLD);
END $function$;

-- Aposenta o guard histórico (o flag não é mais escrito diretamente pela UI).
DROP TRIGGER IF EXISTS trg_enforce_maodeobra_aprovacao ON public.modelos;
DROP FUNCTION IF EXISTS public.enforce_maodeobra_aprovacao();

-- Instala os gatilhos.
DROP TRIGGER IF EXISTS trg_modelo_mo_flag ON public.modelos;
CREATE TRIGGER trg_modelo_mo_flag BEFORE INSERT OR UPDATE ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_mo_flag_derivada();

DROP TRIGGER IF EXISTS trg_modelo_servico_mo_rollup ON public.modelo_servico_mo;
CREATE TRIGGER trg_modelo_servico_mo_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.modelo_servico_mo
  FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_servico_mo_rollup();

-- Recompute único: só toca modelos cujo flag muda (evita ruído no audit_log). O trigger M
-- re-deriva na escrita; aqui filtramos pelas linhas que efetivamente vão mudar.
UPDATE public.modelos m
   SET custo_terceirizados_aprovado = public._mo_liberada(m.id)
 WHERE m.custo_terceirizados_aprovado IS DISTINCT FROM public._mo_liberada(m.id);

-- Repinta mao_obra_previsto no core do custo unitário: passa a somar modelo_servico_mo.valor.
-- (Só esta linha muda; o resto do core é idêntico ao atual — copiado na íntegra p/ CREATE OR REPLACE.)
CREATE OR REPLACE FUNCTION public._custo_unitario_modelos_core(_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  with cad_conf as (
    select distinct on (c.modelo_id) c.modelo_id, c.id as cad_id
    from cad c
    where c.tenant_id = v_tenant and c.enviado_corte
    order by c.modelo_id, c.data_enviado_corte desc nulls last
  ),
  mat as (
    select cc.modelo_id,
      coalesce((select sum(case when ct.custo_cad is not null then ct.custo_cad
          else coalesce(ct.consumo_cad,0) * (1 + coalesce(ct.loss_percent_cad,0)/100.0)
               * public._preco_tecido_por_metro(cc.modelo_id, ct.tipo, ct.numero, ct.artigo_id) end)
        from cad_tecidos ct where ct.cad_id = cc.cad_id), 0)
      + coalesce((select sum(coalesce(ca.consumo,0) * coalesce(av.preco,0))
        from cad_aviamentos ca left join aviamentos av on av.id = ca.aviamento_id where ca.cad_id = cc.cad_id), 0) + COALESCE((SELECT SUM(COALESCE(ce.consumo,0) * COALESCE(NULLIF((SELECT MAX(COALESCE(ve.preco,0)) FROM variantes_etiqueta ve WHERE ve.etiqueta_id = ce.etiqueta_id AND ve.cor_id IS NOT DISTINCT FROM ce.cor_id),0), (SELECT et.preco FROM etiquetas et WHERE et.id = ce.etiqueta_id), 0)) FROM cad_etiquetas ce WHERE ce.cad_id = cc.cad_id), 0) as materials,
      coalesce((select sum(coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0)
            - coalesce(pt.desconto_total,0) + coalesce(pt.multa_total,0))
        from producao_terceirizados pt where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false), 0) as servico_total,
      coalesce((select sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)) from cad_grades g where g.cad_id = cc.cad_id), 0) as grade
    from cad_conf cc
  )
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    'previsto', coalesce(m.custo_peca_previsto,0),
    'real', case when exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
              then coalesce((select materials + case when grade > 0 then servico_total / grade else 0 end
                             from mat where mat.modelo_id = m.id), 0)
                   + coalesce((select sum((c->>'valor')::numeric)
                              from jsonb_array_elements(coalesce(m.custos_adicionais,'[]'::jsonb)) c), 0)
              else coalesce(m.custo_peca_previsto,0)
            end,
    'mao_obra_previsto', coalesce((select sum(s.valor) from modelo_servico_mo s where s.modelo_id = m.id), 0),
    'mao_obra_real', coalesce((select case when grade > 0 then servico_total / grade else 0 end
                               from mat where mat.modelo_id = m.id), 0),
    'confirmado', exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
  )), '{}'::jsonb)
  into v_result
  from modelos m
  where m.tenant_id = v_tenant and m.id = any(_ids);

  return v_result;
end;
$function$;
-- Reassert do REVOKE (CREATE OR REPLACE preserva ACL, mas invariante #9 pede reassert).
REVOKE EXECUTE ON FUNCTION public._custo_unitario_modelos_core(uuid[]) FROM PUBLIC, anon, authenticated;

COMMIT;
```

- [ ] **Step 7: Aplicar a migração e diff-validar o core**

Run:
```bash
# diff-validação do core: pega a def ANTES (guardar), aplica, compara DEPOIS.
psql "$(cat /tmp/dburl.txt)" -tAc "select pg_get_functiondef('public._custo_unitario_modelos_core(uuid[])'::regprocedure)" > /tmp/core_antes.sql
psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260806120000_modelo_servico_mo_rollup.sql
psql "$(cat /tmp/dburl.txt)" -tAc "select pg_get_functiondef('public._custo_unitario_modelos_core(uuid[])'::regprocedure)" > /tmp/core_depois.sql
diff /tmp/core_antes.sql /tmp/core_depois.sql
# Verificar REVOKE dos três nos helpers/core:
psql "$(cat /tmp/dburl.txt)" -tAc "select has_function_privilege('anon','public._mo_liberada(uuid)','EXECUTE'), has_function_privilege('authenticated','public._mo_liberada(uuid)','EXECUTE')"
psql "$(cat /tmp/dburl.txt)" -tAc "select has_function_privilege('anon','public._custo_unitario_modelos_core(uuid[])','EXECUTE'), has_function_privilege('authenticated','public._custo_unitario_modelos_core(uuid[])','EXECUTE')"
```
Expected: o `diff` mostra APENAS a linha `mao_obra_previsto` mudada (de `custo_terceirizados_previsto` para o `sum(s.valor)`). Ambos `has_function_privilege` = `f|f`.

- [ ] **Step 8: Rodar todos os testes**

Run:
```bash
npm run test:unit -- mao-obra
npm run test:int -- mo-por-servico
npm run test:unit -- kanban-condicoes   # anti-drift: deve seguir VERDE (nenhuma chave mudou)
```
Expected: unit `mao-obra` PASS; integração Task 3 PASS; anti-drift do kanban PASS.

- [ ] **Step 9: Atualizar a `descricao` da chave `servico_aprovado` (doc-only no catálogo)**

Em `src/lib/kanban-condicoes.ts`, na entrada `servico_aprovado` (~l.60), atualizar só a `descricao` para refletir que é derivada (a KEY e o LABEL permanecem — o anti-drift não muda):

```ts
  { key: "servico_aprovado", label: "Aprovação de custo", modulo: "planejamento", secao: "s5", descricao: "custo_terceirizados_aprovado (derivado de modelo_servico_mo) = true" },
```

Run: `npm run test:unit -- kanban-condicoes` → PASS (mudou só texto de descrição).

- [ ] **Step 10: Build + commit**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo ok`
```bash
git add supabase/migrations/20260806120000_modelo_servico_mo_rollup.sql src/lib/mao-obra.ts \
        tests/unit/mao-obra.test.ts tests/integration/mo-por-servico.test.ts src/lib/kanban-condicoes.ts
git commit -m "feat(mo): flag derivado por trigger + repinta custo_unitario + helpers puros"
```

---

### Task 4: RPCs salvar/aprovar/resumo + trigger de permissão por linha

**Files:**
- Create: `supabase/migrations/20260806130000_modelo_servico_mo_rpcs.sql`
- Test: `tests/integration/mo-por-servico.test.ts` (novo bloco)

**Interfaces:**
- Produces:
  - Trigger `trg_enforce_servico_mo_aprovacao BEFORE INSERT OR UPDATE ON modelo_servico_mo` (gate `producao_servico_aprovacao`).
  - `salvar_modelo_servico_mo(_modelo_id uuid, _linhas jsonb) RETURNS void` — `_linhas = [{categoria_terceirizado_id: uuid|null, valor: numeric, observacoes: text|null}]`, estado COMPLETO (diff por categoria: upsert presentes, apaga ausentes; NUNCA toca `aprovado`).
  - `aprovar_servico_mo(_modelo_id uuid, _categoria_terceirizado_id uuid, _aprovado boolean, _motivo text) RETURNS void` — seta `aprovado`+`motivo_reprovacao` numa linha (categoria NULL = legado); `_motivo` obrigatório se `_aprovado=false`.
  - `modelo_mo_resumo(_ids uuid[]) RETURNS jsonb` — mapa `{modelo_id: {estado, total, total_aprovado, linhas:[{categoria_terceirizado_id, nome, valor, aprovado, motivo_reprovacao}]}}`. `valor`/`total`/`total_aprovado` = `null` quando `NOT _pode_ver_custos()`. Gate do wrapper: `_pode_ver_custos() OR user_can_edit('producao_servico_aprovacao')`, senão `'{}'`.
  - Cores `_salvar_modelo_servico_mo_core` / `_aprovar_servico_mo_core` / `_modelo_mo_resumo_core` com REVOKE dos três.
- Consumes: tabela + rollup das Tasks 2/3.

- [ ] **Step 1: Escrever o teste de integração das RPCs + permissão**

Adicionar bloco em `tests/integration/mo-por-servico.test.ts`:

```ts
describe.skipIf(!hasDb)("MO por serviço — Task 4: RPCs + permissão por linha", () => {
  it("salvar_modelo_servico_mo faz diff estado-completo (upsert + delete de ausentes)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1,'M rpc') returning id`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv rpc a','ate_costura') returning id`, [TENANT_TESTE]);
      const cat2 = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv rpc b','ate_costura') returning id`, [TENANT_TESTE]);
      await c.query(`select salvar_modelo_servico_mo($1, $2::jsonb)`, [m.id,
        JSON.stringify([{ categoria_terceirizado_id: cat.id, valor: 12 }, { categoria_terceirizado_id: cat2.id, valor: 8 }])]);
      let n = await um<{ n: string }>(c, `select count(*) as n from modelo_servico_mo where modelo_id=$1`, [m.id]);
      expect(Number(n.n)).toBe(2);
      // novo estado sem cat2 → cat2 é apagada; cat vira 20
      await c.query(`select salvar_modelo_servico_mo($1, $2::jsonb)`, [m.id,
        JSON.stringify([{ categoria_terceirizado_id: cat.id, valor: 20 }])]);
      n = await um<{ n: string }>(c, `select count(*) as n from modelo_servico_mo where modelo_id=$1`, [m.id]);
      expect(Number(n.n)).toBe(1);
      const v = await um<{ valor: string; aprovado: boolean | null }>(c, `select valor, aprovado from modelo_servico_mo where modelo_id=$1`, [m.id]);
      expect(Number(v.valor)).toBe(20);
      expect(v.aprovado).toBeNull(); // salvar nunca toca aprovado
    });
  });

  it("aprovar_servico_mo seta aprovado; reprovar exige motivo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1,'M ap') returning id`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv ap','ate_costura') returning id`, [TENANT_TESTE]);
      await c.query(`select salvar_modelo_servico_mo($1, $2::jsonb)`, [m.id, JSON.stringify([{ categoria_terceirizado_id: cat.id, valor: 5 }])]);
      await c.query(`select aprovar_servico_mo($1,$2,true,null)`, [m.id, cat.id]);
      let f = await um<{ f: boolean }>(c, `select custo_terceirizados_aprovado as f from modelos where id=$1`, [m.id]);
      expect(f.f).toBe(true);
      await expect(c.query(`select aprovar_servico_mo($1,$2,false,null)`, [m.id, cat.id])).rejects.toThrow(/motivo/i);
      await c.query(`select aprovar_servico_mo($1,$2,false,'valor alto')`, [m.id, cat.id]);
      f = await um<{ f: boolean }>(c, `select custo_terceirizados_aprovado as f from modelos where id=$1`, [m.id]);
      expect(f.f).toBe(false);
    });
  });

  it("trigger de permissão por linha: aprovar sem producao_servico_aprovacao → RAISE 42501", async () => {
    await withTx(async (c) => {
      const uid = "0a0a0a0a-0000-4000-8000-0000000000aa";
      await c.query(`insert into public.users (id, tenant_id, email) values ($1,$2,'noperm-mo@teste')
                     on conflict (id) do update set tenant_id=excluded.tenant_id`, [uid, TENANT_TESTE]);
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
      const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1,'M noperm') returning id`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv noperm','ate_costura') returning id`, [TENANT_TESTE]);
      // inserir linha pendente é permitido (aprovado null); mudar aprovado sem permissão RAISE.
      await c.query(`insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) values ($1,$2,$3,5)`, [TENANT_TESTE, m.id, cat.id]);
      await expect(
        c.query(`update modelo_servico_mo set aprovado=true where modelo_id=$1`, [m.id]),
      ).rejects.toThrow(/permiss/i);
    });
  });

  it("modelo_mo_resumo devolve estado + totais; cores com REVOKE dos três", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1,'M resumo') returning id`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv resumo','ate_costura') returning id`, [TENANT_TESTE]);
      await c.query(`select salvar_modelo_servico_mo($1, $2::jsonb)`, [m.id, JSON.stringify([{ categoria_terceirizado_id: cat.id, valor: 30 }])]);
      await c.query(`select aprovar_servico_mo($1,$2,true,null)`, [m.id, cat.id]);
      const r = await um<{ resumo: any }>(c, `select modelo_mo_resumo(array[$1]::uuid[]) as resumo`, [m.id]);
      const info = r.resumo[m.id];
      expect(info.estado).toBe("aprovada");
      expect(Number(info.total_aprovado)).toBe(30);
      const priv = await um<{ a: boolean; b: boolean }>(
        c, `select has_function_privilege('anon','public._modelo_mo_resumo_core(uuid[])','EXECUTE') as a,
                   has_function_privilege('authenticated','public._modelo_mo_resumo_core(uuid[])','EXECUTE') as b`,
      );
      expect(priv.a).toBe(false); expect(priv.b).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Rodar o teste (deve falhar — RPCs inexistentes)**

Run: `npm run test:int -- mo-por-servico`
Expected: FAIL nos casos da Task 4 (`function salvar_modelo_servico_mo(...) does not exist`, etc.).

- [ ] **Step 3: Escrever a migração das RPCs + trigger de permissão**

`supabase/migrations/20260806130000_modelo_servico_mo_rpcs.sql`:

```sql
-- MO por serviço — RPCs + gate de permissão por linha (2026-08-06).
-- Trigger de permissão espelha o antigo enforce_maodeobra_aprovacao, mas POR LINHA (invariante #12).
-- RPCs wrapper+core com REVOKE dos três (invariante #9). Erros PT via RAISE P0001/42501.
BEGIN;

-- Gate de aprovação por linha: mudar/definir `aprovado` exige producao_servico_aprovacao.
CREATE OR REPLACE FUNCTION public.enforce_servico_mo_aprovacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.aprovado IS NOT NULL AND NOT public.user_can_edit('producao_servico_aprovacao') THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/reprovar o custo de mão de obra' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.aprovado IS DISTINCT FROM OLD.aprovado AND NOT public.user_can_edit('producao_servico_aprovacao') THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/reprovar o custo de mão de obra' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_enforce_servico_mo_aprovacao ON public.modelo_servico_mo;
CREATE TRIGGER trg_enforce_servico_mo_aprovacao
  BEFORE INSERT OR UPDATE ON public.modelo_servico_mo
  FOR EACH ROW EXECUTE FUNCTION public.enforce_servico_mo_aprovacao();

-- salvar (VALOR livre; diff estado-completo; NUNCA toca aprovado) ----------------------------
CREATE OR REPLACE FUNCTION public._salvar_modelo_servico_mo_core(_modelo_id uuid, _linhas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_keep uuid[] := '{}';   -- categoria_terceirizado_id presentes (NULL não entra aqui)
  v_tem_legado boolean := false;
  r jsonb; v_cat uuid; v_valor numeric; v_obs text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido: as linhas de MO devem ser uma lista' USING ERRCODE = 'P0001';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(_linhas) LOOP
    v_cat := NULLIF(r->>'categoria_terceirizado_id','')::uuid;
    v_valor := COALESCE((r->>'valor')::numeric, 0);
    v_obs := NULLIF(r->>'observacoes','');
    IF v_cat IS NULL THEN
      v_tem_legado := true;
      UPDATE public.modelo_servico_mo
         SET valor = v_valor, observacoes = v_obs, updated_at = now()
       WHERE modelo_id = _modelo_id AND categoria_terceirizado_id IS NULL;
      IF NOT FOUND THEN
        INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, observacoes)
        VALUES (v_tenant, _modelo_id, NULL, v_valor, v_obs);
      END IF;
    ELSE
      -- a categoria tem que ser do tenant
      IF NOT EXISTS (SELECT 1 FROM public.categorias_terceirizado
                      WHERE id = v_cat AND tenant_id = v_tenant) THEN
        RAISE EXCEPTION 'Serviço inválido' USING ERRCODE = 'P0001';
      END IF;
      v_keep := array_append(v_keep, v_cat);
      UPDATE public.modelo_servico_mo
         SET valor = v_valor, observacoes = v_obs, updated_at = now()
       WHERE modelo_id = _modelo_id AND categoria_terceirizado_id = v_cat;
      IF NOT FOUND THEN
        INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, observacoes)
        VALUES (v_tenant, _modelo_id, v_cat, v_valor, v_obs);
      END IF;
    END IF;
  END LOOP;

  -- estado completo: apaga o que não veio no payload.
  DELETE FROM public.modelo_servico_mo
   WHERE modelo_id = _modelo_id
     AND categoria_terceirizado_id IS NOT NULL
     AND NOT (categoria_terceirizado_id = ANY(v_keep));
  IF NOT v_tem_legado THEN
    DELETE FROM public.modelo_servico_mo
     WHERE modelo_id = _modelo_id AND categoria_terceirizado_id IS NULL;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_modelo_servico_mo(_modelo_id uuid, _linhas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._salvar_modelo_servico_mo_core(_modelo_id, _linhas);
END $function$;

-- aprovar/reprovar por linha ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._aprovar_servico_mo_core(_modelo_id uuid, _categoria_terceirizado_id uuid, _aprovado boolean, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF _aprovado = false AND COALESCE(btrim(_motivo),'') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.modelo_servico_mo
     SET aprovado = _aprovado,
         motivo_reprovacao = CASE WHEN _aprovado THEN NULL ELSE _motivo END,
         updated_at = now()
   WHERE modelo_id = _modelo_id
     AND categoria_terceirizado_id IS NOT DISTINCT FROM _categoria_terceirizado_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha de mão de obra não encontrada.' USING ERRCODE = 'P0001';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.aprovar_servico_mo(_modelo_id uuid, _categoria_terceirizado_id uuid, _aprovado boolean, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._aprovar_servico_mo_core(_modelo_id, _categoria_terceirizado_id, _aprovado, _motivo);
END $function$;

-- resumo (leitura; valor mascarado se não pode ver custos) ------------------------------------
CREATE OR REPLACE FUNCTION public._modelo_mo_resumo_core(_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_ver boolean := public._pode_ver_custos();
  v_result jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    'estado',
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM modelo_servico_mo s WHERE s.modelo_id = m.id) THEN 'sem_servico'
        WHEN EXISTS (SELECT 1 FROM modelo_servico_mo s WHERE s.modelo_id = m.id AND s.aprovado = false) THEN 'reprovada'
        WHEN EXISTS (SELECT 1 FROM modelo_servico_mo s WHERE s.modelo_id = m.id AND s.aprovado IS NULL) THEN 'pendente'
        ELSE 'aprovada'
      END,
    'total', CASE WHEN v_ver THEN coalesce((SELECT sum(s.valor) FROM modelo_servico_mo s WHERE s.modelo_id = m.id), 0) ELSE NULL END,
    'total_aprovado', CASE WHEN v_ver THEN coalesce((SELECT sum(s.valor) FROM modelo_servico_mo s WHERE s.modelo_id = m.id AND s.aprovado = true), 0) ELSE NULL END,
    'linhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'categoria_terceirizado_id', s.categoria_terceirizado_id,
        'nome', COALESCE(ct.nome, 'Geral (legado)'),
        'valor', CASE WHEN v_ver THEN s.valor ELSE NULL END,
        'aprovado', s.aprovado,
        'motivo_reprovacao', s.motivo_reprovacao
      ) ORDER BY (s.categoria_terceirizado_id IS NOT NULL), ct.ordem, ct.nome)
      FROM modelo_servico_mo s
      LEFT JOIN categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
      WHERE s.modelo_id = m.id
    ), '[]'::jsonb)
  )), '{}'::jsonb)
  INTO v_result
  FROM modelos m
  WHERE m.tenant_id = v_tenant AND m.id = ANY(_ids);
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.modelo_mo_resumo(_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public._pode_ver_custos() OR public.user_can_edit('producao_servico_aprovacao')) THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN public._modelo_mo_resumo_core(_ids);
END $function$;

-- REVOKE dos três em TODOS os cores (invariante #9). Wrappers ficam com o EXECUTE default.
REVOKE EXECUTE ON FUNCTION public._salvar_modelo_servico_mo_core(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._aprovar_servico_mo_core(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._modelo_mo_resumo_core(uuid[]) FROM PUBLIC, anon, authenticated;

COMMIT;
```

- [ ] **Step 4: Aplicar + verificar REVOKE dos três**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260806130000_modelo_servico_mo_rpcs.sql
psql "$(cat /tmp/dburl.txt)" -tAc "
  select
    has_function_privilege('anon','public._salvar_modelo_servico_mo_core(uuid,jsonb)','EXECUTE'),
    has_function_privilege('authenticated','public._salvar_modelo_servico_mo_core(uuid,jsonb)','EXECUTE'),
    has_function_privilege('anon','public._aprovar_servico_mo_core(uuid,uuid,boolean,text)','EXECUTE'),
    has_function_privilege('authenticated','public._aprovar_servico_mo_core(uuid,uuid,boolean,text)','EXECUTE'),
    has_function_privilege('anon','public._modelo_mo_resumo_core(uuid[])','EXECUTE'),
    has_function_privilege('authenticated','public._modelo_mo_resumo_core(uuid[])','EXECUTE')"
```
Expected: seis `f`.

- [ ] **Step 5: Rodar os testes de integração**

Run: `npm run test:int -- mo-por-servico`
Expected: todos os blocos (Tasks 1-4) PASSAM.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260806130000_modelo_servico_mo_rpcs.sql tests/integration/mo-por-servico.test.ts
git commit -m "feat(mo): RPCs salvar/aprovar/resumo + gate de aprovação por linha"
```

---

### Task 5: Editor de MO por serviço no Planejamento

**Files:**
- Create: `src/components/planejamento/MaoObraEditor.tsx`
- Modify: `src/routes/_authenticated/criacao.planejamento.tsx` (imports; seção Simulação ~l.2040; seção Mão de obra ~l.2059-2109; card `ModeloCard` ~l.949/1038-1058; mutations `setMaoObra`/`setMaoObraDetalhe`; sim calc ~l.1408-1424; dirty snapshot; save ~l.1586)

**Interfaces:**
- Consumes: RPCs `salvar_modelo_servico_mo`, `aprovar_servico_mo`, `modelo_mo_resumo`; helpers `estadoMO`, `somaAprovada`, `somaTotal`, tipo `MoLinha` (`@/lib/mao-obra`); `custo_unitario_modelos.mao_obra_previsto` (agora Σ linhas).
- Produces: componente `<MaoObraEditor>` (interface abaixo); Planejamento passa a persistir MO por serviço.

- [ ] **Step 1: Criar o componente `MaoObraEditor`**

`src/components/planejamento/MaoObraEditor.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Check, X, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { brl } from "@/lib/format";
import type { MoLinha } from "@/lib/mao-obra";

export type MaoObraEditorLinha = MoLinha & { valor: number | null };
export type CategoriaServicoOpt = { id: string; nome: string; ativo?: boolean };

/**
 * Editor de MO POR SERVIÇO (Planejamento). VALOR é rascunho local (persiste no Salvar da página
 * via `onChangeLinhas`); Aprovar/Reprovar é imediato (`onAprovar`/`onReprovar`, gated no servidor).
 * A linha "Geral (legado)" tem `categoria_terceirizado_id = null` (some quando o usuário
 * adiciona serviços reais — o estado-completo do Salvar a apaga).
 */
export function MaoObraEditor({
  linhas, categorias, podeVerCustos, podeAprovar,
  onChangeLinhas, onAprovar, onReprovar,
}: {
  linhas: MaoObraEditorLinha[];
  categorias: CategoriaServicoOpt[];
  podeVerCustos: boolean;
  podeAprovar: boolean;
  onChangeLinhas: (linhas: MaoObraEditorLinha[]) => void;
  onAprovar: (categoriaId: string | null) => void;
  onReprovar: (categoriaId: string | null, motivo: string) => void;
}) {
  const [addSel, setAddSel] = useState<string>("");
  const [repro, setRepro] = useState<{ categoriaId: string | null } | null>(null);
  const [motivo, setMotivo] = useState("");

  const usados = useMemo(() => new Set(linhas.map((l) => l.categoria_terceirizado_id).filter(Boolean) as string[]), [linhas]);
  const disponiveis = categorias.filter((c) => c.ativo !== false && !usados.has(c.id));
  const nomeCat = (id: string | null) => id == null ? "Geral (legado)" : (categorias.find((c) => c.id === id)?.nome ?? "Serviço");

  const setValor = (id: string | null, v: number | null) =>
    onChangeLinhas(linhas.map((l) => (l.categoria_terceirizado_id === id ? { ...l, valor: v } : l)));
  const remover = (id: string | null) =>
    onChangeLinhas(linhas.filter((l) => l.categoria_terceirizado_id !== id));
  const adicionar = () => {
    if (!addSel) return;
    onChangeLinhas([...linhas, { categoria_terceirizado_id: addSel, valor: null, aprovado: null }]);
    setAddSel("");
  };

  return (
    <div className="grid gap-2">
      {linhas.length === 0 && <p className="text-xs text-muted-foreground">Nenhum serviço de mão de obra. Adicione abaixo.</p>}
      {linhas.map((l) => {
        const id = l.categoria_terceirizado_id;
        const estado = l.aprovado === true ? "aprovada" : l.aprovado === false ? "reprovada" : "pendente";
        return (
          <div key={id ?? "legado"} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <span className="min-w-[8rem] flex-1 truncate text-sm font-medium">{nomeCat(id)}</span>
            {podeVerCustos && (
              <div className="w-32">
                <NumberInput value={l.valor ?? ""} onChange={(e) => { const v = e.target.value; setValor(id, v === "" ? null : Number(v)); }} placeholder="R$" />
              </div>
            )}
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              estado === "aprovada" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : estado === "reprovada" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}>
              {estado === "aprovada" ? <Check className="h-3 w-3" /> : estado === "reprovada" ? <X className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {estado}
            </span>
            {l.aprovado === false && l.motivo_reprovacao && (
              <span className="w-full text-xs text-red-700 dark:text-red-300">Motivo: {l.motivo_reprovacao}</span>
            )}
            {podeAprovar && (
              <span className="ml-auto flex shrink-0 gap-1">
                <Button type="button" variant="outline" size="iconSm" aria-label="Aprovar" title="Aprovar" className="text-emerald-700" onClick={() => onAprovar(id)}><Check className="h-4 w-4" /></Button>
                <Button type="button" variant="outline" size="iconSm" aria-label="Reprovar" title="Reprovar" className="text-red-700" onClick={() => { setMotivo(""); setRepro({ categoriaId: id }); }}><X className="h-4 w-4" /></Button>
              </span>
            )}
            <Button type="button" variant="ghost" size="iconSm" aria-label="Remover" title="Remover" onClick={() => remover(id)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        );
      })}
      {disponiveis.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-1">
            <Label className="text-xs">Adicionar serviço</Label>
            <Select value={addSel} onValueChange={setAddSel}>
              <SelectTrigger><SelectValue placeholder="Selecione um serviço…" /></SelectTrigger>
              <SelectContent>
                {disponiveis.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!addSel} onClick={adicionar}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
        </div>
      )}
      {podeVerCustos && linhas.length > 0 && (
        <p className="text-xs text-muted-foreground">Total aprovado: {brl(linhas.reduce((s, l) => s + (l.aprovado === true ? Number(l.valor) || 0 : 0), 0))}</p>
      )}

      <AlertDialog open={!!repro} onOpenChange={(o) => !o && setRepro(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reprovar mão de obra</AlertDialogTitle>
            <AlertDialogDescription>Diga o motivo — ele aparece na linha do serviço.</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea className="min-h-[80px] w-full rounded border bg-background px-2 py-1.5 text-sm max-md:text-base"
            value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: valor acima do previsto; refazer a cotação." />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={!motivo.trim()} onClick={(e) => { e.preventDefault(); if (motivo.trim() && repro) { onReprovar(repro.categoriaId, motivo.trim()); setRepro(null); } }}>Reprovar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

Nota de tipos: confirme os caminhos reais de `NumberInput` (o arquivo Planejamento importa `NumberInput` — reuse o mesmo import) e o `size="iconSm"` (padrão de tabela compacta do repo). Se `size="iconSm"` não existir no `Button`, use `size="icon"` com `className="h-8 w-8"`.

- [ ] **Step 2: Fiar as queries de resumo + categorias ativas no detalhe do Planejamento**

Em `src/routes/_authenticated/criacao.planejamento.tsx`, dentro do componente de detalhe (`ModeloDialog`, onde vivem `custoData`/`setMaoObraDetalhe`), adicionar imports no topo:

```ts
import { MaoObraEditor, type MaoObraEditorLinha } from "@/components/planejamento/MaoObraEditor";
import { estadoMO, type MoLinha } from "@/lib/mao-obra";
```

Adicionar as queries (queryKeys próprias):

```ts
  const { data: catsServico = [] } = useQuery({
    queryKey: ["cats-servico-ativas"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("categorias_terceirizado") as any)
        .select("id, nome, ativo").order("ordem").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; ativo: boolean }[];
    },
  });
  const { data: moResumo } = useQuery({
    queryKey: ["mo-resumo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data as any)?.[modeloId] ?? null) as
        { estado: string; total: number | null; total_aprovado: number | null; linhas: (MoLinha & { valor: number | null })[] } | null;
    },
  });
```

Manter o rascunho local das linhas de MO (VALOR editável) fora do `draft` principal (persiste no Salvar). Adicionar estado + seed a partir do resumo:

```ts
  const [moLinhas, setMoLinhas] = useState<MaoObraEditorLinha[]>([]);
  const [moLinhasBase, setMoLinhasBase] = useState<MaoObraEditorLinha[]>([]);
  useEffect(() => {
    const seed = (moResumo?.linhas ?? []).map((l) => ({
      categoria_terceirizado_id: l.categoria_terceirizado_id ?? null,
      nome: l.nome, valor: l.valor ?? null, aprovado: l.aprovado ?? null, motivo_reprovacao: l.motivo_reprovacao ?? null,
    })) as MaoObraEditorLinha[];
    setMoLinhas(seed); setMoLinhasBase(seed);
  }, [moResumo]);
```

- [ ] **Step 3: Substituir o input de MO da Simulação por leitura (Σ linhas)**

Na seção "Simulação de custo" (~l.2040-2046), trocar o `<NumberInput>` de "Mão de obra (R$)" por um campo read-only, e ajustar o cálculo. Substituir o bloco:

```tsx
              <div className="grid gap-1">
                <Label>Mão de obra (R$)</Label>
                <div className="h-9 px-3 flex items-center rounded-md border bg-muted text-sm tabular-nums">
                  {maoObraDev > 0 ? brl(maoObraDev) : "—"}
                </div>
              </div>
```

E no cálculo (~l.1410-1424), remover o override de `custo_simulado.mao_obra` (fica inerte, spec §5): `maoObraUsado` passa a ser só `maoObraDev` (que agora é Σ linhas via `custo_unitario_modelos.mao_obra_previsto`):

```ts
  const maoObraDev = Number((custoData as any)?.mao_obra_previsto) || 0;
  const maoObraUsado = maoObraDev > 0 ? maoObraDev : null;
```
(remover `maoObraOverride` e o `mao_obra:` do `setSim`; `limparCustoSim` pode manter o campo, que fica sempre ausente/inerte.)

- [ ] **Step 4: Substituir a seção "Mão de obra" (aprovação única) pelo editor por serviço**

Substituir todo o bloco `<Secao titulo="Mão de obra">…</Secao>` + o `<AlertDialog open={reproOpen}>` (~l.2059-2109) por:

```tsx
          {(podeVerCustos || (isEdit && podeAprovarMaoObra)) && (
            <Secao titulo="Mão de obra">
              <MaoObraEditor
                linhas={moLinhas}
                categorias={catsServico}
                podeVerCustos={podeVerCustos}
                podeAprovar={isEdit && podeAprovarMaoObra}
                onChangeLinhas={(ls) => setMoLinhas(ls)}
                onAprovar={(catId) => aprovarServicoMO.mutate({ categoriaId: catId, aprovado: true })}
                onReprovar={(catId, motivo) => aprovarServicoMO.mutate({ categoriaId: catId, aprovado: false, motivo })}
              />
              {podeVerCustos && (
                <div className="mt-3">
                  <ObsMaoObraField
                    value={draft.observacoes_mao_obra}
                    onChange={(v) => setDraftTracked({ ...draft, observacoes_mao_obra: v })}
                  />
                </div>
              )}
            </Secao>
          )}
```

Remover `setMaoObraDetalhe`, `reproOpen`, `reproMotivo`, `maoObraPendente`, e a query `["plan-mao-obra-aprov", modeloId]` (o estado vem de `moResumo` agora — computar `const maoObraAprov = !moResumo || moResumo.estado === "sem_servico" || moResumo.estado === "aprovada"` para o gate do botão Lançar, que precisa de boolean liberada). Ajustar onde `maoObraAprov`/`maoObraPendente` eram usados no gate de Lançamento para usar `moResumo?.estado`. Adicionar a mutation de aprovação:

```ts
  const aprovarServicoMO = useMutation({
    mutationFn: async ({ categoriaId, aprovado, motivo }: { categoriaId: string | null; aprovado: boolean; motivo?: string }) => {
      const { error } = await supabase.rpc("aprovar_servico_mo" as any, {
        _modelo_id: modeloId, _categoria_terceirizado_id: categoriaId, _aprovado: aprovado, _motivo: motivo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mão de obra atualizada.");
      qc.invalidateQueries({ queryKey: ["mo-resumo", modeloId] });
      qc.invalidateQueries({ queryKey: ["plan-custo-unit", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["mo-resumo-list"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Não foi possível atualizar a mão de obra.")),
  });
```

- [ ] **Step 5: Persistir os VALORES no Salvar da página + incluir no dirty snapshot**

No `save` mutation (~l.1586), depois do UPDATE de `modelos` (após o bloco `if (isEdit && modeloId) { … }`), chamar a RPC de salvar as linhas:

```ts
        // MO por serviço: persiste os VALORES (aprovação já foi imediata). Estado completo.
        const { error: moErr } = await supabase.rpc("salvar_modelo_servico_mo" as any, {
          _modelo_id: modeloId,
          _linhas: moLinhas.map((l) => ({
            categoria_terceirizado_id: l.categoria_terceirizado_id,
            valor: Number(l.valor) || 0,
            observacoes: null,
          })),
        });
        if (moErr) throw moErr;
```

No `onSuccess` do save, invalidar `["mo-resumo", modeloId]`, `["plan-custo-unit", modeloId]` e `["mo-resumo-list"]`. Incluir `moLinhas` no snapshot de `useDirtySnapshot` para o `useUnsavedGuard` detectar valores de MO não salvos: a chamada atual (l.1275) é `const { dirty, markClean, reset: resetDraftBaseline } = useDirtySnapshot(draft);` — troque o argumento para `useDirtySnapshot({ draft, moLinhas })` (o hook deriva `dirty` sozinho comparando o snapshot; NÃO existe `markDirty`). Assim `dirty` acende quando `draft` OU `moLinhas` divergem do baseline; após o Salvar, o `reset`/`markClean` existente re-baseia o snapshot inteiro (incluindo `moLinhas`). `moLinhasBase` (Step 2) é opcional — só para exibir "voltar ao servidor"; a detecção de dirty vem do snapshot.

- [ ] **Step 6: Card `ModeloCard` — badge derivado do resumo, sem botões de aprovar**

No componente pai (lista), adicionar uma query de resumo para todos os ids visíveis:

```ts
  const { data: moResumoLista } = useQuery({
    queryKey: ["mo-resumo-list", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: modeloIdsAll });
      if (error) throw error;
      return (data ?? {}) as Record<string, { estado: string; total: number | null; total_aprovado: number | null }>;
    },
  });
```

Passar a `ModeloCard` uma prop `moEstado: string | null` (`moResumoLista?.[m.id]?.estado ?? null`) no lugar de `maoObraAprovado`, e remover `onAprovar`/`onReprovar` do card (a aprovação agora é só no detalhe). No render do badge (~l.1041-1058), trocar `maoObraAprovado === true/false` por:

```tsx
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                moEstado === "aprovada" || moEstado === "sem_servico" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                : moEstado === "reprovada" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}>
                {moEstado === "aprovada" || moEstado === "sem_servico" ? <Check className="h-3 w-3" /> : moEstado === "reprovada" ? <X className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                MO {moEstado === "sem_servico" ? "—" : moEstado === "aprovada" ? "aprovada" : moEstado === "reprovada" ? "reprovada" : "pendente"}
              </span>
```

Remover a mutation `setMaoObra` (card) e o `<Dialog>`/estado `reprova`/`reprovaMotivo` de reprovação do CARD (~l.232-251, ~l.903-940) e os handlers `onAprovar`/`onReprovar` passados a `ModeloCard` (~l.554-555). O botão Lançar do card continua igual (usa `lancStatus`, derivado do flag do modelo, inalterado).

- [ ] **Step 7: Build + tsc**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo ok`
Expected: build OK; nenhum TS2304. Corrigir imports/props que sobraram das remoções.

- [ ] **Step 8: Verificação manual (fluxo)**

Run: `npm run dev` e abrir um card no Planejamento:
- Adicionar 2 serviços com valor; Salvar → recarregar → valores persistem; badge do card = "pendente"; botão Lançar cinza.
- Aprovar os 2 no editor → badge do card vira "aprovada" (verde); Lançar habilita (se CQ liberado).
- Reprovar 1 (com motivo) → badge "reprovada"; Lançar desabilita. Motivo aparece na linha.
- Sem permissão `producao_servico_aprovacao`: os botões Aprovar/Reprovar somem; valores editáveis só com `podeVerCustos`.

- [ ] **Step 9: Commit**

```bash
git add src/components/planejamento/MaoObraEditor.tsx src/routes/_authenticated/criacao.planejamento.tsx
git commit -m "feat(mo): editor de MO por serviço no Planejamento (valor + aprovação por linha)"
```

---

### Task 6: Card "MO Aprovada" no PCP lê a MO planejada aprovada

**Files:**
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx` (card "MO Aprovada" ~l.866-881; adicionar query `modelo_mo_resumo`)

**Interfaces:**
- Consumes: RPC `modelo_mo_resumo` (Task 4). Gate do card já é `podeVerPrecos = canView("producao_terceirizados:precos")` (∈ `_pode_ver_custos`).
- Produces: card mostra Σ MO planejada aprovada + detalhe por serviço; card "Custo real (c/ serviço)/peça" segue inalterado.

- [ ] **Step 1: Adicionar a query de resumo**

Em `src/routes/_authenticated/pcp.servicos.$modeloId.tsx`, adicionar (perto das outras queries do modelo):

```ts
  const { data: moResumo } = useQuery({
    queryKey: ["pcp-mo-resumo", modeloId],
    enabled: !!modeloId && podeVerPrecos,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data as any)?.[modeloId] ?? null) as
        { estado: string; total: number | null; total_aprovado: number | null;
          linhas: { categoria_terceirizado_id: string | null; nome: string; valor: number | null; aprovado: boolean | null }[] } | null;
    },
  });
  const moTotalAprovado = Number(moResumo?.total_aprovado) || 0;
  const moEstado = moResumo?.estado ?? null;
```

Confirmar que `modeloId` está disponível nesse escopo (a rota é `pcp.servicos.$modeloId`; use o mesmo id já usado nas outras queries).

- [ ] **Step 2: Trocar o conteúdo do card "MO Aprovada"**

Substituir o bloco do card (~l.866-881) por leitura da MO planejada aprovada + tooltip com o detalhe por serviço:

```tsx
        {podeVerPrecos && (
        <div>
          {/* MO Aprovada = MO PLANEJADA aprovada (Σ modelo_servico_mo.valor onde aprovado=true),
              com detalhe por serviço. Distinto do "Custo real (c/ serviço)/peça" (blocos executados). */}
          <Label className="text-xs text-muted-foreground">MO Aprovada (planejada)</Label>
          <div
            className={`mt-1 text-sm font-bold ${moEstado === "aprovada" ? "text-emerald-600" : moEstado === "reprovada" ? "text-destructive" : "text-foreground"}`}
            title={(moResumo?.linhas ?? []).map((l) => `${l.nome}: ${brl(Number(l.valor) || 0)} — ${l.aprovado === true ? "aprovada" : l.aprovado === false ? "reprovada" : "pendente"}`).join("\n") || "Sem serviços de mão de obra"}
          >
            {brl(moTotalAprovado)}
          </div>
          <div className={`text-xs ${moEstado === "aprovada" ? "text-emerald-600" : moEstado === "reprovada" ? "text-destructive" : moEstado === "sem_servico" ? "text-muted-foreground" : "text-amber-600"}`}>
            {moEstado === "aprovada" ? "✓ aprovada" : moEstado === "reprovada" ? "reprovada" : moEstado === "sem_servico" ? "sem serviços" : "aprovação pendente"}
          </div>
          {(moResumo?.linhas ?? []).length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {(moResumo?.linhas ?? []).map((l) => (
                <li key={l.categoria_terceirizado_id ?? "legado"} className="flex justify-between gap-2">
                  <span className="truncate">{l.nome}</span>
                  <span className={`shrink-0 ${l.aprovado === true ? "text-emerald-600" : l.aprovado === false ? "text-destructive" : "text-amber-600"}`}>{brl(Number(l.valor) || 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
```

O card "Custo real (c/ serviço) / peça" (~l.852-865) e `servicoTotal`/`servicoPorPeca` (blocos executados) permanecem inalterados.

- [ ] **Step 3: Build + tsc**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304 || echo ok`
Expected: build OK; nenhum TS2304.

- [ ] **Step 4: Verificação manual**

Run: abrir um modelo no PCP > Serviços com MO planejada aprovada: o card "MO Aprovada (planejada)" mostra Σ das linhas aprovadas + lista por serviço; um modelo com linha pendente mostra "aprovação pendente"; usuário sem `producao_terceirizados:precos` não vê o card.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/pcp.servicos.\$modeloId.tsx
git commit -m "feat(mo): card MO Aprovada no PCP lê a MO planejada aprovada por serviço"
```

---

### Task 7: Docs, invariantes e verificação final

**Files:**
- Modify: `CLAUDE.md` (invariante #8, #12, bloco "Motor de regras do kanban")
- Modify: `docs/mapeamento-campos-calculos.md`
- Modify: memória do projeto (`/Users/sunglee/.claude/projects/-Users-sunglee-PLM---Cria--o/memory/MEMORY.md` + arquivo novo `project_mo_por_servico.md`)

**Interfaces:**
- Consumes: tudo das Tasks 1-6.
- Produces: documentação alinhada + verificação de suíte cheia.

- [ ] **Step 1: Atualizar invariante #8 (aprovação de mão de obra)**

Em `CLAUDE.md`, invariante #8: trocar a descrição do flag único por: `custo_terceirizados_aprovado` agora é **DERIVADO** por trigger (`fn_modelo_mo_flag_derivada` BEFORE em `modelos` + `fn_modelo_servico_mo_rollup` AFTER em `modelo_servico_mo`) da tabela `modelo_servico_mo` (1 linha por modelo×serviço; `categoria_terceirizado_id` NULL = "Geral (legado)"). `liberada = NOT EXISTS(linha aprovado IS DISTINCT FROM true)`; sem linha = liberada. `lancar_modelo`/kanban seguem lendo o flag `COALESCE(flag,false)`. `custo_unitario_modelos.mao_obra_previsto` = Σ `modelo_servico_mo.valor`. A coluna vira boolean derivado (não mais 3-estados no modelo — pendência é por linha).

- [ ] **Step 2: Atualizar invariante #12 (permissão + trigger de aprovação)**

Em `CLAUDE.md`, invariante #12: registrar que `trg_enforce_maodeobra_aprovacao`/`enforce_maodeobra_aprovacao` foram **APOSENTADOS**; a permissão `producao_servico_aprovacao` agora é enforçada **por linha** por `trg_enforce_servico_mo_aprovacao`/`enforce_servico_mo_aprovacao` em `modelo_servico_mo` (RAISE 42501 ao mudar/definir `aprovado` sem `user_can_edit`). O flag do modelo é à prova de adulteração via `fn_modelo_mo_flag_derivada` (re-deriva em todo UPDATE de `modelos`, ignorando input do cliente). `modelo_mo_resumo` é gated por `_pode_ver_custos() OR user_can_edit('producao_servico_aprovacao')` e mascara o `valor` quando não pode ver custos.

- [ ] **Step 3: Atualizar o bloco do kanban**

Em `CLAUDE.md`, no bloco "Motor de regras do kanban", ajustar a nota da condição `servico_aprovado`: continua lendo `coalesce(modelos.custo_terceirizados_aprovado,false)`, mas o flag é agora **derivado de `modelo_servico_mo`** (nenhuma chave nova; catálogo+RPC+anti-drift inalterados).

- [ ] **Step 4: Atualizar `docs/mapeamento-campos-calculos.md`**

Adicionar a tabela `modelo_servico_mo` (colunas + FK RESTRICT + índice parcial do legado), a fórmula do rollup (`_mo_liberada`), a mudança de `custo_unitario_modelos.mao_obra_previsto` (Σ `modelo_servico_mo.valor`), o toggle `categorias_terceirizado.ativo` (soft-hide), e marcar como INERTES (não dropados): `modelos.custo_simulado.mao_obra`, `modelos.custo_terceirizados_previsto`, `modelos.motivo_reprovacao_mao_obra` (rodada destrutiva futura — YAGNI). `observacoes_mao_obra` segue vivo.

- [ ] **Step 5: Atualizar a memória do projeto**

Criar `project_mo_por_servico.md` na pasta de memória e adicionar a linha-índice no `MEMORY.md` (padrão dos outros itens): resumo de 1 linha — `modelo_servico_mo` (MO por serviço, legado NULL); flag derivado por trigger; permissão por linha; RPCs `salvar_modelo_servico_mo`/`aprovar_servico_mo`/`modelo_mo_resumo`; toggle `categorias_terceirizado.ativo`; migrações `20260806100000`..`130000`.

- [ ] **Step 6: Rodar a suíte cheia + build final**

Run:
```bash
npm test                 # unit + integração (mao-obra, mo-por-servico, kanban anti-drift, etc.)
npm run build
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"
```
Expected: testes VERDES (incl. o anti-drift do kanban sem mudança de chaves); build OK; sem TS2304.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/mapeamento-campos-calculos.md
git commit -m "docs(mo): invariantes #8/#12 + kanban + mapeamento para MO por serviço"
```
(A memória em `~/.claude/...` é fora do repo — atualizar separadamente, não entra no commit.)

---

## Self-Review

**1. Spec coverage:**
- §1a toggle de serviço (soft-hide) → Task 1 (coluna `ativo` + `AttributeTab.toggleField` + filtro nos botões do PCP). ✓
- §1b tabela `modelo_servico_mo` (colunas, UNIQUE, índice parcial, RLS, FK RESTRICT) → Task 2. ✓ (updated_at incluído; `set_tenant_id` incluído.)
- §2 editor por serviço no Planejamento (dropdown só ativos, oculta usados; linha valor+estado+aprovar/reprovar+remover; reprovar exige motivo; obs geral segue; RPCs dedicadas, diff por categoria) → Task 5 (`MaoObraEditor` + wiring). ✓
- §3 flag DERIVADO por trigger (fórmula liberada), consumidores inalterados, `custo_unitario.mao_obra_previsto` = Σ valor, consequência assumida → Task 3. ✓
- §4 card PCP "MO Aprovada" = MO planejada aprovada + detalhe por serviço, card real inalterado → Task 6. ✓
- §5 migração idempotente BEGIN/COMMIT com backfill "Geral (legado)" preservando valor+estado; recompute; legado substituível; colunas antigas inertes → Task 2 (backfill) + Task 3 (recompute). ✓
- §Segurança/invariantes: RLS por tenant, trigger de aprovação gated (#12), RPCs wrapper+core REVOKE dos três (#9), FK RESTRICT, toggle soft-hide → Tasks 2/3/4. ✓
- §Testes: integração (aprovar todas→true; pendente/reprovada→false; sem linha→true; aprovar sem permissão→RAISE; migração legado; toggle esconde) + unit (helper rollup + Σ aprovada) → Tasks 1-4 (integração) + Task 3 (unit). ✓
- §Fora de escopo (aprovação em lote, histórico, dropar colunas, MO por variante, integração Financeiro) — não implementados. ✓

**2. Placeholder scan:** todos os steps de código têm SQL/TSX reais; sem "TBD"/"add error handling"/"similar to Task N". A cópia integral de `_custo_unitario_modelos_core` (Task 3) é o corpo real verificado no banco, mudando só a linha `mao_obra_previsto`. Os locais aproximados no `criacao.planejamento.tsx` citam linhas exatas verificadas (l.232, 241, 1367, 1413, 1458, 1586, 2040, 2059).

**3. Type consistency:**
- `MoLinha` (`src/lib/mao-obra.ts`) usado em `MaoObraEditor` (`MaoObraEditorLinha = MoLinha & {valor}`), no resumo do Planejamento e do PCP — mesmo shape (`categoria_terceirizado_id`, `nome`, `valor`, `aprovado`, `motivo_reprovacao`). ✓
- RPC nomes idênticos em migração, testes e front: `salvar_modelo_servico_mo(_modelo_id, _linhas)`, `aprovar_servico_mo(_modelo_id, _categoria_terceirizado_id, _aprovado, _motivo)`, `modelo_mo_resumo(_ids)`. ✓
- `estado` ∈ {`sem_servico`,`reprovada`,`pendente`,`aprovada`} consistente entre `estadoMO` (TS), `_modelo_mo_resumo_core` (SQL) e os badges (Tasks 5/6). ✓
- Triggers/funcs nomeados de forma única e consistente entre migração e testes: `_mo_liberada`, `fn_modelo_mo_flag_derivada`/`trg_modelo_mo_flag`, `fn_modelo_servico_mo_rollup`/`trg_modelo_servico_mo_rollup`, `enforce_servico_mo_aprovacao`/`trg_enforce_servico_mo_aprovacao`. ✓
- Índice `ux_msm_legado` e constraint `modelo_servico_mo_categoria_terceirizado_id_fkey` referenciados igualmente em migração e testes. ✓

**Correções aplicadas inline durante o self-review:**
- Ordem das migrações garante que o backfill (Task 2) grave `aprovado` ANTES do trigger de permissão (Task 4) existir — senão o gate `producao_servico_aprovacao` bloquearia o backfill (o psql roda sem `auth.uid()` → `user_can_edit=false`). Documentado na nota da Task 2 Step 3.
- O recompute do flag (Task 3) só é possível porque `trg_enforce_maodeobra_aprovacao` é DROPADO na MESMA migração ANTES do `UPDATE modelos` — senão o enforce histórico (BEFORE UPDATE) bloquearia o recompute. Confirmado na ordem do arquivo `20260806120000`.
- O trigger `fn_modelo_mo_flag_derivada` (BEFORE em `modelos`) torna o flag à prova de adulteração (substitui a garantia do enforce dropado); coberto pelo teste "flag é à prova de adulteração" (Task 3). ✓
- Gate de leitura do `modelo_mo_resumo` (`_pode_ver_custos OR user_can_edit`) espelha exatamente a superfície do badge de MO no card (`podeVerCustos || podeAprovarMaoObra`), evitando que um aprovador-sem-custos perca o editor. ✓
