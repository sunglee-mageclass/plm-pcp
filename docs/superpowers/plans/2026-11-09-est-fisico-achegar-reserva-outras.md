# EST visual (físico + a-chegar − reserva de outras coleções) + resumo ao vivo — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coluna EST do Modo Plano do Plan. Tecido passa a mostrar físico + a-chegar − reserva de OUTRAS coleções (em vez do `previsto`, que descontava a reserva da própria coleção), com hover de 3 linhas; e o resumo lateral recalcula AO VIVO sobre o rascunho não-salvo.

**Architecture:** A RPC `_plan_tecido_previa_pedido_core` ganha uma CTE aditiva que calcula a reserva de OUTRAS coleções por variante (reserva total do core − reserva desta coleção) e expõe 1 chave nova `reserva_outras_m` na `cobertura`. O `deficit_m`/`qtd`/a conta de COMPRA ficam INTOCADOS (já estão corretos — investigação na cópia provou). No front, o EST = `fisico_m + prev_receb_m − reserva_outras_m`; e o resumo recalcula ao vivo combinando a NECESSIDADE do rascunho (calculada no cliente por `necessidadeVariante`) com estoque/reserva do servidor (que não dependem do rascunho).

**Tech Stack:** Postgres 17 (migration via `psql -f`), TypeScript/React, TanStack Query, Vitest (unit + integração txn revertida na cópia local 54422).

**Spec:** `docs/superpowers/specs/2026-11-09-est-fisico-achegar-reserva-outras-design.md`

## Global Constraints

