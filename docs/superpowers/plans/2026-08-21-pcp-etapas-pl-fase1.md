# Etapas PL — Fase 1 (fundação + sheet do PCP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rastrear as etapas de produção PL DENTRO do sheet do PCP Serviços — campos de Peça Teste no bloco PL, etapa derivada do preenchimento, config por loja, reprovadas colapsadas — sem tela nova ainda.

**Architecture:** Colunas novas (nullable) no bloco `producao_terceirizados`; a etapa é DERIVADA por um helper puro `src/lib/pcp-etapas.ts` (nunca guardada); a RPC existente `salvar_terceirizados` passa a persistir os campos novos; o sheet do PCP ganha um painel "Etapas PL" nos blocos PL (categoria PL + `interno=false`), gated pelo módulo opt-in `etapas_pl`. O `/pcp` vira hub (corrige o título "Serviços"→"PCP").

**Tech Stack:** Vite + React + TypeScript, TanStack Router/Query, Supabase (Postgres + RLS), Tailwind + shadcn, Vitest (unit + integração txn revertida via psql). Design system Navy Trust v3 (`docs/design/ui-padroes.md`).

## Global Constraints

- Migration escrita em `supabase/migrations/` e aplicada com `psql "$(cat /tmp/dburl.txt)" -f <arq>` (regra 1 do CLAUDE.md). Idempotente (`IF NOT EXISTS`). Se destrutiva, `BEGIN;…COMMIT;` — aqui NÃO é destrutiva.
- Ao alterar função existente: **diff-validar** `pg_get_functiondef` antes/depois; só o delta pretendido.
- `_core`/funções privilegiadas: EXECUTE revogado de `PUBLIC, anon, authenticated` (invariante #9). Aqui não criamos `_core` novo.
- Antes de cada commit: `npm run build` + `npx tsc --noEmit 2>&1 | grep TS2304`. Anti-drift `tests/unit/ui-padroes-antidrift.test.ts` deve passar.
- UI: campos editáveis nascem vazios com placeholder (§D/§Q11); datas via `<DateField>` (dd/mm/aaaa); ações de ciclo na barra sticky; NÃO editar `src/components/ui/` sem necessidade.
- PL = categoria "PL" (`isServicoPL`, `src/lib/servico-confeccao.ts`) **E** `producao_terceirizados.interno = false`.
- Etapas (default, ordem/gatilho FIXOS): 1 Peça Teste (ao aprovar) · 2 Separação de Materiais (`data_enviado`) · 3 Retorno de Grade de Corte (`grade_detalhe.cortada>0`) · 4 Oficina (`data_entregue` + `qtd_recebida>0`) · 5 Finalização (terminal). Etapa desativada é PULADA.
- Módulo `etapas_pl`: opt-in, default OFF — override em `useTenantModules.DEFAULTS` E `admin/lojas.tsx MODULE_DEFAULTS` (padrão `otb`/`produto_acabado`).
- Front acessa colunas novas com `as any` (types.ts não regenerado — débito conhecido).

---

### Task 1: Migration — colunas de Peça Teste + config `pcp_etapas` + módulo `etapas_pl`

**Files:**
- Create: `supabase/migrations/20260821120000_pcp_etapas_pl_fase1.sql`

**Interfaces:**
- Produces: `producao_terceirizados.pt_data_saida date`, `.pt_data_entrada date`, `.pt_aprovacao text` (CHECK `in ('aprovado','reprovado')`, nullable); `tenant_config.pcp_etapas jsonb`; leitura do módulo via `tenant_config.modules->>'etapas_pl'`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 20260821120000_pcp_etapas_pl_fase1.sql
-- Fase 1 das Etapas PL: campos de Peça Teste no bloco + config das etapas. NÃO destrutiva.
BEGIN;

ALTER TABLE public.producao_terceirizados
  ADD COLUMN IF NOT EXISTS pt_data_saida   date,
  ADD COLUMN IF NOT EXISTS pt_data_entrada date,
  ADD COLUMN IF NOT EXISTS pt_aprovacao    text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'producao_terceirizados_pt_aprovacao_chk') THEN
    ALTER TABLE public.producao_terceirizados
      ADD CONSTRAINT producao_terceirizados_pt_aprovacao_chk
      CHECK (pt_aprovacao IS NULL OR pt_aprovacao IN ('aprovado','reprovado'));
  END IF;
