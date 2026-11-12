# F6 Fluxo 2 — Requisitos configuráveis do "Enviar à Explosão" (Bloco B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à loja um editor (reusando o `RequisitosStatusButton` que já existe) para configurar condições extras que o "Enviar à Explosão" passa a exigir, com recusa REAL no banco e a lista no botão do front.

**Architecture:** Nova coluna jsonb `tenant_config.explosao_requisitos` (lista de cond_keys em E). O gate no banco vive em `_enviar_modelo_para_cad_core` (migration VIVA `20261103181000`), logo APÓS o gate de etapa existente: se a lista não é vazia, chama `_avaliar_condicoes_kanban_core(tenant, ARRAY[modelo_id]) -> modelo_id` e recusa com RAISE ASCII P0001 quando falta condição. O front (`pendenciasEnvioExplosao`) SOMA as configuradas à lista fixa de hoje. Tudo OPT-IN: lista vazia = comportamento de hoje, em ambos os lados.

**Tech Stack:** Postgres 17 (migration aditiva + `salvar_config_loja` CAS por coluna), React+TS+TanStack, `kanban-condicoes.ts` (catálogo/avaliador reusados).

**Spec:** `docs/superpowers/specs/2026-11-11-f6-etapas-pl-requisitos-design.md` (Bloco B).

## Global Constraints

- **Branch ATIVA:** `feature/plan-tecido-a1` (NÃO criar branch nova; deploy único do F6 no fim, com Fluxo 1, Fluxo 3 e F8).
- **OPT-IN puro:** `explosao_requisitos` vazio (`[]`) = banco e front idênticos a hoje. Config vazia NUNCA recusa.
- **Gate no banco SÓ dos configurados** (decisão do dono 12/nov): o banco recusa apenas pelas condições em `explosao_requisitos`. A lista fixa de hoje (REF/nome/estilista/categoria/tecido/grade/datas) segue SÓ no front, como hoje.
- **Config SOMA à lista fixa no front** (decisão do dono 12/nov): a lista fixa de hoje continua obrigatória; as configuradas são pendências EXTRAS somadas.
- **RAISE 5xx só ASCII:** todo `RAISE … USING ERRCODE` que o PostgREST devolve como 5xx tem de ter mensagem SÓ ASCII. O prefixo da nova recusa é `explosao_requisito_faltando:` (ASCII), ERRCODE P0001 (400, traduzido por `erro-mensagem.ts`).
- **Migration aditiva, NÃO destrutiva:** `ADD COLUMN IF NOT EXISTS … DEFAULT '[]'`. Guarda md5 ANTES/DEPOIS das funções redefinidas (`salvar_config_loja`, `_enviar_modelo_para_cad_core`), pós-condições de ACL. Rollback: `_down` neutraliza (CREATE OR REPLACE, sem trava); `_down_drop` separado em `supabase/rollback/`.
- **Banco ANTES do site:** o front novo lê `explosao_requisitos` e a recusa nova; com banco velho a coluna não existe (a query cai no default `[]` = opt-in, inofensivo), mas o gate novo não existe → publicar banco primeiro.
- **Testes DDL só na cópia LOCAL** (Docker PG17.6, `/tmp/dburl-local.txt`), txn revertida; NUNCA DDL em produção fora do kit.
- **`_core` DEFINER com REVOKE dos 3** mantido; o servidor chama o `_core`, o front chama o wrapper `enviar_modelo_para_cad`.
- **Reuso, não motor novo:** catálogo `kanban-condicoes.ts` + avaliador `_avaliar_condicoes_kanban_core` + editor `RequisitosStatusButton`. Condição nova = key no catálogo + branch na RPC + anti-drift — mas este Fluxo NÃO adiciona condição nova (reusa as existentes), então o anti-drift `kanban-condicoes.test.ts` não muda.

## Review Focus

- **Config vazia recusa por engano:** lista `[]`/ausente deve pular TODO o gate novo (banco e front). Pinado no teste de integração da Task 3 ("opt-in vazio não recusa") e no unit da Task 4 ("sem requisitos configurados = lista fixa inalterada").
- **Condição de módulo desligado trava o envio:** uma cond configurada cujo módulo a loja não tem deve contar como SATISFEITA (o avaliador já faz `|| _kanban_cond_na`). Pinado no teste de integração da Task 3 ("cond de módulo desligado não bloqueia").
- **Recusa do banco sem aviso no front (clique-surpresa):** se o banco recusa mas o botão não lista a pendência, o usuário clica e leva erro sem explicação. A Task 4 soma as configuradas à lista; pinado no unit da Task 4 ("cond configurada não satisfeita aparece na lista").
- **Mensagem 5xx com acento:** a recusa nova em `_core` deve ser ASCII (prefixo `explosao_requisito_faltando:`). Pinado no teste de integração da Task 3 (assere o `code` P0001 e o prefixo ASCII).
- **Key de condição inválida/desconhecida em `explosao_requisitos`:** a config pode ter uma key que não existe no catálogo (loja antiga, typo). `requisitosOk`/`CONDICAO_BY_KEY` ignoram key desconhecida (filtra `Boolean`), e o avaliador só devolve as keys que conhece (key ausente no mapa = `undefined` = falso no `satisfeitas[k]`). Pinado no unit da Task 4 ("key desconhecida não quebra, é ignorada na tradução") e documentado no gate SQL (Task 2: key não avaliada conta como não satisfeita → recusaria; mitigação: o editor só grava keys do catálogo).