- **NÃO tocar `_estoque_tecido_core`** (SSOT, invariante #4). A reserva de outras é derivada na prévia.
- **NÃO mudar `deficit_m`, `qtd`, nem a lista de fornecedores/itens** da prévia (compra intocada).
- **A migration é CREATE OR REPLACE aditiva com guarda md5** — aceita o md5 vivo atual `dd563e5789b0dbd1cffc02299d154bf5` (F3.1) e grava o novo; prova por txn que `nec_m`/`estoque_m`/`deficit_m`/`qtd` ficam IDÊNTICOS (só `reserva_outras_m` é nova).
- **RAISE/mensagem de erro só ASCII** se houver (a guarda de loja existente já é "Coleção de outra loja." — não mexer).
- **DATABASE_URL = cópia local 54422 SEMPRE** nos testes. `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres`.
- **A fórmula da reserva da coleção tem de ser IDÊNTICA à `reserva_mod` do core:** `consumo × (1+loss_percent/100) × grade_total[por variante_numero=ordem] × multiplicador`, com os MESMOS filtros (status_desenvolvimento≠reprovado AND status_planejamento≠reprovado AND NOT EXISTS cad enviado_corte). A regra do tecido 1 / complementar da `reserva_mod` tem de ser espelhada (ver Review Focus).
- **Cards sem coleção contam como OUTRA** (reserva_desta = só `colecao_id = _colecao_id`; o resto cai em "outras" por subtração).
- **Anti-drift obrigatório:** `Σ_coleções reserva_desta = reservado_total do core`, por variante (tolerância 0,0001 m).

## Review Focus

- **Dupla-contagem da regra tecido-1/complementar:** a `reserva_mod` do core usa grade do tecido 1 OU `_grade_soma_pares` para complementar. Se a `reserva_desta_colecao` não espelhar isso EXATAMENTE, `reserva_desta ≠ parcela do total` e a subtração fica errada → reserva_outras errada → EST errado. Testado na Task 1 (anti-drift Σ=total, que só fecha se a fórmula bate).
- **Variante usada por 2+ coleções (competição real):** d0172d77 = 1932,3 (col A) + 1870,6 (col B) = 3802,9. Planejando a col A, reserva_outras tem de dar 1870,6. Testado na Task 1.
- **Variante sem reserva nenhuma:** reserva_total 0 → reserva_outras 0 → EST = físico + a-chegar puro. Testado na Task 1.
- **`livre_m` nunca negativo:** se reserva_outras > físico + a-chegar, o EST clampa em 0 (como o `fisico` do core). Testado na Task 2 (TS).
- **Resumo ao vivo não dessincroniza do servidor ao salvar:** a necessidade do cliente (`necessidadeVariante`) tem de bater com o `nec_m` do servidor para o mesmo estado salvo, senão o número "pula" ao salvar. Testado na Task 4 (anti-drift cliente×servidor).

---

### Task 1: CTE `reserva_outras` na prévia + chave `reserva_outras_m` (SQL)

**Files:**
- Create: `supabase/migrations/20261117100000_est_reserva_outras.sql`
- Create (rollback): `supabase/rollback/20261117100000_est_reserva_outras_down.sql`
- Test: `tests/integration/plan-tecido-reserva-outras.test.ts`

**Interfaces:**
- Consumes: `_plan_tecido_previa_pedido_core(_tenant uuid, _colecao_id uuid, _slot_ids uuid[])` (md5 vivo `dd563e5789b0dbd1cffc02299d154bf5`); `_estoque_tecido_core(_tenant)` (NÃO redefinir); a CTE `est` já existe na prévia e expõe `previsto`, `recebido_m`, `prev_receb_m`, `fisico`.
- Produces: a prévia passa a incluir, em cada item de `cobertura`, a chave `reserva_outras_m` numeric (≥0). Nada mais muda.

- [ ] **Step 1: Escrever o teste de integração que FALHA (a chave ainda não existe)**

```ts
// tests/integration/plan-tecido-reserva-outras.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { withTenant, rpcAs } from "./db"; // helper existente: roda como authenticated numa txn revertida
// Ave Rara + RESORT 27 (dado real da cópia)
const TENANT = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const USER = "174518a5-569f-4954-9010-24204b345508";
const COLECAO = "890e16dc-0926-4cf4-adf4-cdb82d28205a";

describe("prévia: reserva_outras_m", () => {
  it("expõe reserva_outras_m em cada linha da cobertura", async () => {
    const previa = await rpcAs(USER, "plan_tecido_previa_pedido", { _colecao_id: COLECAO });
    const cobertura = previa.cobertura as any[];
    expect(cobertura.length).toBeGreaterThan(0);
    for (const l of cobertura) {
      expect(l).toHaveProperty("reserva_outras_m");
      expect(Number(l.reserva_outras_m)).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que FALHA**

Run: `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/integration/plan-tecido-reserva-outras.test.ts`
Expected: FAIL (a propriedade `reserva_outras_m` não existe).

- [ ] **Step 3: Escrever a migration com a CTE aditiva**

A migration faz CREATE OR REPLACE da `_plan_tecido_previa_pedido_core` idêntica à atual, acrescentando:
(a) uma CTE `reserva_desta` que calcula a reserva da PRÓPRIA coleção por variante, espelhando a `reserva_mod` do core mas com `AND m.colecao_id = _colecao_id`;
(b) a CTE `est` já tem `reservado`? NÃO — a `est` atual só traz `previsto, recebido_m, prev_receb_m, fisico`. Adicionar `reservado` ao SELECT da CTE `est` (o core já retorna essa coluna);
(c) na CTE `base`/saída, calcular `reserva_outras_m = GREATEST(0, est.reservado − COALESCE(reserva_desta.m,0))`;
(d) incluir `'reserva_outras_m', c.reserva_outras_m` no `jsonb_build_object` da `cobertura`.

A guarda md5 no topo (padrão das migrations da prévia): aceitar `dd563e5789b0dbd1cffc02299d154bf5` (vivo) antes de aplicar, abortar se o vivo divergir.

```sql
-- supabase/migrations/20261117100000_est_reserva_outras.sql
-- EST visual: expõe reserva_outras_m na cobertura (reservado do core − reserva desta coleção).
-- ADITIVO: nec_m/estoque_m/deficit_m/qtd INTOCADOS. Guarda md5 do vivo.
DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])'::regprocedure))
     NOT IN ('dd563e5789b0dbd1cffc02299d154bf5')  -- F3.1 (vivo)
  THEN RAISE EXCEPTION 'previa drift: md5 inesperado antes da ida'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public._plan_tecido_previa_pedido_core(_tenant uuid, _colecao_id uuid, _slot_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_res jsonb;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  -- [corpo IDÊNTICO ao vivo, com as 4 adições marcadas [EST]:]
  -- ... necessidade, nonsel, est(+reservado [EST]), supply, rolo_supply, base(+reserva_desta/reserva_outras_m [EST]) ...
  -- (o executor copia o corpo vivo via pg_get_functiondef e aplica as adições; ver Step 3b.)
  return v_res;
end
$function$;

REVOKE EXECUTE ON FUNCTION public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[]) TO service_role;
```

- [ ] **Step 3b: Gerar o corpo pela troca exata sobre o vivo (sem reescrever à mão)**

```bash
# extrair o corpo vivo
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres -tAc \
  "select pg_get_functiondef('public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])'::regprocedure);" > /tmp/previa_vivo.sql