END $$;

-- config das 5 etapas (ordem/gatilho fixos; label renomeável; ativa liga/desliga).
-- default aplicado em tempo de LEITURA no front; aqui só garantimos a coluna.
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS pcp_etapas jsonb;

COMMIT;
```

- [ ] **Step 2: Aplicar e verificar**

Run:
```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260821120000_pcp_etapas_pl_fase1.sql
psql "$(cat /tmp/dburl.txt)" -c "select column_name from information_schema.columns where table_name='producao_terceirizados' and column_name like 'pt_%';"
```
Expected: 3 linhas (`pt_data_saida`, `pt_data_entrada`, `pt_aprovacao`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260821120000_pcp_etapas_pl_fase1.sql
git commit -m "feat(pcp-etapas): migration fase 1 — campos Peça Teste + pcp_etapas config"
```

---

### Task 2: Helper puro `src/lib/pcp-etapas.ts` (derivação da etapa) — TDD

**Files:**
- Create: `src/lib/pcp-etapas.ts`
- Test: `tests/unit/pcp-etapas.test.ts`

**Interfaces:**
- Produces:
  - `type EtapaKey = 'peca_teste'|'separacao'|'retorno_grade'|'oficina'|'finalizacao'`
  - `type EtapaCfg = { key: EtapaKey; label: string; ativa: boolean }`
  - `const ETAPAS_DEFAULT: EtapaCfg[]` (5 itens, todas ativas, rótulos default)
  - `type BlocoEtapa = { pt_data_saida: string|null; pt_data_entrada: string|null; pt_aprovacao: 'aprovado'|'reprovado'|null; data_enviado: string|null; data_entregue: string|null; qtd_recebida: number|null; grade_detalhe?: Record<string, Record<string, { cortada?: number }>> | null }`
  - `function etapaDoBloco(b: BlocoEtapa, etapas: EtapaCfg[]): { key: EtapaKey|null; reprovada: boolean }` — retorna a etapa ATUAL (última completa +1, pulando inativas) ou `reprovada:true` quando `pt_aprovacao==='reprovado'`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// tests/unit/pcp-etapas.test.ts
import { describe, it, expect } from "vitest";
import { etapaDoBloco, ETAPAS_DEFAULT, type BlocoEtapa } from "@/lib/pcp-etapas";

const base: BlocoEtapa = { pt_data_saida:null, pt_data_entrada:null, pt_aprovacao:null, data_enviado:null, data_entregue:null, qtd_recebida:null, grade_detalhe:null };