---

## File Structure

- **`supabase/migrations/20261124100000_f6_explosao_requisitos.sql`** (criar) — coluna nova + `salvar_config_loja` redefinida + `_enviar_modelo_para_cad_core` redefinida. Uma migration só (as 3 mudanças são aditivas e coesas; o gate depende da coluna, o salvar depende da coluna).
- **`supabase/rollback/20261124100000_f6_explosao_requisitos_down.sql`** (criar) — neutraliza: devolve os corpos ANTERIORES de `salvar_config_loja` e `_enviar_modelo_para_cad_core` (a coluna fica inerte).
- **`supabase/rollback/20261124100000_f6_explosao_requisitos_down_drop.sql`** (criar) — opcional, separado: `ALTER TABLE tenant_config DROP COLUMN IF EXISTS explosao_requisitos` (AccessExclusive em `tenant_config` — horário calmo).
- **`src/lib/config-loja-colab.ts`** (modificar) — `COLUNAS_PAGINA += "explosao_requisitos"`; campo no type `ConfigLojaColab`; `ROTULOS`.
- **`src/routes/_authenticated/admin/configuracoes.tsx`** (modificar) — DEFAULTS, hidratação, e a UI (um `RequisitosStatusButton` sem cascata, ancorado no "Enviar à Explosão").
- **`src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts`** (modificar) — `pendenciasEnvioExplosao` ganha 2 params opcionais (`explosaoRequisitos`, `satisfeitas`) e soma as configuradas.
- **`src/components/planejamento/PlanejamentoDetail.tsx`** (modificar) — passa `explosaoRequisitos` (query de `tenant_config`) + `satisfeitas` (já disponível) à `pendenciasEnvioExplosao`.
- **`src/lib/erro-mensagem.ts`** (modificar) — traduz `explosao_requisito_faltando:` em PT.
- **`tests/integration/f6-explosao-requisitos.test.ts`** (criar) — gate no banco.
- **`tests/unit/planejamento-envio-explosao.test.ts`** (modificar) — soma das configuradas.

---

## Task 1: Migration — coluna `explosao_requisitos` + `salvar_config_loja`

**Files:**
- Create: `supabase/migrations/20261124100000_f6_explosao_requisitos.sql` (parte 1 de 2 — a coluna e o salvar; o gate da RPC entra na Task 2, MESMO arquivo)
- Create: `supabase/rollback/20261124100000_f6_explosao_requisitos_down.sql`
- Create: `supabase/rollback/20261124100000_f6_explosao_requisitos_down_drop.sql`
- Test: `tests/integration/f6-explosao-requisitos.test.ts` (Step 1 cobre o salvar; o gate vem na Task 3)

**Interfaces:**
- Consumes: `salvar_config_loja(_tenant_id uuid, _mudancas jsonb, _base jsonb, _chave_kanban_esperada text)` VIVA (a mais recente é `20261112110000`) — redefinir via CREATE OR REPLACE a partir do `pg_get_functiondef` vivo.
- Produces: coluna `tenant_config.explosao_requisitos jsonb NOT NULL DEFAULT '[]'::jsonb`; `salvar_config_loja` aceita `explosao_requisitos` (array de strings, não-null) na lista branca + CAS + UPDATE.

- [ ] **Step 1: Escrever o teste de integração do salvar (falha: coluna não existe)**