```
Aplicar 4 edições EXATAS sobre `/tmp/previa_vivo.sql` e colar no corpo da migration:
1. CTE `est`: `select variante_tecido_id, previsto, recebido_m, prev_receb_m, fisico from ...` → acrescentar `, reservado`.
2. Nova CTE `reserva_desta` (depois de `est`): espelho da `reserva_mod` do core (`20261025100000`), filtrada por `m.colecao_id = _colecao_id`, agrupada por `variante_tecido_id`.
3. Na CTE `base`: `LEFT JOIN reserva_desta rd ON rd.variante_tecido_id = v.id` e coluna `greatest(0, coalesce(e.reservado,0) - coalesce(rd.m,0)) as reserva_outras_m`.
4. No `jsonb_build_object` da `cobertura`: adicionar `'reserva_outras_m', c.reserva_outras_m`.

- [ ] **Step 4: Aplicar na cópia e rodar o teste de integração (passa)**

Run:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres -f supabase/migrations/20261117100000_est_reserva_outras.sql
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/integration/plan-tecido-reserva-outras.test.ts
```
Expected: PASS.

- [ ] **Step 5: Teste anti-drift — compra INTOCADA + Σreserva=total + casos reais**

Acrescentar ao mesmo arquivo de teste:

```ts
it("nec_m/estoque_m/deficit_m/qtd ficam IDÊNTICOS ao de antes (compra intocada)", async () => {
  // snapshot comparado contra os valores conhecidos da prévia ANTES da migration (fixados):
  const previa = await rpcAs(USER, "plan_tecido_previa_pedido", { _colecao_id: COLECAO });
  const porCor = Object.fromEntries((previa.cobertura as any[]).map(l => [l.label, l]));
  // AZUL - INDIGO: nec 2742,48 / est 0 / deficit 0 (dado real da cópia, pré-mudança)
  expect(Number(porCor["AZUL - INDIGO"].nec_m)).toBeCloseTo(2742.48, 1);
  expect(Number(porCor["AZUL - INDIGO"].estoque_m)).toBeCloseTo(0, 1);
  expect(Number(porCor["AZUL - INDIGO"].deficit_m)).toBeCloseTo(0, 1);
});

it("Σ reserva por coleção = reservado total do core, por variante (tol 0,0001)", async () => {
  // roda uma consulta SQL que soma reserva_desta de TODAS as coleções e compara com o reservado do core
  const rows = await rpcAs(USER, "plan_tecido_reserva_drift_check" , {}); // RPC só-teste? NÃO — usar query direta via helper
  for (const r of rows) expect(Math.abs(Number(r.soma_colecoes) - Number(r.reservado_core))).toBeLessThan(0.0001);
});
```
> Nota ao executor: se não houver helper de query SQL crua nos testes, provar o Σ=total por uma query `psql` no Step 6 e asserar o resultado via um teste que chama a prévia em 2 coleções que compartilham a variante d0172d77 e soma (deve dar o reservado do core daquela variante).