describe("etapaDoBloco", () => {
  it("sem nada preenchido → peça teste", () => {
    expect(etapaDoBloco(base, ETAPAS_DEFAULT)).toEqual({ key:"peca_teste", reprovada:false });
  });
  it("peça teste aprovada → separação", () => {
    const b = { ...base, pt_data_saida:"2026-07-28", pt_data_entrada:"2026-08-04", pt_aprovacao:"aprovado" as const };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT)).toEqual({ key:"separacao", reprovada:false });
  });
  it("reprovada → fica em peça teste com reprovada=true", () => {
    const b = { ...base, pt_data_saida:"2026-07-20", pt_data_entrada:"2026-07-27", pt_aprovacao:"reprovado" as const };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT)).toEqual({ key:"peca_teste", reprovada:true });
  });
  it("data_enviado preenchida (aprovada) → retorno de grade", () => {
    const b = { ...base, pt_data_saida:"a", pt_data_entrada:"b", pt_aprovacao:"aprovado" as const, data_enviado:"2026-08-08" };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT).key).toBe("retorno_grade");
  });
  it("grade cortada retornada → oficina", () => {
    const b = { ...base, pt_data_saida:"a", pt_data_entrada:"b", pt_aprovacao:"aprovado" as const, data_enviado:"x", grade_detalhe:{ "v1":{ "M":{ cortada:10 } } } };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT).key).toBe("oficina");
  });
  it("entregue + recebida → finalização", () => {
    const b = { ...base, pt_data_saida:"a", pt_data_entrada:"b", pt_aprovacao:"aprovado" as const, data_enviado:"x", grade_detalhe:{ "v1":{ "M":{ cortada:10 } } }, data_entregue:"2026-09-01", qtd_recebida:10 };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT).key).toBe("finalizacao");
  });
  it("etapa 3 desativada → separação pula direto p/ oficina qdo data_enviado preenchida", () => {
    const etapas = ETAPAS_DEFAULT.map(e => e.key==="retorno_grade" ? { ...e, ativa:false } : e);
    const b = { ...base, pt_data_saida:"a", pt_data_entrada:"b", pt_aprovacao:"aprovado" as const, data_enviado:"x" };
    expect(etapaDoBloco(b, etapas).key).toBe("oficina");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx vitest run tests/unit/pcp-etapas.test.ts`
Expected: FAIL ("Cannot find module '@/lib/pcp-etapas'").

- [ ] **Step 3: Implementar o helper**

```ts
// src/lib/pcp-etapas.ts
export type EtapaKey = "peca_teste" | "separacao" | "retorno_grade" | "oficina" | "finalizacao";
export type EtapaCfg = { key: EtapaKey; label: string; ativa: boolean };

export const ETAPAS_DEFAULT: EtapaCfg[] = [
  { key: "peca_teste",    label: "Peça Teste",                 ativa: true },
  { key: "separacao",     label: "Separação de Materiais",     ativa: true },
  { key: "retorno_grade", label: "Retorno de Grade de Corte",  ativa: true },
  { key: "oficina",       label: "Oficina",                    ativa: true },
  { key: "finalizacao",   label: "Finalização",                ativa: true },
];

export type BlocoEtapa = {
  pt_data_saida: string | null; pt_data_entrada: string | null;
  pt_aprovacao: "aprovado" | "reprovado" | null;
  data_enviado: string | null; data_entregue: string | null; qtd_recebida: number | null;
  grade_detalhe?: Record<string, Record<string, { cortada?: number }>> | null;
};

function cortadaRetornou(gd: BlocoEtapa["grade_detalhe"]): boolean {
  if (!gd) return false;
  for (const v of Object.values(gd)) for (const c of Object.values(v)) if ((c?.cortada ?? 0) > 0) return true;
  return false;
}

// true = a etapa está COMPLETA (o card já saiu dela).
function completa(key: EtapaKey, b: BlocoEtapa): boolean {
  switch (key) {
    case "peca_teste":    return Boolean(b.pt_data_saida && b.pt_data_entrada && b.pt_aprovacao === "aprovado");
    case "separacao":     return Boolean(b.data_enviado);
    case "retorno_grade": return cortadaRetornou(b.grade_detalhe);
    case "oficina":       return Boolean(b.data_entregue && (b.qtd_recebida ?? 0) > 0);
    case "finalizacao":   return false; // terminal
  }
}

export function etapaDoBloco(b: BlocoEtapa, etapas: EtapaCfg[]): { key: EtapaKey | null; reprovada: boolean } {
  if (b.pt_aprovacao === "reprovado") return { key: "peca_teste", reprovada: true };
  const ativas = etapas.filter((e) => e.ativa);
  let atual: EtapaKey | null = ativas[0]?.key ?? null;
  for (const e of ativas) {
    if (completa(e.key, b)) {
      const idx = ativas.findIndex((x) => x.key === e.key);
      atual = ativas[idx + 1]?.key ?? e.key; // se a última completa, fica nela
    } else break;
  }
  return { key: atual, reprovada: false };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/pcp-etapas.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pcp-etapas.ts tests/unit/pcp-etapas.test.ts
git commit -m "feat(pcp-etapas): helper puro etapaDoBloco + testes"
```

---

### Task 3: `salvar_terceirizados` persiste os campos de Peça Teste — teste txn

**Files:**
- Modify: `supabase/migrations/20260821130000_salvar_terceirizados_pt.sql` (Create)
- Test: `tests/integration/pcp-etapas-salvar.test.ts` (Create)

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces: `salvar_terceirizados` grava `pt_data_saida/pt_data_entrada/pt_aprovacao` a partir do jsonb de cada bloco (chaves `pt_data_saida`, `pt_data_entrada`, `pt_aprovacao`).

- [ ] **Step 1: Dump da definição VIVA da função (base do diff)**

Run: `psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public.salvar_terceirizados'::regprocedure);" > /tmp/salvar_terc_before.sql`
Expected: arquivo com o corpo atual (a função faz UPSERT dos blocos por id).

- [ ] **Step 2: Escrever a migration (CREATE OR REPLACE sobre o def VIVO, adicionando só os 3 campos ao UPSERT)**

Editar a partir de `/tmp/salvar_terc_before.sql`: no INSERT e no UPDATE de `producao_terceirizados`, acrescentar as 3 colunas lendo do bloco jsonb `b`:
```sql
-- no INSERT (lista de colunas + values):
--   ..., pt_data_saida, pt_data_entrada, pt_aprovacao
--   ..., NULLIF(b->>'pt_data_saida','')::date, NULLIF(b->>'pt_data_entrada','')::date, NULLIF(b->>'pt_aprovacao','')
-- no UPDATE SET:
--   pt_data_saida   = NULLIF(b->>'pt_data_saida','')::date,
--   pt_data_entrada = NULLIF(b->>'pt_data_entrada','')::date,
--   pt_aprovacao    = NULLIF(b->>'pt_aprovacao','')
```
Salvar como `supabase/migrations/20260821130000_salvar_terceirizados_pt.sql` (`CREATE OR REPLACE FUNCTION public.salvar_terceirizados(...)` com o corpo completo editado).

- [ ] **Step 3: Aplicar + diff-validar**

Run:
```bash
psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260821130000_salvar_terceirizados_pt.sql
psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public.salvar_terceirizados'::regprocedure);" > /tmp/salvar_terc_after.sql
diff /tmp/salvar_terc_before.sql /tmp/salvar_terc_after.sql
```
Expected: diff mostra SÓ as 3 colunas adicionadas (INSERT + UPDATE), nada mais.

- [ ] **Step 4: Teste txn revertido (grava e lê de volta)**

```ts
// tests/integration/pcp-etapas-salvar.test.ts — segue o padrão de tests/integration/*.test.ts (withTx)
// BEGIN; set request.jwt.claims (super_admin); montar 1 modelo+cad+bloco PL; chamar salvar_terceirizados
// com b.pt_data_saida/entrada/aprovacao; SELECT de volta e assert; ROLLBACK.
```
Rodar: `npx vitest run tests/integration/pcp-etapas-salvar.test.ts`
Expected: PASS (os 3 campos voltam com os valores enviados; bloco sem os campos → NULL).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260821130000_salvar_terceirizados_pt.sql tests/integration/pcp-etapas-salvar.test.ts
git commit -m "feat(pcp-etapas): salvar_terceirizados grava campos de Peça Teste (diff-validado)"
```

---

### Task 4: Módulo `etapas_pl` (opt-in) + config `pcp_etapas` no front

**Files:**
- Modify: `src/hooks/useTenantModules.ts` (DEFAULTS)
- Modify: `src/routes/_authenticated/admin/lojas.tsx` (MODULE_DEFAULTS + MODULE_TOGGLES)
- Modify: `src/routes/_authenticated/admin/configuracoes.tsx` (bloco "Etapas do PCP" + badge read-only do módulo)

**Interfaces:**
- Consumes: `ETAPAS_DEFAULT` (Task 2); `tenant_config.pcp_etapas` (Task 1).
- Produces: `useTenantModules().isModuleEnabled('etapas_pl')`; Config lê/salva `pcp_etapas` (5 itens `{key,label,ativa}`, default = `ETAPAS_DEFAULT`).

- [ ] **Step 1: Ligar o módulo opt-in** — em `useTenantModules.ts` add `etapas_pl: false` em `DEFAULTS`; em `admin/lojas.tsx` add `etapas_pl:false` em `MODULE_DEFAULTS` e uma entrada em `MODULE_TOGGLES` (rótulo "Etapas PL (kanban)", super_admin), deduplicando por `m.gate ?? m.module`.

- [ ] **Step 2: Config "Etapas do PCP"** — em `admin/configuracoes.tsx`, novo Card: lista dos 5 itens (default `ETAPAS_DEFAULT` quando `pcp_etapas` vazio), cada linha com Input de `label` (renomear) + toggle `ativa`; salvar em `tenant_config.pcp_etapas`. Sem reordenar/adicionar (drag desabilitado). Badge read-only do módulo em `MODULE_LABELS`.

- [ ] **Step 3: Verificar** — `npx tsc --noEmit | grep TS2304`; abrir Config no navegador (:5173) e conferir renomear + toggle salvam.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTenantModules.ts src/routes/_authenticated/admin/lojas.tsx src/routes/_authenticated/admin/configuracoes.tsx
git commit -m "feat(pcp-etapas): módulo etapas_pl opt-in + config das 5 etapas (renomear/ativa)"
```

---

### Task 5: Painel "Etapas PL" no bloco PL do sheet (Peça Teste + badge de etapa)

**Files:**
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx` (bloco PL, região `:1238`–`:1621`)
- Create: `src/components/producao/EtapasPlPanel.tsx`

**Interfaces:**
- Consumes: `etapaDoBloco`, `ETAPAS_DEFAULT`, `EtapaCfg` (Task 2); `isServicoPL` (`@/lib/servico-confeccao`); `isModuleEnabled('etapas_pl')` (Task 4); config `pcp_etapas`.
- Produces: `<EtapasPlPanel bloco etapas onChange readOnly />` render dentro do body do bloco quando `!bloco.interno && isServicoPL(categoriaNome) && isModuleEnabled('etapas_pl')`.

- [ ] **Step 1:** `EtapasPlPanel.tsx` — painel destacado: **badge da etapa atual** (via `etapaDoBloco`), seção **Peça Teste** (`<DateField>` Saída, `<DateField>` Entrada, `<Select>` Aprovação Aprovado/Reprovado), e a nota "etapa 2 = Data Enviado; 3 = Grade Cortada; 4 = Data Entregue + Recebida" (texto). `onChange(campo, valor)` propaga p/ o estado do bloco no pai (mesmo mecanismo dos outros campos do bloco → entra no payload de `salvar_terceirizados`). Campos vazios nascem com placeholder (§Q11).

- [ ] **Step 2:** No `pcp.servicos.$modeloId.tsx`, importar e renderizar `<EtapasPlPanel>` ao fim do body do bloco, com o gate acima. Ligar os 3 campos ao `Bloco` (add `pt_data_saida/entrada/aprovacao` ao tipo `Bloco` `:112`, ao map de leitura `:623`, e ao payload `:845`).

- [ ] **Step 3:** `npx tsc --noEmit | grep -E 'TS2304|servicos'`; `npm run build`; anti-drift `npx vitest run tests/unit/ui-padroes-antidrift.test.ts`. QA no navegador (:5173): abrir um modelo com bloco PL → painel aparece, preencher Saída/Entrada/Aprovar → badge muda de etapa → Salvar → reload persiste.

- [ ] **Step 4: Commit**

```bash
git add src/components/producao/EtapasPlPanel.tsx "src/routes/_authenticated/pcp.servicos.\$modeloId.tsx"
git commit -m "feat(pcp-etapas): painel Etapas PL (Peça Teste + badge de etapa) no bloco do sheet"
```

---

### Task 6: Colapsável "PLs reprovadas na peça teste" no rodapé do bloco PL

**Files:**
- Modify: `src/components/producao/EtapasPlPanel.tsx` (ou um sibling `ReprovadasPl.tsx`)
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx`

**Interfaces:**
- Consumes: os blocos PL do modelo (já carregados no sheet); `etapaDoBloco` (`.reprovada`).
- Produces: um `<Collapsible>` no rodapé da área dos blocos PL listando os blocos PL com `pt_aprovacao='reprovado'`, ordenados por `pt_data_saida`, rotulados pela PL (`PL · {empresa}`), colapsado por default.

- [ ] **Step 1:** Componente `ReprovadasPl` — recebe os blocos PL reprovados; `<Collapsible>` (padrão `EstoqueTecidosTab`), header "PLs reprovadas na peça teste" + contador, corpo = 1 item por bloco (`PL · empresa` + "reprovada · saída dd/mm/aaaa" + "nova saída reabre"). Ordenar por `pt_data_saida` asc.

- [ ] **Step 2:** Renderizar após a lista de blocos PL no sheet (só quando há ≥1 reprovado e `etapas_pl` on).

- [ ] **Step 3:** `tsc`/`build`/anti-drift. QA: reprovar uma peça teste → bloco some do fluxo normal e aparece no colapsável.

- [ ] **Step 4: Commit**

```bash
git add src/components/producao/ReprovadasPl.tsx "src/routes/_authenticated/pcp.servicos.\$modeloId.tsx"
git commit -m "feat(pcp-etapas): colapsável de PLs reprovadas na peça teste no sheet"
```

---

### Task 7: Hub PCP — corrige o título "Serviços"→"PCP" (e prepara Etapas no sidebar)

**Files:**
- Modify: `src/routes/_authenticated/pcp.index.tsx`
- Modify: `src/lib/nav.ts` (PAGE_URLS + PAGE_ICONS)

**Interfaces:**
- Consumes: `SectionHub` (`src/components/SectionHub.tsx`); catálogo de permissões `pcp`.
- Produces: `/pcp` renderiza o hub "PCP" (não redireciona); `producao_terceirizados` entra em `PAGE_URLS` como `/pcp/servicos` (vira card do hub).

- [ ] **Step 1:** `pcp.index.tsx` — trocar o `redirect` por render do `<SectionHub module="pcp" />` (espelhar `expedicao.index.tsx`/`cadastro.index.tsx`). O título do hub vem do catálogo (`label: "PCP"`).

- [ ] **Step 2:** `nav.ts` — add `producao_terceirizados: "/pcp/servicos"` em `PAGE_URLS` (hoje está fora de propósito) + ícone em `PAGE_ICONS`. Conferir que Serviços continua acessível e o sidebar mostra PCP como hub.

- [ ] **Step 3:** `tsc`/`build`. QA (:5173): entrar em PCP → título "PCP" (hub com card Serviços), não mais "Serviços" direto.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/pcp.index.tsx src/lib/nav.ts
git commit -m "fix(pcp): /pcp vira hub (corrige título 'Serviços'→'PCP') — prepara Etapas no sidebar"
```

---

## Self-Review

**Spec coverage (§ do spec → task):** §4 modelo derivado → T2; §6 bloco PL Peça Teste + reprovadas → T5/T6; §5 config (módulo + pcp_etapas) → T4; §8 hub PCP + título → T7; §9 dado (colunas + config) → T1; §9 `salvar_terceirizados` → T3. **Fora da Fase 1 (fases seguintes):** somas travadas (melhoria do sheet, Fase 2), prazo/S2, parcelas/S3, NF/S4, peça-foto/S5, kanban/Fase 2 — explícito no spec §12.

**Placeholder scan:** os passos de UI (T5/T6/T7) descrevem componente + gate + arquivos:linha + QA concreto, mas não trazem o JSX final linha a linha (a integração depende do estado real do sheet no momento). São tasks de UI com interface definida; o executor implementa seguindo os padrões citados (`DateField`, `Collapsible` do `EstoqueTecidosTab`, `SectionHub`). Os passos de dado/helper/RPC (T1–T4) trazem código real.

**Type consistency:** `EtapaKey`/`EtapaCfg`/`BlocoEtapa`/`etapaDoBloco`/`ETAPAS_DEFAULT` usados igualmente em T2/T4/T5/T6. Colunas `pt_data_saida/pt_data_entrada/pt_aprovacao` idênticas em T1/T3/T5.

**Riscos:** T3 depende de editar o def VIVO de `salvar_terceirizados` (grande) — o passo de dump+diff protege contra regressão (invariante do CLAUDE.md).