```ts
// tests/integration/f6-explosao-requisitos.test.ts  (parte salvar; o gate vem na Task 3)
import { describe, it, expect } from "vitest";
import { withRollback, comoUsuario, TENANT_TESTE, USER_ADMIN_TESTE } from "./helpers"; // usar os helpers reais da suíte (ver tests/integration/db.ts)

describe("F6 explosao_requisitos — salvar_config_loja", () => {
  it("grava uma lista de cond_keys via salvar_config_loja (CAS por coluna)", async () => {
    await withRollback(async (sql) => {
      await comoUsuario(sql, USER_ADMIN_TESTE); // admin da loja
      const base = await sql/*sql*/`select explosao_requisitos from tenant_config where tenant_id = ${TENANT_TESTE}`;
      await sql/*sql*/`select salvar_config_loja(${TENANT_TESTE}, ${JSON.stringify({ explosao_requisitos: ["peca_teste_aprovada", "grade_preenchida"] })}::jsonb, ${JSON.stringify({ explosao_requisitos: base[0]?.explosao_requisitos ?? [] })}::jsonb, null)`;
      const depois = await sql/*sql*/`select explosao_requisitos from tenant_config where tenant_id = ${TENANT_TESTE}`;
      expect(depois[0].explosao_requisitos).toEqual(["peca_teste_aprovada", "grade_preenchida"]);
    });
  });

  it("recusa valor não-array (P0001)", async () => {
    await withRollback(async (sql) => {
      await comoUsuario(sql, USER_ADMIN_TESTE);
      await expect(
        sql/*sql*/`select salvar_config_loja(${TENANT_TESTE}, ${JSON.stringify({ explosao_requisitos: "x" })}::jsonb, ${JSON.stringify({})}::jsonb, null)`,
      ).rejects.toThrow(/Formato inv|P0001/);
    });
  });
});
```

> Nota ao implementador: use os helpers REAIS da suíte de integração (ver `tests/integration/db.ts` e algum teste vizinho como `tests/integration/camada-c1-*.test.ts` para o nome exato de `withRollback`/`comoUsuario`/constantes de tenant/usuário). O esqueleto acima nomeia-os genericamente; adapte aos reais sem mudar a asserção.

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/f6-explosao-requisitos.test.ts --no-file-parallelism`
Expected: FAIL (coluna `explosao_requisitos` não existe).

- [ ] **Step 3: Escrever a migration — coluna + `salvar_config_loja`**

Gere o corpo de `salvar_config_loja` a partir do `pg_get_functiondef` VIVO (não copiar de memória):
```bash
psql "$(cat /tmp/dburl-local.txt)" -tAc "select md5(pg_get_functiondef('public.salvar_config_loja(uuid,jsonb,jsonb,text)'::regprocedure))"
# guarde o md5 ANTES; cole o corpo vivo e edite os 3 pontos abaixo.
```

A migration (`BEGIN; … COMMIT;`, idempotente) faz:
1. **Coluna** (guarda `IF EXISTS pg_attribute … ELSE ADD COLUMN`, espelhando o padrão de `20261103174000:411-419`):
```sql
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS explosao_requisitos jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.tenant_config.explosao_requisitos IS 'F6 Fluxo 2: cond_keys (kanban-condicoes) que o Enviar a Explosao exige, todas em E; [] = opt-in (como hoje).';
```
2. **Lista branca** `c_permitidas` de `salvar_config_loja`: acrescentar `'explosao_requisitos'` ao array (NÃO entra em `c_kanban` — não exige `_chave_kanban_esperada`).
3. **Validação por tipo** no `CASE v_k` (passo 3), espelhando `revenda_kanban_colunas` (`20261103174000:197-202`) — array não-null:
```sql
      WHEN 'explosao_requisitos' THEN
        IF v_t = 'null' THEN
          RAISE EXCEPTION 'O campo "%" nao pode ficar vazio.', v_k USING ERRCODE = 'P0001';
        ELSIF v_t <> 'array' THEN
          RAISE EXCEPTION 'Formato invalido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
```
(ASCII nas mensagens — P0001 é 400, mas mantemos ASCII por disciplina da casa.)
4. **UPDATE estático** (passo final, espelhando `kanban_requisitos` `20261103174000:360` — jsonb simples, sem normalização):
```sql
    explosao_requisitos = CASE WHEN v_m ? 'explosao_requisitos' THEN v_m -> 'explosao_requisitos' ELSE explosao_requisitos END,
```
5. **CAS por coluna**: automático (o loop de conflito já cobre toda chave da lista branca — nada a adicionar).
6. **Pós-condição**: `DO` block conferindo que a coluna existe e que `md5(pg_get_functiondef(...))` MUDOU (diff-validação) + a ACL de `salvar_config_loja` inalterada.

- [ ] **Step 4: Aplicar na cópia local e rodar o teste**

Run:
```bash
psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261124100000_f6_explosao_requisitos.sql
DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/f6-explosao-requisitos.test.ts --no-file-parallelism
```
Expected: os 2 testes do salvar PASSAM.

- [ ] **Step 5: Escrever os rollbacks**

`…_down.sql`: `CREATE OR REPLACE` de `salvar_config_loja` com o corpo ANTERIOR (sem `explosao_requisitos` na lista branca/validação/UPDATE) — guarda md5 confirmando que o vivo é o "depois" antes de reverter. A coluna FICA (inerte).
`…_down_drop.sql`: `ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS explosao_requisitos;` (comentar: AccessExclusive em `tenant_config` — toda checagem de RLS lê a tabela; `lock_timeout`, horário calmo).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261124100000_f6_explosao_requisitos.sql supabase/rollback/20261124100000_f6_explosao_requisitos_down.sql supabase/rollback/20261124100000_f6_explosao_requisitos_down_drop.sql tests/integration/f6-explosao-requisitos.test.ts
git commit -m "feat(explosao): coluna explosao_requisitos + salvar_config_loja (F6 Fluxo 2)"
```