- [ ] **Step 6: Prova manual do Σ=total na cópia (registro no relatório)**

Run:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres -tAc "
set local role authenticated;
set local \"request.jwt.claims\" = '{\"sub\":\"174518a5-569f-4954-9010-24204b345508\",\"role\":\"authenticated\"}';
-- para a variante d0172d77 (compartilhada por 2 coleções): a reserva_outras da coleção A
-- deve ser = reservado_total − reserva_desta_A. Confirma 3802,9 = 1932,3 + 1870,6.
select 1;"
```
Expected: os números batem com `scratchpad/est-casos-prova.md`.

- [ ] **Step 7: Rollback down + commit**

```bash
# supabase/rollback: CREATE OR REPLACE devolvendo o corpo vivo dd563e57 (sem a chave), guarda md5 do NOVO.
git add supabase/migrations/20261117100000_est_reserva_outras.sql \
        supabase/rollback/20261117100000_est_reserva_outras_down.sql \
        tests/integration/plan-tecido-reserva-outras.test.ts
git commit -m "feat(plan-tecido): previa expoe reserva_outras_m (reservado core - reserva desta colecao); compra intocada"
```

---

### Task 2: EST exibido = físico + a-chegar − reserva de outras + hover 3 linhas (TS)

**Files:**
- Modify: `src/components/plan-tecido/FazerPedidoWizard.tsx` (tipo `PreviaCoberturaRpc`: + `reserva_outras_m: number`)
- Modify: `src/components/plan-tecido/ModoPlanoView.tsx` (coluna EST, SOB, COMPR, hover)
- Test: `tests/unit/plan-tecido-est-livre.test.ts`

**Interfaces:**
- Consumes: `PreviaCoberturaRpc` com `fisico_m`, `prev_receb_m`, `reserva_outras_m`, `nec_m`, `deficit_m` (da Task 1).
- Produces: a montagem de `LinhaVariante` em `ModoPlanoView` passa a usar `est = max(0, fisico_m + prev_receb_m − reserva_outras_m)`; `sob = max(0, est − plan)`; `compr` CONTINUA `deficit_m` (compra intocada).

- [ ] **Step 1: Teste unit que FALHA — EST = físico + a-chegar − reserva de outras**

```ts
// tests/unit/plan-tecido-est-livre.test.ts
import { describe, it, expect } from "vitest";
import { estLivre } from "@/lib/plan-tecido/calc"; // função nova (pura)

describe("estLivre", () => {
  it("físico + a-chegar − reserva de outras", () => {
    expect(estLivre({ fisico_m: 0, prev_receb_m: 1170, reserva_outras_m: 641.6 })).toBeCloseTo(528.4, 1);
  });
  it("sem reserva de outras: físico + a-chegar puro", () => {
    expect(estLivre({ fisico_m: 100, prev_receb_m: 50, reserva_outras_m: 0 })).toBe(150);
  });
  it("clampa em 0 quando a reserva de outras supera o disponível", () => {
    expect(estLivre({ fisico_m: 0, prev_receb_m: 100, reserva_outras_m: 300 })).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run --no-file-parallelism tests/unit/plan-tecido-est-livre.test.ts`
Expected: FAIL (`estLivre` não existe).

- [ ] **Step 3: Implementar `estLivre` pura em calc.ts**

```ts
// src/lib/plan-tecido/calc.ts — nova função pura
export const estLivre = (v: { fisico_m: number; prev_receb_m: number; reserva_outras_m: number }): number =>
  Math.max(0, (Number(v.fisico_m) || 0) + (Number(v.prev_receb_m) || 0) - (Number(v.reserva_outras_m) || 0));
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `npx vitest run --no-file-parallelism tests/unit/plan-tecido-est-livre.test.ts`
Expected: PASS.

- [ ] **Step 5: Ligar no ModoPlanoView (tipo + montagem + hover)**

Em `FazerPedidoWizard.tsx`, no tipo `PreviaCoberturaRpc`, adicionar `reserva_outras_m: number;`.

Em `ModoPlanoView.tsx` (função `agruparPorFornecedor`, ~linha 68): trocar `const est = Number(c.estoque_m) || 0;` por `const est = estLivre({ fisico_m: Number(c.fisico_m)||0, prev_receb_m: Number(c.prev_receb_m)||0, reserva_outras_m: Number(c.reserva_outras_m)||0 });` e manter `sob = Math.max(0, est − plan)`. Adicionar `reservaOutras: Number(c.reserva_outras_m)||0` ao objeto `LinhaVariante` (tipo + push).

No hover do EST (JSX ~linha 131), adicionar a 3ª linha:
```tsx
<div>Disponível (real): {fmtMetros(v.fisico)} m</div>
<div>A chegar (pedido): {fmtMetros(v.prevReceb)} m</div>
<div>Reservado por outras coleções: {fmtMetros(v.reservaOutras)} m</div>
```

- [ ] **Step 6: tsc + build + teste**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "ModoPlanoView|FazerPedidoWizard|calc|TS[0-9]" | head
npx vitest run --no-file-parallelism tests/unit/plan-tecido-est-livre.test.ts
```
Expected: tsc limpo; teste PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/plan-tecido/calc.ts src/components/plan-tecido/ModoPlanoView.tsx src/components/plan-tecido/FazerPedidoWizard.tsx tests/unit/plan-tecido-est-livre.test.ts
git commit -m "feat(plan-tecido): EST do Modo Plano = fisico + a-chegar - reserva de outras colecoes + hover 3 linhas"
```

---

### Task 3: Necessidade por variante do RASCUNHO, no cliente (TS puro)

**Files:**
- Modify: `src/lib/plan-tecido/calc.ts` (nova função `necessidadePorVarianteDaArvore`)
- Test: `tests/unit/plan-tecido-nec-rascunho.test.ts`

**Interfaces:**
- Consumes: `PtArvore` (rascunho), `necessidadeVariante(consumo, grade_total, mult)` (já existe em calc.ts).
- Produces: `necessidadePorVarianteDaArvore(arvore, reprovados?): Map<variante_tecido_id, number>` — a NECESSIDADE (PLAN) por variante real, somando todos os slots visíveis do rascunho, pulando reprovados (mesma regra de `slotContaNaDemanda`).

- [ ] **Step 1: Teste unit que FALHA**

```ts
// tests/unit/plan-tecido-nec-rascunho.test.ts
import { describe, it, expect } from "vitest";
import { necessidadePorVarianteDaArvore } from "@/lib/plan-tecido/calc";
import type { PtArvore } from "@/lib/plan-tecido/types";

const arvore: PtArvore = {
  subcolecoes: [{ linhas: [{ slots: [
    { modelo_id: "m1", materiais: [
      { tipo: "tecido", numero: 1, consumo: 2, variantes: [
        { variante_tecido_id: "vA", grade_total: 10, multiplicador: 1, ordem: 1 },
      ] } ] },
  ] }] }],
} as any;

describe("necessidadePorVarianteDaArvore", () => {
  it("soma consumo×grade×mult por variante real do rascunho", () => {
    const m = necessidadePorVarianteDaArvore(arvore);
    expect(m.get("vA")).toBe(20); // 2 × 10 × 1
  });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run --no-file-parallelism tests/unit/plan-tecido-nec-rascunho.test.ts`
Expected: FAIL (função não existe).

- [ ] **Step 3: Implementar a função pura**

```ts
// src/lib/plan-tecido/calc.ts
export function necessidadePorVarianteDaArvore(
  arvore: PtArvore,
  reprovados?: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const sub of arvore.subcolecoes ?? [])
    for (const ln of sub.linhas ?? [])
      for (const slot of ln.slots ?? []) {
        if (!slotContaNaDemanda(slot, reprovados)) continue; // reprovado/oculto fora
        for (const mat of slot.materiais ?? [])
          for (const v of mat.variantes ?? []) {
            if (v.oculta || !v.variante_tecido_id) continue;
            const m = necessidadeVariante(mat.consumo, v.grade_total, v.multiplicador);
            if (m > 0) out.set(v.variante_tecido_id, (out.get(v.variante_tecido_id) ?? 0) + m);
          }
      }
  return out;
}
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `npx vitest run --no-file-parallelism tests/unit/plan-tecido-nec-rascunho.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan-tecido/calc.ts tests/unit/plan-tecido-nec-rascunho.test.ts
git commit -m "feat(plan-tecido): necessidade por variante do rascunho (cliente) para o resumo ao vivo"
```

---

### Task 4: Resumo ao vivo — combina necessidade do rascunho + estoque/reserva do servidor

**Files:**
- Modify: `src/components/plan-tecido/ModoPlanoView.tsx` (usa a necessidade do rascunho quando disponível, em vez do `nec_m` do servidor)
- Test: `tests/unit/plan-tecido-resumo-ao-vivo.test.ts`

**Interfaces:**
- Consumes: `necessidadePorVarianteDaArvore` (Task 3); `estLivre` (Task 2); a `cobertura` do servidor (`fisico_m`, `prev_receb_m`, `reserva_outras_m` por variante — NÃO dependem do rascunho); a `arvore` (rascunho) que o `ModoPlanoView` já recebe por prop.
- Produces: o PLAN exibido por variante = `necessidadePorVarianteDaArvore(arvore).get(vid)` quando a variante existe no rascunho; EST/SOB/COMPR_exib recalculam ao vivo. (COMPR_exib = `max(0, plan_vivo − est_livre)` — exibição; a COMPRA real do wizard segue o `deficit_m` do servidor, salvo.)

- [ ] **Step 1: Teste unit que FALHA — PLAN vem do rascunho, EST do servidor**

```ts
// tests/unit/plan-tecido-resumo-ao-vivo.test.ts
import { describe, it, expect } from "vitest";
import { linhaResumoAoVivo } from "@/lib/plan-tecido/calc"; // combinador puro

describe("linhaResumoAoVivo", () => {
  it("PLAN do rascunho, EST do servidor, SOB/COMPR recalculam", () => {
    const r = linhaResumoAoVivo({
      planRascunho: 2000,                                   // cliente
      fisico_m: 0, prev_receb_m: 1170, reserva_outras_m: 641.6, // servidor
    });
    expect(r.est).toBeCloseTo(528.4, 1);
    expect(r.plan).toBe(2000);
    expect(r.sob).toBe(0);
    expect(r.compr).toBeCloseTo(1471.6, 1); // max(0, 2000 − 528.4)
  });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run --no-file-parallelism tests/unit/plan-tecido-resumo-ao-vivo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o combinador puro**

```ts
// src/lib/plan-tecido/calc.ts
export function linhaResumoAoVivo(x: {
  planRascunho: number; fisico_m: number; prev_receb_m: number; reserva_outras_m: number;
}): { plan: number; est: number; sob: number; compr: number } {
  const plan = Number(x.planRascunho) || 0;
  const est = estLivre(x);
  return { plan, est, sob: Math.max(0, est - plan), compr: Math.max(0, plan - est) };
}
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `npx vitest run --no-file-parallelism tests/unit/plan-tecido-resumo-ao-vivo.test.ts`
Expected: PASS.

- [ ] **Step 5: Ligar no ModoPlanoView — usar o rascunho quando houver**

Em `ModoPlanoView.tsx`: o componente já recebe `arvore` (prop). Calcular `const necViva = useMemo(() => necessidadePorVarianteDaArvore(arvore, reprovadoSet), [arvore, reprovadoSet])`. Na montagem de `LinhaVariante`, trocar `plan = Number(c.nec_m)||0` por `plan = necViva.get(c.variante_tecido_id) ?? (Number(c.nec_m)||0)` (fallback no servidor para variante que não está no rascunho). EST segue `estLivre` (servidor, não muda com o rascunho). Recalcular `sob`/`compr` do `plan` vivo.

> O `reprovadoSet` já existe no fluxo do ModoPlanoView (passado pelo pai). Se não estiver disponível no componente, recebê-lo por prop (o pai já o calcula).

- [ ] **Step 6: Anti-drift cliente×servidor (o número não "pula" ao salvar)**

```ts
// mesmo arquivo de teste: a necessidade do cliente = nec_m do servidor para o MESMO estado salvo.
it("necessidade do cliente bate com nec_m do servidor (não pula ao salvar)", () => {
  // monta uma árvore equivalente ao estado salvo e compara necessidadePorVarianteDaArvore
  // contra os nec_m que a prévia retornaria — tolerância 0,0001.
  // (usa uma fixture pequena já salva; se precisar do servidor, é integração — ver nota.)
});
```

- [ ] **Step 7: tsc + build + testes + commit**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "ModoPlanoView|calc|TS[0-9]" | head
npx vitest run --no-file-parallelism tests/unit/plan-tecido-resumo-ao-vivo.test.ts tests/unit/plan-tecido-nec-rascunho.test.ts tests/unit/plan-tecido-est-livre.test.ts
```
Expected: tsc limpo; testes PASS.

```bash
git add src/components/plan-tecido/ModoPlanoView.tsx src/lib/plan-tecido/calc.ts tests/unit/plan-tecido-resumo-ao-vivo.test.ts
git commit -m "feat(plan-tecido): resumo lateral ao vivo — PLAN do rascunho + EST/reserva do servidor"
```

---

### Task 5: Atualizar pinos md5 e CLAUDE.md/memória

**Files:**
- Modify: testes que pinam o md5 da prévia (se houver) — rodar a suíte e aceitar o novo md5.
- Modify: `CLAUDE.md` (bloco Plan. Tecido / §17.x do mapeamento se citar a conta do EST) + memória.

**Interfaces:**
- Consumes: o novo md5 da prévia (gerado na Task 1).
- Produces: suíte verde; docs coerentes.

- [ ] **Step 1: Rodar a suíte inteira de plan-tecido e ver o que pinava o md5**

Run: `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/ 2>&1 | grep -iE "plan.tecido|previa|md5|FAIL" | head`
Expected: identificar qualquer teste que pine o md5 antigo `dd563e57`.

- [ ] **Step 2: Aceitar o md5 novo nos pinos (não trocar número à mão sem rodar)**

Para cada teste que pina: capturar o md5 vivo pós-migration (`select md5(pg_get_functiondef(...))`) e atualizar o pino, OU usar lista que aceita o sucessor (padrão do repo).

- [ ] **Step 3: Build + tsc + suíte verde**

Run:
```bash
npx vite build 2>&1 | grep -E "built in|error" | tail -2
npx tsc --noEmit 2>&1 | grep -E "TS[0-9]" | head
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/ 2>&1 | tail -6
```
Expected: build ok; tsc limpo; suíte verde.

- [ ] **Step 4: Atualizar CLAUDE.md + memória + commit**

Documentar no bloco Plan. Tecido que o EST do Modo Plano = físico + a-chegar − reserva de outras coleções (exibição; `deficit_m`/compra intocados) e que o resumo recalcula ao vivo. Atualizar a memória `project_est_fisico_mais_achegar`.

```bash
git add CLAUDE.md docs/mapeamento-campos-calculos.md tests/
git commit -m "docs(plan-tecido): EST visual = fisico+a-chegar-reserva de outras; resumo ao vivo; md5 atualizado"
```

---

## Ordem de deploy (para o roteiro do painel)

Banco ANTES do site (a prévia nova expõe `reserva_outras_m` que o front novo lê; site novo + banco velho = chave ausente → EST cai no fallback). A migration é aditiva e só catálogo (CREATE OR REPLACE de 1 função) — sem trava de tabela, sem auth/storage. Volta: `20261117100000_est_reserva_outras_down.sql` (devolve o corpo F3.1, guarda md5 do novo). Prévia em localhost:5190 antes do deploy (o dono confere o caso do forro KOLONA SPANDEX + adicionar cor e ver o resumo ao vivo).