---

## Task 2: Gate no banco — `_enviar_modelo_para_cad_core` recusa pelos requisitos configurados

**Files:**
- Modify: `supabase/migrations/20261124100000_f6_explosao_requisitos.sql` (MESMO arquivo da Task 1 — acrescenta a redefinição de `_enviar_modelo_para_cad_core`)
- Modify: `supabase/rollback/20261124100000_f6_explosao_requisitos_down.sql` (acrescenta o `CREATE OR REPLACE` do `_core` com o corpo anterior)

**Interfaces:**
- Consumes: `_enviar_modelo_para_cad_core(_modelo_id uuid, _observacoes_tecnicas text, _ficha_medida_url text)` VIVA (`20261103181000`); `_avaliar_condicoes_kanban_core(_tenant uuid, _ids uuid[]) RETURNS jsonb` (`20261103194000`); a coluna `tenant_config.explosao_requisitos` (Task 1).
- Produces: recusa `RAISE EXCEPTION 'explosao_requisito_faltando: <keys ASCII>' USING ERRCODE='P0001'` quando falta cond configurada.

- [ ] **Step 1: Escrever o teste de integração do gate (falha: gate não existe)**

Acrescentar a `tests/integration/f6-explosao-requisitos.test.ts`:
```ts
describe("F6 explosao_requisitos — gate no _enviar_modelo_para_cad_core", () => {
  it("OPT-IN: lista vazia NÃO recusa (comportamento de hoje)", async () => {
    await withRollback(async (sql) => {
      // tenant com explosao_requisitos = [] e um modelo apto a enviar (etapa ok, dados mínimos)
      // → _enviar_modelo_para_cad_core NÃO lança por requisito (pode lançar por etapa se não preparar; preparar o modelo na etapa certa)
      // monte o fixture como os testes de kanban/explosão vizinhos fazem.
      await prepararModeloAptoExplosao(sql, MODELO_TESTE);
      await sql/*sql*/`update tenant_config set explosao_requisitos = '[]'::jsonb where tenant_id = ${TENANT_TESTE}`;
      await expect(sql/*sql*/`select _enviar_modelo_para_cad_core(${MODELO_TESTE}, null, null)`).resolves.toBeTruthy();
    });
  });

  it("recusa (P0001, prefixo ASCII) quando uma cond configurada NÃO está satisfeita", async () => {
    await withRollback(async (sql) => {
      await prepararModeloAptoExplosao(sql, MODELO_TESTE);
      // exige peça teste aprovada, mas o modelo não tem → recusa
      await sql/*sql*/`update tenant_config set explosao_requisitos = '["peca_teste_aprovada"]'::jsonb where tenant_id = ${TENANT_TESTE}`;
      await expect(sql/*sql*/`select _enviar_modelo_para_cad_core(${MODELO_TESTE}, null, null)`)
        .rejects.toMatchObject({ code: "P0001" });
      // e a mensagem começa com o prefixo ASCII:
      try { await sql/*sql*/`select _enviar_modelo_para_cad_core(${MODELO_TESTE}, null, null)`; }
      catch (e: any) { expect(String(e.message)).toMatch(/^explosao_requisito_faltando:/); }
    });
  });

  it("passa quando a cond configurada ESTÁ satisfeita", async () => {
    await withRollback(async (sql) => {
      await prepararModeloAptoExplosao(sql, MODELO_TESTE);
      // configure uma cond que o modelo já satisfaz, ex. categoria_definida (o fixture apto já tem categoria)
      await sql/*sql*/`update tenant_config set explosao_requisitos = '["categoria_definida"]'::jsonb where tenant_id = ${TENANT_TESTE}`;
      await expect(sql/*sql*/`select _enviar_modelo_para_cad_core(${MODELO_TESTE}, null, null)`).resolves.toBeTruthy();
    });
  });

  it("cond de módulo DESLIGADO não bloqueia (conta como satisfeita)", async () => {
    await withRollback(async (sql) => {
      await prepararModeloAptoExplosao(sql, MODELO_TESTE);
      // cond que exige módulo producao; desligar producao na loja → _kanban_cond_na devolve true → não bloqueia
      await sql/*sql*/`update tenant_config set modules = modules - 'producao' where tenant_id = ${TENANT_TESTE}`; // SEM claims (MOD-1)
      await sql/*sql*/`update tenant_config set explosao_requisitos = '["cq_liberado"]'::jsonb where tenant_id = ${TENANT_TESTE}`;
      await expect(sql/*sql*/`select _enviar_modelo_para_cad_core(${MODELO_TESTE}, null, null)`).resolves.toBeTruthy();
    });
  });
});
```

> Nota ao implementador: `prepararModeloAptoExplosao` NÃO existe — você monta o fixture inline reusando o padrão dos testes de Explosão/kanban vizinhos (`tests/integration/kanban-*.test.ts`): um modelo na etapa que passa o `_explosao_envio_gate` (status = `explosao_envio_status` da loja ou posterior; o default é 'aprovado'), com categoria/tecido/grade mínimos para não falhar por OUTRO motivo. O objetivo é isolar o gate NOVO. Desligar módulo SEM claims (MOD-1).

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/f6-explosao-requisitos.test.ts --no-file-parallelism`
Expected: os 4 novos FALHAM (o gate ainda não existe — hoje `_core` não lê `explosao_requisitos`), exceto talvez o opt-in que já passaria.

- [ ] **Step 3: Acrescentar o gate à migration (redefinir `_core`)**

Gere o corpo vivo e guarde o md5:
```bash
psql "$(cat /tmp/dburl-local.txt)" -tAc "select md5(pg_get_functiondef('public._enviar_modelo_para_cad_core(uuid,text,text)'::regprocedure))"
```
No corpo vivo (de `20261103181000`), LOGO APÓS o bloco do gate de etapa (depois do `IF NOT COALESCE(v_gate_ok,false) … END IF;`, ~linha 239) e ANTES do advisory lock/escrita, inserir:
```sql
  -- F6 Fluxo 2 (Bloco B) — requisitos CONFIGURAVEIS do Enviar a Explosao. OPT-IN: lista vazia pula tudo.
  -- Gate SO dos configurados (a lista fixa REF/nome/etc. segue so no front). Modulo desligado = satisfeita
  -- (o avaliador ja aplica _kanban_cond_na). Recusa ASCII P0001.
  DECLARE
    v_reqs jsonb;
    v_cond jsonb;
    v_faltando text;
  BEGIN
    SELECT explosao_requisitos INTO v_reqs FROM public.tenant_config WHERE tenant_id = v_tenant;
    IF v_reqs IS NOT NULL AND jsonb_typeof(v_reqs) = 'array' AND jsonb_array_length(v_reqs) > 0 THEN
      v_cond := COALESCE(public._avaliar_condicoes_kanban_core(v_tenant, ARRAY[_modelo_id]) -> _modelo_id::text, '{}'::jsonb);
      -- Lista (ASCII, separada por virgula) das keys exigidas e NAO satisfeitas (key ausente no mapa = nao satisfeita).
      SELECT string_agg(k.key, ',' ORDER BY k.key) INTO v_faltando
        FROM jsonb_array_elements_text(v_reqs) AS k(key)
        WHERE COALESCE((v_cond ->> k.key)::boolean, false) = false;
      IF v_faltando IS NOT NULL THEN
        RAISE EXCEPTION 'explosao_requisito_faltando: %', v_faltando USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END;
```
(As keys do catálogo são ASCII snake_case — seguras na mensagem 5xx. `v_tenant`/`_modelo_id` já existem no escopo da função.)

Atualizar a pós-condição: `md5(pg_get_functiondef('public._enviar_modelo_para_cad_core(uuid,text,text)'::regprocedure))` MUDOU e a ACL do `_core` segue `{postgres=X/postgres,service_role=X/postgres}` (REVOKE dos 3 preservado).

- [ ] **Step 4: Reaplicar a migration e rodar os testes**

Run (a migration é idempotente — reaplica por cima):
```bash
psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261124100000_f6_explosao_requisitos.sql
DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/f6-explosao-requisitos.test.ts --no-file-parallelism
```
Expected: TODOS (salvar + gate) PASSAM.

- [ ] **Step 5: Completar o rollback `_down`**

Acrescentar a `…_down.sql` o `CREATE OR REPLACE` de `_enviar_modelo_para_cad_core` com o corpo ANTERIOR (de `20261103181000`, SEM o bloco F6), com guarda md5 confirmando que o vivo é o "depois".

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261124100000_f6_explosao_requisitos.sql supabase/rollback/20261124100000_f6_explosao_requisitos_down.sql tests/integration/f6-explosao-requisitos.test.ts
git commit -m "feat(explosao): gate no banco recusa pelos requisitos configurados (F6 Fluxo 2)"
```

---

## Task 3: Front puro — `pendenciasEnvioExplosao` soma as condições configuradas

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts`
- Test: `tests/unit/planejamento-envio-explosao.test.ts` (modificar — acrescentar casos)

**Interfaces:**
- Consumes: `requisitosOk(requisitos, satisfeitas)` e `CONDICAO_BY_KEY` de `@/lib/kanban-condicoes`.
- Produces: `pendenciasEnvioExplosao` ganha 2 params opcionais — `explosaoRequisitos?: string[]` e `satisfeitas?: Record<string, boolean>` — e, no fim, acrescenta à lista uma pendência por condição configurada NÃO satisfeita (label da `Condicao`, SEM `secao` — pendência texto puro, porque `CondicaoSecao` ≠ `SecaoSheetKey`).

- [ ] **Step 1: Escrever os casos de teste (falha: params não existem)**

Acrescentar a `tests/unit/planejamento-envio-explosao.test.ts`:
```ts
import { requisitosOk } from "@/lib/kanban-condicoes"; // já deve existir no import; garantir

describe("pendenciasEnvioExplosao — requisitos configurados (F6 Fluxo 2)", () => {
  const draftOk = { ref: "AB12345678", nome: "X", estilista_id: "e", categoria_principal_id: "c", data_desenho_tecnico: "2026-01-01", data_piloto1: "2026-01-01", data_piloto2: null, data_piloto3: null, piloteiro2_id: null, piloteiro3_id: null };
  const baseArgs = { draft: draftOk as any, blocks: [{ tipo: "tecido", artigo_id: "a", variantes: ["v"] }] as any, grades: [{ grade_total: 10 }] as any, rotuloRef: "REF" };

  it("sem requisitos configurados: lista fixa inalterada (opt-in)", () => {
    const out = pendenciasEnvioExplosao({ ...baseArgs });
    expect(out).toEqual([]); // draft completo → nada falta
  });

  it("cond configurada NÃO satisfeita aparece na lista (label da Condicao, sem secao)", () => {
    const out = pendenciasEnvioExplosao({ ...baseArgs, explosaoRequisitos: ["peca_teste_aprovada"], satisfeitas: { peca_teste_aprovada: false } });
    expect(out.some((p) => p.label === "Peça teste aprovada" && p.secao === undefined)).toBe(true);
  });

  it("cond configurada SATISFEITA não aparece", () => {
    const out = pendenciasEnvioExplosao({ ...baseArgs, explosaoRequisitos: ["peca_teste_aprovada"], satisfeitas: { peca_teste_aprovada: true } });
    expect(out.some((p) => p.label === "Peça teste aprovada")).toBe(false);
  });

  it("key desconhecida é ignorada (não quebra)", () => {
    const out = pendenciasEnvioExplosao({ ...baseArgs, explosaoRequisitos: ["key_que_nao_existe"], satisfeitas: {} });
    expect(out).toEqual([]); // requisitosOk filtra Boolean → key inexistente some
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/planejamento-envio-explosao.test.ts`
Expected: FAIL (os novos casos — params `explosaoRequisitos`/`satisfeitas` ainda não existem).

- [ ] **Step 3: Implementar a soma**

Em `envio-explosao.ts`, adicionar os 2 params ao objeto de `pendenciasEnvioExplosao` e, ANTES do `return out;`:
```ts
  // F6 Fluxo 2 — SOMA as condições que a loja configurou como requisito do Enviar à Explosão
  // (opt-in: sem config, nada muda). Texto puro (sem link de seção): `CondicaoSecao` ≠ `SecaoSheetKey`,
  // então não dá para apontar a seção do Sheet aqui; o label da condição já é informativo.
  if (i.explosaoRequisitos && i.explosaoRequisitos.length > 0) {
    const { faltando } = requisitosOk(i.explosaoRequisitos, i.satisfeitas ?? {});
    for (const cond of faltando) out.push({ label: cond.label });
  }
```
E no tipo do parâmetro, adicionar:
```ts
  /** F6 Fluxo 2 — cond_keys que a loja exige no Enviar à Explosão (tenant_config.explosao_requisitos); vazio = opt-in. */
  explosaoRequisitos?: string[];
  /** F6 Fluxo 2 — mapa {cond_key: bool} do avaliador (avaliar_condicoes_kanban) para este modelo. */
  satisfeitas?: Record<string, boolean>;
```
(Garantir `import { requisitosOk } from "@/lib/kanban-condicoes";` no topo.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/planejamento-envio-explosao.test.ts`
Expected: PASS (todos, incluindo os antigos — a soma é aditiva e opt-in).

- [ ] **Step 5: Commit**

```bash
git add src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts tests/unit/planejamento-envio-explosao.test.ts
git commit -m "feat(explosao): pendencias somam os requisitos configurados da loja (F6 Fluxo 2)"
```

---

## Task 4: Fiação no Sheet + tradução do erro

**Files:**
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (passa `explosaoRequisitos` + `satisfeitas` à `pendenciasEnvioExplosao`)
- Modify: `src/lib/erro-mensagem.ts` (traduz `explosao_requisito_faltando:`)

**Interfaces:**
- Consumes: `pendenciasEnvioExplosao` com os 2 params novos (Task 3); a query de `tenant_config` já existente no Sheet (ou adicionar o campo `explosao_requisitos` ao select); o mapa `satisfeitas` do card (já disponível via `avaliar_condicoes_kanban`/`useFichaKanban` — ver `requisitosOk` usage no Sheet).
- Produces: o botão "Enviar à Explosão" lista as pendências configuradas; a recusa do banco vira texto PT.

- [ ] **Step 1: Localizar as fontes no Sheet (sem teste próprio — fiação coberta pelo build/tsc e QA)**

No `PlanejamentoDetail.tsx`:
- Confirmar de onde vem o mapa `satisfeitas` (as condições avaliadas do card). O Sheet já usa `avaliar_condicoes_kanban` para os selos/kanban — localizar a variável (ex.: um `Record<string,boolean>` por modelo). Se não houver uma pronta para ESTE card, derivar do mesmo hook que alimenta os selos.
- Confirmar de onde vem `explosao_requisitos` da loja: a query de `tenant_config` do Sheet (adicionar `explosao_requisitos` ao `.select(...)` se faltar; cair em `[]` quando ausente).

- [ ] **Step 2: Passar os params na chamada de `pendenciasEnvioExplosao` (~linha 1573)**

```tsx
const pendenciasEnvio = (gateEnvio.ok && ficha.carregado /* …condições de hoje… */)
  ? pendenciasEnvioExplosao({
      /* …args de hoje… */,
      explosaoRequisitos: tenantCfg?.explosao_requisitos ?? [],
      satisfeitas: condicoesDoCard ?? {}, // o Record<string,bool> do avaliador p/ este modelo
    })
  : [];
```
(Nomes `tenantCfg`/`condicoesDoCard` são ilustrativos — usar as variáveis REAIS que o Step 1 identificou.)

- [ ] **Step 3: Traduzir a recusa do banco**

Em `erro-mensagem.ts`, no tradutor por prefixo (onde `integracao_travado:` etc. são tratados), adicionar:
```ts
// F6 Fluxo 2 — recusa do Enviar à Explosão por requisito configurado da loja (keys ASCII separadas por vírgula).
if (msg.startsWith("explosao_requisito_faltando:")) {
  const keys = msg.slice("explosao_requisito_faltando:".length).trim().split(",").map((k) => k.trim()).filter(Boolean);
  const labels = keys.map((k) => CONDICAO_BY_KEY.get(k)?.label ?? k); // CONDICAO_BY_KEY de @/lib/kanban-condicoes
  return `Para enviar à Explosão, falta: ${labels.join(", ")}.`;
}
```
(Garantir o import de `CONDICAO_BY_KEY`. Se `erro-mensagem.ts` evita imports pesados, usar as keys cruas no texto como fallback — mas preferir os labels.)

- [ ] **Step 4: Verificar build + tsc**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep -E "PlanejamentoDetail|envio-explosao|erro-mensagem" | head`
Expected: build OK; grep vazio.

- [ ] **Step 5: Commit**

```bash
git add src/components/planejamento/PlanejamentoDetail.tsx src/lib/erro-mensagem.ts
git commit -m "feat(explosao): Sheet soma requisitos configurados + traducao PT da recusa (F6 Fluxo 2)"
```

---

## Task 5: Config da Loja — editor dos requisitos do "Enviar à Explosão"

**Files:**
- Modify: `src/lib/config-loja-colab.ts` (`COLUNAS_PAGINA`, type, `ROTULOS`)
- Modify: `src/routes/_authenticated/admin/configuracoes.tsx` (DEFAULTS, hidratação, UI do `RequisitosStatusButton`)

**Interfaces:**
- Consumes: `RequisitosStatusButton` (`src/components/admin/RequisitosStatusDialog.tsx`) — props `label`, `requisitos: string[]`, `onChange: (next: string[]) => void`, `colabPath?`; SEM `herdados`/`onExcecoesChange` (modo plano, sem cascata); `salvar_config_loja` com `explosao_requisitos` na lista branca (Task 1).
- Produces: um card/seção em Config da Loja que lê/grava `cfg.explosao_requisitos`.

- [ ] **Step 1: `config-loja-colab.ts` — registrar a coluna**

- Adicionar `"explosao_requisitos"` ao array `COLUNAS_PAGINA` (NÃO é coluna de kanban — vai pelo diff normal, não por `diffKanban`).
- Adicionar `explosao_requisitos: string[]` ao type `ConfigLojaColab`.
- Adicionar em `ROTULOS`: `explosao_requisitos: "Requisitos do Envio à Explosão"`.
- (Sem regra de `serializarColuna` especial — array simples cai no `return v` default.)

- [ ] **Step 2: `admin/configuracoes.tsx` — DEFAULTS + hidratação**

- No estado inicial do `cfg` (perto de `kanban_requisitos: {}`): `explosao_requisitos: [] as string[]`.
- Na hidratação (onde `kanban_requisitos` é semeado do servidor): `explosao_requisitos: (data?.explosao_requisitos as string[]) ?? []`.
- Garantir que o `.select(...)` da query de `tenant_config` da tela inclua `explosao_requisitos`.

- [ ] **Step 3: UI — o editor ancorado no "Enviar à Explosão"**

Perto do bloco que já renderiza o toggle `EnvioExplosaoToggle` (status do envio, ~linha 1295), adicionar o editor de requisitos:
```tsx
<div className="space-y-1" data-colab-path="cfg:explosao_requisitos">
  <div className="text-sm font-medium">Requisitos para enviar à Explosão</div>
  <p className="text-xs text-muted-foreground">
    Além dos campos mínimos de sempre (REF, nome, tecido, grade, datas), o Enviar à Explosão passa a
    exigir as condições marcadas aqui. Vazio = só os mínimos de hoje.
  </p>
  <RequisitosStatusButton
    label="Enviar à Explosão"
    requisitos={cfg.explosao_requisitos ?? []}
    onChange={(next) => setCfg((c) => ({ ...c, explosao_requisitos: next }))}
    condsModuloOff={condsModuloOff}   // reusa a mesma var que o kanban_requisitos já usa (condicoesForaDoModulo(modules))
    colabPath="cfg:explosao_requisitos"
  />
</div>
```
(SEM `herdados`/`excecoes`/`onExcecoesChange` — não há cascata aqui; é uma lista plana ancorada numa "etapa" única conceitual.)

- [ ] **Step 4: Verificar build + tsc**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep -E "config-loja-colab|configuracoes" | head`
Expected: build OK; grep vazio.

- [ ] **Step 5: QA manual na prévia (5190)**

Config da Loja → marcar "Peça teste aprovada" nos Requisitos do Envio à Explosão → Salvar. Abrir um card SEM peça teste aprovada na etapa de envio → o botão "Enviar à Explosão" lista "Peça teste aprovada" em "Para enviar, falta" e, se clicar, a recusa do banco aparece em PT. Desmarcar tudo → volta ao comportamento de hoje.

- [ ] **Step 6: Commit**

```bash
git add src/lib/config-loja-colab.ts src/routes/_authenticated/admin/configuracoes.tsx
git commit -m "feat(config-loja): editor dos requisitos do Enviar a Explosao (F6 Fluxo 2)"
```

---

## Self-Review

**1. Spec coverage (Bloco B):** config por loja ancorada no editor existente → Task 5; vale no banco (recusa) → Task 2; opt-in → Global Constraints + testes das Tasks 2/3; peça teste obrigatória → coberto (a key `peca_teste_aprovada` já existe no catálogo, entra como opção no editor da Task 5 e é avaliada pela RPC na Task 2); front soma à lista → Tasks 3/4. ✓

**2. Placeholder scan:** os `prepararModeloAptoExplosao` e nomes de helpers de integração são marcados como "adaptar ao real" com instrução concreta de qual padrão seguir (testes vizinhos) — não são placeholders de LÓGICA do produto, são ganchos de fixture que variam por suíte. Os nomes `tenantCfg`/`condicoesDoCard` na Task 4 são explicitamente "usar a variável real identificada no Step 1". Aceitável (o Step 1 da Task 4 é o levantamento). ✓

**3. Type consistency:** `explosaoRequisitos: string[]` e `satisfeitas: Record<string,boolean>` iguais nas Tasks 3 e 4; `explosao_requisitos` (coluna/jsonb) consistente nas Tasks 1, 2, 5; `requisitosOk`/`CONDICAO_BY_KEY` usados igual nas Tasks 3 e 4; a decisão "pendência sem secao" (CondicaoSecao ≠ SecaoSheetKey) está na Task 3 e refletida no teste. ✓

**4. Review Focus:** config vazia (Task 3 unit + Task 2 integração); módulo desligado não bloqueia (Task 2 integração); clique-surpresa coberto pela soma no front (Task 3/4); 5xx ASCII (Task 2 integração assere P0001 + prefixo); key desconhecida (Task 3 unit + nota no gate SQL). ✓

**Deploy:** banco ANTES do site, no kit ÚNICO do F6 (com Fluxo 1, Fluxo 3, F8) — migration `20261124100000` (aditiva, idempotente; `tenant_config` pega AccessExclusive por instante no ADD COLUMN → `lock_timeout`, horário calmo) + front. Volta LIFO: site → `_down` (neutraliza salvar_config_loja + _core; coluna fica) → `_down_drop` opcional (DROP COLUMN, horário calmo).
