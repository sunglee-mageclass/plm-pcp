# Grade Cortada (CORTADA) no PCP → CQ → Grade Real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O serviço de confecção (PL/Oficina) reporta no PCP a grade CORTADA por tamanho×variante; essa grade vira a referência do CQ ("Grade Cortada"), Recebido/Defeito passam a ser uma FONTE ÚNICA compartilhada entre PCP e CQ (o `grade_detalhe` do bloco-fonte), e a Grade Real = Recebido − Defeito dessa fonte, gravada atomicamente em `cad_grades.grades_reais`.

**Architecture:** O `grade_detalhe` jsonb do bloco-fonte (`producao_terceirizados`) é a **fonte canônica** de `cortada/recebida/defeito` — não há espelho nem trigger de cópia. O CQ e o PCP leem/gravam **a mesma estrutura** via RPC atômica; a chave `variante_tecido_id` (PCP) ↔ `variante_numero` (CQ/`cad_grades`) é traduzida pela `cad_tecido_variantes.ordem`. A resolução do bloco-fonte é **autoridade do servidor** (helper SQL `_resolver_fonte_confeccao`), espelhada na UI por um helper TS puro. O recurso é **opt-in por existência de um bloco-fonte destrinchado** — modelos sem ele seguem exatamente como hoje.

**Tech Stack:** Vite + React + TypeScript + TanStack Router/Query; Supabase (Postgres + RLS, RPCs `SECURITY DEFINER`); Vitest (unit puro + integração transacional revertida via `psql`); Tailwind + Radix.

## Global Constraints

Copiadas verbatim da spec e do CLAUDE.md — valem para TODA task:

- **`cortada` é o 4º campo do `grade_detalhe`** (aditivo; chave/valor ausente lê-se como `0`). Célula = `{ enviada, cortada, recebida, defeito }`.
- **CORTADA é editada só no PCP**; no CQ é **read-only**. `Recebida/Defeito` são a fonte única compartilhada.
- **Recebido E Defeito = dois grids SEPARADOS, NÃO soma.** Canônico = `producao_terceirizados.grade_detalhe` do bloco-fonte. Sem espelho, sem trigger de cópia.
- **Grade Real = `max(0, recebida − defeito)` por célula**, gravada em `cad_grades.grades_reais` na MESMA transação — invariante #6 intacta.
- **`cad_grades.grades_planejada` PERMANECE** no dado (corte/déficit — invariante #7); só a **exibição** da referência no CQ muda para a cortada.
- **Fonte por prioridade PL → Oficina**, **1 bloco-fonte por modelo**; guarda de ambiguidade (banner + prioridade determinística). Config no Cadastro (`tenant_config.confeccao_prioridade`); sem config = default PL→Oficina.
- **Retrocompatível**: modelo sem bloco-fonte destrinchado = CQ e PCP como hoje (Grade CAD como referência; recebimento/defeito próprios do CQ em `cq_variantes`).
- **Segurança (invariante #9):** padrão wrapper + `_core`; helpers `_core` novos → `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated;` (os TRÊS). Validar caller vs tenant do CAD dentro do DEFINER.
- **Migração aplicada via `psql "$(cat /tmp/dburl.txt)" -f <arq>`** (regra 1). Migração destrutiva/consolidação → envolver em `BEGIN; … COMMIT;` e escrever idempotente (`IF EXISTS`/`IF NOT EXISTS`, guards). **NÃO criar UNIQUE/FK em coluna embedada.**
- **Erros em PT-BR**; `npm run build` **não** roda tsc → rodar `npx tsc --noEmit`. Lint é débito pré-existente (lintar só arquivos tocados).
- **types.ts está desatualizado** (regen pende de `supabase login`) → colunas/RPCs novas acessadas no front via `as any`/cast (padrão vigente).

---

## Descobertas do código real (base de decisão — LEIA antes de codar)

Verificado por leitura de código e `psql` no banco vivo:

- **Onde o CQ guarda HOJE recebimento/defeito:** tabela **`cq_variantes`** — 1 linha por `(controle_qualidade_id, variante_numero, etapa)`, `etapa ∈ {recebimento, conserto, lavagem, defeito}`, `grades` jsonb `{ tamanho: qtd }`, chaveada por **`variante_numero` (int)**. Não existe coluna de recebido/defeito por-tamanho em `controle_qualidade` (só escalares `pecas_*`).
- **Como `salvar_cq` monta a Grade Real:** o FRONT calcula `realByNum` = `max(0, recebimento − defeito)` por célula (`expedicao.cq.$modeloId.tsx:359-374`) e envia `_reais`; `_salvar_cq_core` grava `_reais` em `cad_grades.grades_reais`/`grade_total_real` **só quando confirmado** (`ON CONFLICT (cad_id, variante_numero) DO UPDATE`). `_desmarcar_cq_core` **reverte** `grades_reais := grades_planejadas`.
- **PCP `grade_detalhe`** é chaveado por **`variante_tecido_id` (UUID)**; célula hoje `{ enviada, recebida, defeito }` (`pcp.servicos.$modeloId.tsx:84-87`). `salvar_terceirizados` grava `grade_detalhe` **mas NÃO toca `cad_grades`** — hoje editar recebida no PCP não mexe na Grade Real.
- **Ponte de chave (crítico):** `variante_numero` (CQ/`cad_grades`/`modelo_grades`) **== `ordem`** de `cad_tecido_variantes`/`modelo_tecido_variantes` do Tecido Principal (`numero=1`). O PCP já usa isso: `planejado[v.id] = byNum.get(v.ordem)` (`pcp...:356`). `cad_tecido_variantes(variante_tecido_id, ordem)` é o mapa `vid ↔ numero`.
- **Helper de confecção já existe:** `src/lib/servico-confeccao.ts::isServicoConfeccao(nome)` (tokens oficina/costura/pl/private label). In-flight: só a categoria **"PL"** tem bloco `detalhado` hoje (2 blocos detalhados em 5).

### DECISÃO DE ARQUITETURA (o crux T3/T4)

**`grade_detalhe` do bloco-fonte é canônico; o CQ lê/grava ELE direto via RPC atômica — SEM espelho.** Motivos e mecânica:

1. **Atomicidade existe naturalmente:** `salvar_cq` é UM DEFINER = UMA txn. Ele pode `UPDATE producao_terceirizados.grade_detalhe` do bloco-fonte **e** upsert `cad_grades` no mesmo corpo. Não precisa de trigger de cópia (que traria drift + tradução de chave frágil dentro de trigger). Espelho seria pior: dois armazenamentos do "mesmo dado" divergem.
2. **Tradução de chave** (`variante_numero` ↔ `variante_tecido_id`) acontece na RPC via `cad_tecido_variantes.ordem`. O servidor é a autoridade da resolução do bloco-fonte (`_resolver_fonte_confeccao`), coerente com invariante #9 (não confiar no cliente).
3. **Escopo do que muda de armazenamento:** para modelo COM bloco-fonte, `recebida/defeito/cortada` moram em `grade_detalhe`. `conserto/lavagem` e `destino_defeito` **continuam em `cq_variantes`** (a linha `etapa='defeito'` passa a carregar só o `destino_defeito`; a quantidade de defeito vem de `grade_detalhe`). Modelo SEM bloco-fonte: tudo em `cq_variantes` como hoje.
4. **Simetria PCP→Grade Real:** `salvar_terceirizados`, ao salvar o bloco-fonte, **re-deriva `cad_grades.grades_reais`** do `grade_detalhe` (mesma fórmula `recebida−defeito`) **quando já existe CQ confirmado** — assim "editar recebida no PCP move a Grade Real" é literal, e ambos os writers derivam da MESMA fonte (zero drift). Se o CQ não está confirmado, o PCP só grava `grade_detalhe`; o `salvar_cq` deriva depois. O trigger `fn_rebaixa_direcionamento_grade` (invariante #10) dispara normalmente no `UPDATE OF grades_reais`.

**Reconciliação de dados em voo:** modelos com bloco-fonte que HOJE têm recebimento em `cq_variantes` mas `grade_detalhe.recebida/.defeito` vazios → migração idempotente faz **backfill de `grade_detalhe` a partir de `cq_variantes`** (traduzindo `numero→vid`), para o CQ não exibir vazio ao trocar a fonte. `grade_detalhe` é autoritativo: onde ambos existem e divergem, **prefere `grade_detalhe` (PCP)** e apenas registra `RAISE NOTICE` (log). `cad_grades.grades_reais` já persistido de CQs confirmados permanece válido e não é tocado pela migração.

---

## File Structure

- `src/lib/grade-cortada.ts` **(criar)** — helpers puros de célula/saldo/Grade Real por célula (unit-testável). Responsabilidade: aritmética da célula `{enviada,cortada,recebida,defeito}`.
- `src/lib/confeccao-fonte.ts` **(criar)** — resolver TS puro do bloco-fonte (prioridade PL→Oficina + flag `ambiguo`). Espelha a decisão do servidor para a UI.
- `src/lib/servico-confeccao.ts` **(modificar)** — adicionar `isServicoPL(nome)`.
- `src/routes/_authenticated/pcp.servicos.$modeloId.tsx` **(modificar)** — `CelulaGrade` ganha `cortada`; `CAMPOS_GRADE` insere CORTADA entre Enviada e Recebida; bloco de Saldo derivado; totais Σ.
- `src/routes/_authenticated/expedicao.cq.$modeloId.tsx` **(modificar)** — query do bloco-fonte + mapas `ordem↔vid`; "Grade (CAD)" vira "Grade Cortada" read-only quando há fonte; seed de recebido/defeito do `grade_detalhe`; alerta vs cortada; branch retrocompatível.
- `src/routes/_authenticated/cadastro.servico.tsx` **(modificar)** — UI mínima de ordenar prioridade das categorias de confecção (grava `tenant_config.confeccao_prioridade`).
- `supabase/migrations/20260806120000_confeccao_prioridade.sql` **(criar)** — coluna aditiva `tenant_config.confeccao_prioridade jsonb`.
- `supabase/migrations/20260806130000_grade_cortada_fonte_unica.sql` **(criar)** — `_categoria_eh_confeccao`, `_resolver_fonte_confeccao`, extensão de `_salvar_cq_core` e `salvar_terceirizados`, reconciliação (BEGIN/COMMIT).
- `tests/unit/grade-cortada.test.ts` **(criar)**, `tests/unit/confeccao-fonte.test.ts` **(criar)**.
- `tests/integration/grade-cortada.test.ts` **(criar)** — fonte única, atomicidade, retrocompat, guarda, reconciliação (txn revertida).

---

### Task 1: PCP — campo `cortada`, coluna CORTADA, Saldo e totais

**Files:**
- Create: `src/lib/grade-cortada.ts`
- Create: `tests/unit/grade-cortada.test.ts`
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx` (`CelulaGrade`/`CELULA_ZERO`/`somaGrade` ~l.84-108; `CAMPOS_GRADE` l.1387-1391; `GradeEditor` l.1392-1450; totais Σ ~l.1115-1167)

**Interfaces:**
- Produces: `type CelulaGrade = { enviada: number; cortada: number; recebida: number; defeito: number }`; `saldoCelula(c: CelulaGrade): number` (= `cortada − recebida`); `somaCampo(g, campo)`; `gradeRealCelula(c): number` (= `max(0, recebida − defeito)`). Consumido por Task 4 e (aritmética espelhada) pela RPC da Task 3.

- [ ] **Step 1: Write the failing unit test**

Criar `tests/unit/grade-cortada.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { saldoCelula, gradeRealCelula, somaCampo, CELULA_ZERO } from "@/lib/grade-cortada";

describe("grade-cortada helpers", () => {
  it("saldoCelula = cortada − recebida (pode ser negativo)", () => {
    expect(saldoCelula({ enviada: 0, cortada: 10, recebida: 4, defeito: 0 })).toBe(6);
    expect(saldoCelula({ enviada: 0, cortada: 3, recebida: 5, defeito: 0 })).toBe(-2);
  });
  it("gradeRealCelula = max(0, recebida − defeito)", () => {
    expect(gradeRealCelula({ enviada: 0, cortada: 0, recebida: 8, defeito: 3 })).toBe(5);
    expect(gradeRealCelula({ enviada: 0, cortada: 0, recebida: 2, defeito: 9 })).toBe(0);
  });
  it("somaCampo soma o campo sobre toda a grade (chave ausente = 0)", () => {
    const g = { vA: { "38|P": { cortada: 5, recebida: 2 } as any }, vB: { "40|M": { cortada: 3 } as any } };
    expect(somaCampo(g as any, "cortada")).toBe(8);
    expect(somaCampo(g as any, "recebida")).toBe(2);
  });
  it("CELULA_ZERO zera os quatro campos", () => {
    expect(CELULA_ZERO).toEqual({ enviada: 0, cortada: 0, recebida: 0, defeito: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/grade-cortada.test.ts`
Expected: FAIL — "Cannot find module '@/lib/grade-cortada'".

- [ ] **Step 3: Create the pure lib**

Criar `src/lib/grade-cortada.ts`:

```ts
// Aritmética pura da célula da grade destrinchada: { enviada, cortada, recebida, defeito }.
// A CORTADA (reportada pela confecção no PCP) é o 4º campo, aditivo — chave ausente = 0.
export type CelulaGrade = { enviada: number; cortada: number; recebida: number; defeito: number };
export type GradeDetalhe = Record<string, Record<string, CelulaGrade>>;
export const CELULA_ZERO: CelulaGrade = { enviada: 0, cortada: 0, recebida: 0, defeito: 0 };

const n = (v: unknown) => Number(v) || 0;

/** Saldo a receber = Cortada − Recebida (negativo = recebeu mais que o cortado; anomalia). */
export function saldoCelula(c: Partial<CelulaGrade> | undefined): number {
  return n(c?.cortada) - n(c?.recebida);
}

/** Grade Real por célula = max(0, Recebida − Defeito). */
export function gradeRealCelula(c: Partial<CelulaGrade> | undefined): number {
  return Math.max(0, n(c?.recebida) - n(c?.defeito));
}

/** Soma um campo (enviada/cortada/recebida/defeito) sobre toda a grade de um bloco. */
export function somaCampo(g: GradeDetalhe | undefined, campo: keyof CelulaGrade): number {
  let s = 0;
  for (const vid in g ?? {}) for (const t in g![vid] ?? {}) s += n(g![vid][t]?.[campo]);
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/grade-cortada.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Wire `cortada` into the PCP type and totals**

Em `pcp.servicos.$modeloId.tsx`, substituir a definição local de `CelulaGrade`/`CELULA_ZERO`/`somaGrade` (l.84-108) por reuso da lib e adicionar `cortada`. Trocar:

```ts
// { variante_tecido_id: { tamanho: { enviada, cortada, recebida, defeito } } }
type CelulaGrade = { enviada: number; cortada: number; recebida: number; defeito: number };
type GradeDetalhe = Record<string, Record<string, CelulaGrade>>;
const CELULA_ZERO: CelulaGrade = { enviada: 0, cortada: 0, recebida: 0, defeito: 0 };
// Soma um campo (enviada/cortada/recebida/defeito) sobre toda a grade de um bloco.
function somaGrade(g: GradeDetalhe | undefined, campo: keyof CelulaGrade): number {
  let s = 0;
  for (const vid in g ?? {}) for (const t in g[vid] ?? {}) s += Number(g[vid][t]?.[campo]) || 0;
  return s;
}
```

por um import no topo do arquivo (junto aos demais `@/lib`):

```ts
import { type CelulaGrade, type GradeDetalhe, CELULA_ZERO, somaCampo as somaGrade, saldoCelula } from "@/lib/grade-cortada";
```

e **remover** as declarações locais acima (o resto do arquivo já chama `somaGrade(...)`, agora vindo da lib — assinatura idêntica). No seed do toggle `detalhado` (l.1032), incluir `cortada`:

```ts
for (const v of gradeTpl.variantes) { g[v.id] = {}; for (const t of gradeTpl.tamanhos) g[v.id][t] = { enviada: Number(gradeTpl.planejado[v.id]?.[t]) || 0, cortada: 0, recebida: 0, defeito: 0 }; }
```

- [ ] **Step 6: Add CORTADA column + Saldo to the editor**

Em `GradeEditor` (l.1387-1391), inserir CORTADA entre Enviada e Recebida:

```ts
const CAMPOS_GRADE: { k: keyof CelulaGrade; label: string }[] = [
  { k: "enviada", label: "Enviada" },
  { k: "cortada", label: "Cortada" },
  { k: "recebida", label: "Recebida" },
  { k: "defeito", label: "Defeito" },
];
```

No corpo do `GradeEditor`, após o `.map(CAMPOS_GRADE...)` (antes do fechamento `</div>` externo em l.1447), acrescentar o bloco **Saldo (derivado, read-only)**:

```tsx
      {/* Saldo a receber = Cortada − Recebida (derivado; negativo = recebido a mais). */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo a receber (Cortada − Recebida)</div>
        <div className="overflow-x-auto">
          <table className="text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-1 text-left font-medium">Variante</th>
                {tpl.tamanhos.map((t) => <th key={t} className="p-1 text-center font-medium">{tamLabel(t)}</th>)}
                <th className="p-1 text-center font-medium">Σ</th>
              </tr>
            </thead>
            <tbody>
              {tpl.variantes.map((v) => {
                let linhaTotal = 0;
                return (
                  <tr key={v.id} className="border-t">
                    <td className="whitespace-nowrap p-1">{v.label}</td>
                    {tpl.tamanhos.map((t) => {
                      const s = saldoCelula(cel(v.id, t)); linhaTotal += s;
                      return <td key={t} className={`p-1 text-center ${s < 0 ? "text-destructive font-semibold" : ""}`}>{s}</td>;
                    })}
                    <td className={`p-1 text-center font-medium ${linhaTotal < 0 ? "text-destructive" : ""}`}>{linhaTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
```

- [ ] **Step 7: Show Cortada + Saldo in the block totals**

Nos totais do bloco (labels "Qtd Enviada/Recebida/Defeito", l.1115-1167), acrescentar dois campos read-only após "Qtd Enviada", quando `b.detalhado`:

```tsx
              {b.detalhado && (
                <div>
                  <Label className="text-xs">Qtd Cortada (Σ grade)</Label>
                  <Input readOnly value={somaGrade(b.grade_detalhe, "cortada")} className="bg-muted/40" />
                </div>
              )}
              {b.detalhado && (
                <div>
                  <Label className="text-xs">Saldo a receber (Σ)</Label>
                  <Input readOnly value={somaGrade(b.grade_detalhe, "cortada") - somaGrade(b.grade_detalhe, "recebida")} className="bg-muted/40" />
                </div>
              )}
```

- [ ] **Step 8: Verify build + tsc + unit**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep -E "grade-cortada|pcp.servicos" || echo "sem erros nos arquivos tocados"` e `npx vitest run tests/unit/grade-cortada.test.ts`
Expected: build OK; sem TS2304/erros nos arquivos tocados; testes PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/grade-cortada.ts tests/unit/grade-cortada.test.ts "src/routes/_authenticated/pcp.servicos.\$modeloId.tsx"
git commit -m "feat(pcp): campo CORTADA + coluna e Saldo na grade destrinchada de Serviços"
```

---

### Task 2: Resolução da fonte de confecção (config Cadastro + helper TS + guarda)

**Files:**
- Create: `supabase/migrations/20260806120000_confeccao_prioridade.sql`
- Modify: `src/lib/servico-confeccao.ts` (adicionar `isServicoPL`)
- Create: `src/lib/confeccao-fonte.ts`
- Create: `tests/unit/confeccao-fonte.test.ts`
- Modify: `src/routes/_authenticated/cadastro.servico.tsx` (UI de prioridade)

**Interfaces:**
- Consumes: `isServicoConfeccao(nome)` (já existe em `src/lib/servico-confeccao.ts`).
- Produces: `resolverFonteConfeccao(blocos, categorias, prioridade?): { fonteId: string | null; ambiguo: boolean; candidatos: string[] }`. Consumido pelo CQ front (Task 4). Coluna `tenant_config.confeccao_prioridade jsonb` (array ordenado de `categoria_terceirizado_id`) — lida pela Task 4 (UI) e Task 3 (SQL).

- [ ] **Step 1: Write the additive migration**

Criar `supabase/migrations/20260806120000_confeccao_prioridade.sql`:

```sql
-- Prioridade da fonte de confecção (grade cortada): array ordenado de categoria_terceirizado_id.
-- Aditivo/idempotente. Sem valor = default no código (PL antes de Oficina/Costura).
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS confeccao_prioridade jsonb NOT NULL DEFAULT '[]'::jsonb;
```

Aplicar: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260806120000_confeccao_prioridade.sql` e verificar `\d tenant_config | grep confeccao_prioridade`.

- [ ] **Step 2: Write the failing unit test for the resolver**

Criar `tests/unit/confeccao-fonte.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolverFonteConfeccao } from "@/lib/confeccao-fonte";

const cats = [
  { id: "cPL", nome: "PL" },
  { id: "cOfi", nome: "Oficina" },
  { id: "cBord", nome: "Bordado" },
];
const bloco = (id: string, cat: string, detalhado: boolean) => ({ id, categoria_terceirizado_id: cat, detalhado });

describe("resolverFonteConfeccao", () => {
  it("sem bloco destrinchado de confecção → fonte nula", () => {
    const r = resolverFonteConfeccao([bloco("b1", "cBord", true), bloco("b2", "cOfi", false)], cats);
    expect(r).toEqual({ fonteId: null, ambiguo: false, candidatos: [] });
  });
  it("um PL destrinchado → é a fonte", () => {
    const r = resolverFonteConfeccao([bloco("b1", "cPL", true)], cats);
    expect(r.fonteId).toBe("b1");
    expect(r.ambiguo).toBe(false);
  });
  it("default PL > Oficina quando ambos destrinchados (ambíguo, escolhe PL)", () => {
    const r = resolverFonteConfeccao([bloco("bOfi", "cOfi", true), bloco("bPL", "cPL", true)], cats);
    expect(r.fonteId).toBe("bPL");
    expect(r.ambiguo).toBe(true);
    expect(r.candidatos.sort()).toEqual(["bOfi", "bPL"]);
  });
  it("prioridade configurada sobrepõe o default (Oficina antes de PL)", () => {
    const r = resolverFonteConfeccao([bloco("bOfi", "cOfi", true), bloco("bPL", "cPL", true)], cats, ["cOfi", "cPL"]);
    expect(r.fonteId).toBe("bOfi");
  });
  it("Bordado destrinchado não conta (não é confecção)", () => {
    const r = resolverFonteConfeccao([bloco("bB", "cBord", true)], cats);
    expect(r.fonteId).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/confeccao-fonte.test.ts`
Expected: FAIL — "Cannot find module '@/lib/confeccao-fonte'".

- [ ] **Step 4: Add `isServicoPL` and create the resolver**

Em `src/lib/servico-confeccao.ts`, após `isServicoConfeccao`, acrescentar:

```ts
/** A categoria é PL / Private Label (prioridade default de fonte de confecção)? */
export function isServicoPL(nome: string): boolean {
  const n = norm(nome);
  if (!n) return false;
  if (n.includes("private label")) return true;
  return n.split(/[^a-z0-9]+/).filter(Boolean).some((t) => t === "pl" || t === "pls");
}
```

Criar `src/lib/confeccao-fonte.ts`:

```ts
import { isServicoConfeccao, isServicoPL } from "@/lib/servico-confeccao";

type CatInfo = { id: string; nome: string };
type BlocoInfo = { id?: string | null; categoria_terceirizado_id: string; detalhado: boolean };
export type FonteResolucao = { fonteId: string | null; ambiguo: boolean; candidatos: string[] };

// Rank menor = maior prioridade. Prioridade explícita (array de categoria_id) vence;
// default: PL/Private Label (0) antes de Oficina/Costura (1).
function rankCategoria(catId: string, nome: string, prioridade?: string[]): number {
  if (prioridade && prioridade.length) {
    const i = prioridade.indexOf(catId);
    if (i >= 0) return i;
    return prioridade.length + (isServicoPL(nome) ? 0 : 1); // não listadas vão ao fim, PL antes
  }
  return isServicoPL(nome) ? 0 : 1;
}

/** Resolve O único bloco-fonte de confecção (destrinchado). Prioridade PL→Oficina
 *  (ou a `prioridade` configurada). `ambiguo` quando há 2+ candidatos. Espelha o
 *  servidor (`_resolver_fonte_confeccao`); em conflito, o servidor decide na escrita. */
export function resolverFonteConfeccao(
  blocos: BlocoInfo[],
  categorias: CatInfo[],
  prioridade?: string[],
): FonteResolucao {
  const nomeDe = (catId: string) => categorias.find((c) => c.id === catId)?.nome ?? "";
  const candidatos = blocos.filter(
    (b) => b.detalhado && !!b.id && isServicoConfeccao(nomeDe(b.categoria_terceirizado_id)),
  );
  if (candidatos.length === 0) return { fonteId: null, ambiguo: false, candidatos: [] };
  const ordenado = [...candidatos].sort(
    (a, b) =>
      rankCategoria(a.categoria_terceirizado_id, nomeDe(a.categoria_terceirizado_id), prioridade) -
      rankCategoria(b.categoria_terceirizado_id, nomeDe(b.categoria_terceirizado_id), prioridade),
  );
  return {
    fonteId: ordenado[0].id as string,
    ambiguo: candidatos.length > 1,
    candidatos: candidatos.map((c) => c.id as string),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/confeccao-fonte.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 6: Add the priority-config UI in Cadastro > Serviços**

Em `cadastro.servico.tsx`, dentro do componente da aba de **categorias de serviço** (onde `categorias_terceirizado` é listado/editado), acrescentar um cartão "Prioridade da grade cortada" que ordena as categorias de confecção. Adicionar as queries/mutation (usar `useActiveTenantId` já disponível no projeto via `@/hooks/useActiveTenantId`):

```tsx
// Prioridade da fonte de confecção (grade cortada): ordena as categorias de confecção.
const { data: cfgPrio } = useQuery({
  queryKey: ["confeccao-prioridade", tenantId],
  enabled: !!tenantId,
  queryFn: async () =>
    ((await supabase.from("tenant_config").select("confeccao_prioridade").eq("tenant_id", tenantId).maybeSingle()).data as any)?.confeccao_prioridade ?? [],
});
const confeccaoCats = (categorias as { id: string; nome: string }[]).filter((c) => isServicoConfeccao(c.nome));
// Ordem efetiva: as salvas primeiro (na ordem), depois as demais confecções pelo default.
const ordemAtual = useMemo(() => {
  const saved = (cfgPrio ?? []).filter((id: string) => confeccaoCats.some((c) => c.id === id));
  const resto = confeccaoCats.map((c) => c.id).filter((id) => !saved.includes(id))
    .sort((a, b) => Number(isServicoPL(confeccaoCats.find((c) => c.id === b)!.nome)) - Number(isServicoPL(confeccaoCats.find((c) => c.id === a)!.nome)));
  return [...saved, ...resto];
}, [cfgPrio, categorias]);
const savePrio = useMutation({
  mutationFn: async (ids: string[]) => {
    const { error } = await supabase.from("tenant_config").update({ confeccao_prioridade: ids } as any).eq("tenant_id", tenantId);
    if (error) throw error;
  },
  onSuccess: () => { qc.invalidateQueries({ queryKey: ["confeccao-prioridade", tenantId] }); toast.success("Prioridade salva"); },
  onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar prioridade")),
});
```

E o JSX (usar os ícones `ArrowUp`/`ArrowDown` do `lucide-react`, importar no topo):

```tsx
{confeccaoCats.length > 1 && (
  <Card className="p-4 space-y-2">
    <h3 className="font-semibold">Prioridade da grade cortada</h3>
    <p className="text-xs text-muted-foreground">Quando um modelo tem mais de um serviço de confecção destrinchado, a grade cortada vem do primeiro da lista.</p>
    <ol className="space-y-1">
      {ordemAtual.map((id, i) => {
        const nome = confeccaoCats.find((c) => c.id === id)?.nome ?? id;
        const mover = (delta: number) => {
          const arr = [...ordemAtual]; const j = i + delta;
          if (j < 0 || j >= arr.length) return;
          [arr[i], arr[j]] = [arr[j], arr[i]]; savePrio.mutate(arr);
        };
        return (
          <li key={id} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-muted-foreground">{i + 1}.</span>
            <span className="flex-1">{nome}</span>
            <Button size="iconSm" variant="ghost" onClick={() => mover(-1)} disabled={i === 0} aria-label="Subir"><ArrowUp className="h-4 w-4" /></Button>
            <Button size="iconSm" variant="ghost" onClick={() => mover(1)} disabled={i === ordemAtual.length - 1} aria-label="Descer"><ArrowDown className="h-4 w-4" /></Button>
          </li>
        );
      })}
    </ol>
  </Card>
)}
```

Garantir os imports no topo de `cadastro.servico.tsx`: `import { isServicoConfeccao, isServicoPL } from "@/lib/servico-confeccao";`, `import { useActiveTenantId } from "@/hooks/useActiveTenantId";` (e `useMemo` de `react`), `ArrowUp, ArrowDown` de `lucide-react`. Dentro do componente, `const tenantId = useActiveTenantId();` se ainda não existir.

- [ ] **Step 7: Verify build + tsc + unit**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep -E "confeccao-fonte|servico-confeccao|cadastro.servico" || echo "ok"` e `npx vitest run tests/unit/confeccao-fonte.test.ts`
Expected: build OK; sem erros nos arquivos tocados; testes PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260806120000_confeccao_prioridade.sql src/lib/servico-confeccao.ts src/lib/confeccao-fonte.ts tests/unit/confeccao-fonte.test.ts src/routes/_authenticated/cadastro.servico.tsx
git commit -m "feat(cadastro): resolução + prioridade da fonte de confecção (grade cortada)"
```

---

### Task 3: Backend — fonte única atômica (RPC) + reconciliação

**Files:**
- Create: `supabase/migrations/20260806130000_grade_cortada_fonte_unica.sql`
- Create: `tests/integration/grade-cortada.test.ts`

**Interfaces:**
- Consumes: `producao_terceirizados.grade_detalhe` (chave `variante_tecido_id`), `cad_tecido_variantes(variante_tecido_id, ordem)`, `tenant_config.confeccao_prioridade` (Task 2), assinaturas atuais `salvar_cq(_cad_id,_cq,_variantes,_reais,_confirmar)` e `salvar_terceirizados(_cad_id,_blocos,_observacoes_molde)`.
- Produces (SQL, `SECURITY DEFINER`, EXECUTE revogado dos três): `_categoria_eh_confeccao(text) → boolean`; `_resolver_fonte_confeccao(_cad_id uuid) → uuid` (id do bloco-fonte ou NULL). `_salvar_cq_core` e `salvar_terceirizados` estendidos (assinaturas inalteradas). Consumido pela Task 4 (front) via `salvar_cq`.

- [ ] **Step 1: Write the failing integration test**

Criar `tests/integration/grade-cortada.test.ts` (segue o modelo de `tests/integration/rpc-producao.test.ts` — txn revertida). Cobre: (a) os helpers existem e estão revogados; (b) a semântica de "fonte única" numa txn revertida usando um CAD real do tenant teste, se houver.

```ts
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("Grade Cortada — fonte única", () => {
  it("helpers existem e _core está revogado de PUBLIC/anon/authenticated (invariante #9)", async () => {
    await withTx(async (c) => {
      const r = await um<{ ok: boolean }>(c,
        `select
           to_regprocedure('public._resolver_fonte_confeccao(uuid)') is not null
           and to_regprocedure('public._categoria_eh_confeccao(text)') is not null
           and has_function_privilege('anon','public._resolver_fonte_confeccao(uuid)','EXECUTE') = false
           and has_function_privilege('authenticated','public._resolver_fonte_confeccao(uuid)','EXECUTE') = false
           as ok`);
      expect(r.ok).toBe(true);
    });
  });

  it("_categoria_eh_confeccao casa PL/Oficina e recusa Bordado", async () => {
    await withTx(async (c) => {
      const r = await um<{ pl: boolean; ofi: boolean; bord: boolean }>(c,
        `select _categoria_eh_confeccao('PL') pl, _categoria_eh_confeccao('Oficina') ofi, _categoria_eh_confeccao('Bordado') bord`);
      expect(r.pl).toBe(true); expect(r.ofi).toBe(true); expect(r.bord).toBe(false);
    });
  });

  it("salvar_cq deriva a Grade Real de recebida−defeito do grade_detalhe do bloco-fonte", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // Acha um CAD do tenant teste com Tecido Principal e >=1 variante ordenada.
      const cad = await um<{ id: string; vnum: number; vid: string; tam: string } | undefined>(c,
        `select cad.id, ctv.ordem as vnum, ctv.variante_tecido_id as vid,
                coalesce((select jsonb_object_keys(g.grades) from cad_grades g where g.cad_id=cad.id limit 1),'38|P') as tam
           from cad
           join cad_tecidos ct on ct.cad_id=cad.id and ct.tipo='tecido' and ct.numero=1
           join cad_tecido_variantes ctv on ctv.cad_tecido_id=ct.id
          where cad.tenant_id=$1
          order by ctv.ordem limit 1`, [TENANT_TESTE]);
      if (!cad) return; // sem dado adequado → não falha
      // Cria um bloco-fonte PL destrinchado com cortada/recebida/defeito na célula.
      const catPL = await um<{ id: string } | undefined>(c,
        `select id from categorias_terceirizado where tenant_id=$1 and _categoria_eh_confeccao(nome) order by _categoria_eh_confeccao(nome) desc limit 1`, [TENANT_TESTE]);
      if (!catPL) return;
      const gd = JSON.stringify({ [cad.vid]: { [cad.tam]: { enviada: 10, cortada: 10, recebida: 8, defeito: 3 } } });
      await c.query(
        `insert into producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, ativo, detalhado, grade_detalhe)
         values ($1,$2,$3,true,true,$4::jsonb)`, [cad.id, TENANT_TESTE, catPL.id, gd]);
      // Confirma o CQ enviando o recebido/defeito no payload de variantes (a RPC grava no grade_detalhe do fonte).
      const variantes = JSON.stringify([
        { variante_numero: cad.vnum, etapa: "recebimento", grades: { [cad.tam]: 8 }, grade_total: 8 },
        { variante_numero: cad.vnum, etapa: "defeito", grades: { [cad.tam]: 3 }, grade_total: 3, destino_defeito: null },
      ]);
      const reais = JSON.stringify([{ variante_numero: cad.vnum, grades: { [cad.tam]: 5 }, grade_total: 5 }]);
      await c.query(`select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,true)`, [cad.id, variantes, reais]);
      // Grade Real gravada = recebida−defeito = 5.
      const real = await um<{ v: number }>(c,
        `select coalesce((grades_reais->>$2)::int,0) v from cad_grades where cad_id=$1 and variante_numero=$3`,
        [cad.id, cad.tam, cad.vnum]);
      expect(real.v).toBe(5);
      // E o grade_detalhe do bloco-fonte recebeu recebida=8/defeito=3 (fonte única).
      const pt = await um<{ rec: number; def: number }>(c,
        `select (grade_detalhe->$2->$3->>'recebida')::int rec, (grade_detalhe->$2->$3->>'defeito')::int def
           from producao_terceirizados where cad_id=$1 and detalhado order by created_at desc limit 1`,
        [cad.id, cad.vid, cad.tam]);
      expect(pt.rec).toBe(8); expect(pt.def).toBe(3);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/grade-cortada.test.ts`
Expected: FAIL — helpers ausentes / `salvar_cq` ainda não grava `grade_detalhe`.

- [ ] **Step 3: Write the migration (helpers + extended RPCs + reconciliation)**

Criar `supabase/migrations/20260806130000_grade_cortada_fonte_unica.sql` — envolvido em `BEGIN; … COMMIT;` (a reconciliação consolida dados). **Reproduzir os tokens de `isServicoConfeccao` em SQL.**

```sql
BEGIN;

-- 1) Categoria é de confecção? (espelha src/lib/servico-confeccao.ts: oficina/costura/pl/private label)
CREATE OR REPLACE FUNCTION public._categoria_eh_confeccao(_nome text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _nome IS NULL THEN false
    ELSE (
      lower(unaccent_simple(_nome)) LIKE '%private label%'
      OR EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(unaccent_simple(_nome)), '[^a-z0-9]+') tok
        WHERE tok IN ('oficina','oficinas','costura','costuras','pl','pls')
      )
    )
  END;
$$;
-- unaccent_simple: remove acentos sem depender da extensão unaccent (translate ASCII).
CREATE OR REPLACE FUNCTION public.unaccent_simple(_s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(_s,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC');
$$;

-- 2) É PL/Private Label? (prioridade default)
CREATE OR REPLACE FUNCTION public._categoria_eh_pl(_nome text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _nome IS NULL THEN false
    ELSE (
      lower(unaccent_simple(_nome)) LIKE '%private label%'
      OR EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(unaccent_simple(_nome)), '[^a-z0-9]+') tok
        WHERE tok IN ('pl','pls')
      )
    )
  END;
$$;

-- 3) Resolve O bloco-fonte de confecção (destrinchado, ativo) de um CAD.
--    Prioridade: array tenant_config.confeccao_prioridade; default PL(0) antes de Oficina(1).
CREATE OR REPLACE FUNCTION public._resolver_fonte_confeccao(_cad_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid; v_prio jsonb; v_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(confeccao_prioridade, '[]'::jsonb) INTO v_prio
    FROM public.tenant_config WHERE tenant_id = v_tenant;
  SELECT pt.id INTO v_id
    FROM public.producao_terceirizados pt
    JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
   WHERE pt.cad_id = _cad_id AND pt.ativo AND pt.detalhado
     AND public._categoria_eh_confeccao(ct.nome)
   ORDER BY
     -- rank explícito (posição no array), depois default PL<Oficina, depois estável por created_at.
     COALESCE(NULLIF(array_position(ARRAY(SELECT jsonb_array_elements_text(v_prio))::uuid[], pt.categoria_terceirizado_id), 0), 999),
     CASE WHEN public._categoria_eh_pl(ct.nome) THEN 0 ELSE 1 END,
     pt.created_at
   LIMIT 1;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._resolver_fonte_confeccao(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._categoria_eh_confeccao(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._categoria_eh_pl(text) FROM PUBLIC, anon, authenticated;

-- 4) _salvar_cq_core estendido: se há bloco-fonte, grava recebida/defeito no grade_detalhe
--    (traduzindo variante_numero→variante_tecido_id via cad_tecido_variantes.ordem),
--    PRESERVA cortada/enviada, e deriva cad_grades DO grade_detalhe (não do _reais do cliente).
CREATE OR REPLACE FUNCTION public._salvar_cq_core(_cad_id uuid, _cq jsonb, _variantes jsonb, _reais jsonb, _confirmar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid; v_cq_id uuid; v_status_atual text; v_status text; v_confirmado_at timestamptz;
  v_total_real int; r jsonb; v_fonte uuid; v_gd jsonb; v_vid uuid; v_tam text; v_rec int; v_def int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  v_fonte := public._resolver_fonte_confeccao(_cad_id);

  -- [C1] confirmar exige Σ da grade real > 0.
  IF _confirmar THEN
    SELECT COALESCE(SUM((SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(e->'grades','{}'::jsonb)) x)), 0)
      INTO v_total_real FROM jsonb_array_elements(COALESCE(_reais,'[]'::jsonb)) e;
    IF v_total_real = 0 THEN
      RAISE EXCEPTION 'Conte ao menos uma peça no Recebimento antes de confirmar o Controle de Qualidade.';
    END IF;
  END IF;

  SELECT id, status INTO v_cq_id, v_status_atual FROM public.controle_qualidade WHERE cad_id = _cad_id;
  v_status := CASE WHEN _confirmar THEN 'confirmado'
                   WHEN v_cq_id IS NOT NULL THEN COALESCE(v_status_atual, 'pendente')
                   ELSE 'pendente' END;
  v_confirmado_at := CASE WHEN v_status = 'confirmado' THEN now() ELSE NULL END;

  -- (INSERT/UPDATE de controle_qualidade — IDÊNTICO ao atual; copiar o bloco inteiro do
  --  pg_get_functiondef vigente sem alterações. Ver "diff-validar" no Step 5.)
  IF v_cq_id IS NULL THEN
    INSERT INTO public.controle_qualidade (
      cad_id, tenant_id, observacoes_cq, pecas_incompletas, pecas_faltantes, pecas_sem_etiqueta,
      data_conserto_enviado, data_conserto_prevista, data_conserto_entregue,
      data_lavagem_enviado, data_lavagem_entregue,
      data_recebimento_enviado_oficina, data_recebimento_prevista, data_recebimento_entregue,
      fotografado_variantes, status, confirmado_at
    ) VALUES (
      _cad_id, v_tenant, _cq->>'observacoes_cq',
      NULLIF(_cq->>'pecas_incompletas','')::int, NULLIF(_cq->>'pecas_faltantes','')::int, NULLIF(_cq->>'pecas_sem_etiqueta','')::int,
      NULLIF(_cq->>'data_conserto_enviado','')::date, NULLIF(_cq->>'data_conserto_prevista','')::date, NULLIF(_cq->>'data_conserto_entregue','')::date,
      NULLIF(_cq->>'data_lavagem_enviado','')::date, NULLIF(_cq->>'data_lavagem_entregue','')::date,
      NULLIF(_cq->>'data_recebimento_enviado_oficina','')::date, NULLIF(_cq->>'data_recebimento_prevista','')::date, NULLIF(_cq->>'data_recebimento_entregue','')::date,
      COALESCE(_cq->'fotografado_variantes', '{}'::jsonb), v_status, v_confirmado_at
    ) RETURNING id INTO v_cq_id;
  ELSE
    UPDATE public.controle_qualidade SET
      observacoes_cq = _cq->>'observacoes_cq',
      pecas_incompletas = NULLIF(_cq->>'pecas_incompletas','')::int,
      pecas_faltantes = NULLIF(_cq->>'pecas_faltantes','')::int,
      pecas_sem_etiqueta = NULLIF(_cq->>'pecas_sem_etiqueta','')::int,
      data_conserto_enviado = NULLIF(_cq->>'data_conserto_enviado','')::date,
      data_conserto_prevista = NULLIF(_cq->>'data_conserto_prevista','')::date,
      data_conserto_entregue = NULLIF(_cq->>'data_conserto_entregue','')::date,
      data_lavagem_enviado = NULLIF(_cq->>'data_lavagem_enviado','')::date,
      data_lavagem_entregue = NULLIF(_cq->>'data_lavagem_entregue','')::date,
      data_recebimento_enviado_oficina = NULLIF(_cq->>'data_recebimento_enviado_oficina','')::date,
      data_recebimento_prevista = NULLIF(_cq->>'data_recebimento_prevista','')::date,
      data_recebimento_entregue = NULLIF(_cq->>'data_recebimento_entregue','')::date,
      fotografado_variantes = COALESCE(_cq->'fotografado_variantes', '{}'::jsonb),
      status = v_status,
      confirmado_at = CASE WHEN v_status = 'confirmado' THEN COALESCE(confirmado_at, now()) ELSE NULL END
    WHERE id = v_cq_id;
  END IF;

  -- cq_variantes: regrava TODAS as etapas do payload (conserto/lavagem/destino_defeito continuam
  -- morando aqui). Para modelo COM bloco-fonte, recebimento/defeito também chegam no payload e são
  -- gravados aqui como snapshot histórico do CQ, MAS a fonte canônica de qtd é o grade_detalhe abaixo.
  DELETE FROM public.cq_variantes WHERE controle_qualidade_id = v_cq_id;
  IF jsonb_typeof(_variantes) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_variantes) LOOP
      INSERT INTO public.cq_variantes (controle_qualidade_id, variante_numero, etapa, grades, grade_total, destino_defeito)
      VALUES (v_cq_id, (r->>'variante_numero')::int, r->>'etapa', COALESCE(r->'grades','{}'::jsonb),
        (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x),
        NULLIF(r->>'destino_defeito',''));
    END LOOP;
  END IF;

  -- FONTE ÚNICA: se há bloco-fonte, escreve recebida/defeito do payload no grade_detalhe do bloco,
  -- traduzindo variante_numero→variante_tecido_id (ordem). PRESERVA enviada/cortada existentes.
  IF v_fonte IS NOT NULL THEN
    SELECT COALESCE(grade_detalhe, '{}'::jsonb) INTO v_gd FROM public.producao_terceirizados WHERE id = v_fonte;
    FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb))
             WHERE value->>'etapa' IN ('recebimento','defeito') LOOP
      -- vid da ordem (variante_numero) no Tecido Principal do CAD
      SELECT ctv.variante_tecido_id INTO v_vid
        FROM public.cad_tecidos ct
        JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
       WHERE ct.cad_id = _cad_id AND ct.tipo='tecido' AND ct.numero=1 AND ctv.ordem = (r->>'variante_numero')::int
       LIMIT 1;
      IF v_vid IS NULL THEN CONTINUE; END IF;
      FOR v_tam IN SELECT jsonb_object_keys(COALESCE(r->'grades','{}'::jsonb)) LOOP
        v_gd := jsonb_set(v_gd, ARRAY[v_vid::text, v_tam],
          COALESCE(v_gd->v_vid::text->v_tam, '{}'::jsonb)
          || jsonb_build_object(CASE WHEN r->>'etapa'='recebimento' THEN 'recebida' ELSE 'defeito' END,
                                COALESCE((r->'grades'->>v_tam)::int,0)), true);
      END LOOP;
    END LOOP;
    UPDATE public.producao_terceirizados SET grade_detalhe = v_gd,
      quantidade_recebida = (SELECT COALESCE(SUM((cell->>'recebida')::int),0) FROM jsonb_path_query(v_gd,'$.*.*') cell),
      quantidade_defeito  = (SELECT COALESCE(SUM((cell->>'defeito')::int),0)  FROM jsonb_path_query(v_gd,'$.*.*') cell)
    WHERE id = v_fonte;
  END IF;

  -- Grade Real → cad_grades quando confirmado. COM fonte: deriva do grade_detalhe (recebida−defeito,
  -- por ordem). SEM fonte: usa _reais do cliente (comportamento atual).
  IF v_status = 'confirmado' THEN
    IF v_fonte IS NOT NULL THEN
      PERFORM public._aplicar_reais_do_grade_detalhe(_cad_id, v_fonte);
    ELSIF jsonb_typeof(_reais) = 'array' THEN
      FOR r IN SELECT value FROM jsonb_array_elements(_reais) LOOP
        INSERT INTO public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
        VALUES (_cad_id, (r->>'variante_numero')::int, COALESCE(r->'grades','{}'::jsonb), COALESCE(r->'grades','{}'::jsonb),
          (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x),
          (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x))
        ON CONFLICT (cad_id, variante_numero) DO UPDATE
          SET grades_reais = EXCLUDED.grades_reais, grade_total_real = EXCLUDED.grade_total_real;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('cq_id', v_cq_id, 'status', v_status, 'fonte', v_fonte);
END;
$$;

-- 5) Helper: aplica cad_grades.grades_reais a partir do grade_detalhe do bloco-fonte (recebida−defeito).
--    Usado por _salvar_cq_core E por salvar_terceirizados (mesma fórmula = zero drift).
CREATE OR REPLACE FUNCTION public._aplicar_reais_do_grade_detalhe(_cad_id uuid, _fonte uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_gd jsonb; ctv record; v_tam text; v_grades jsonb; v_total int; v_rec int; v_def int;
BEGIN
  SELECT COALESCE(grade_detalhe,'{}'::jsonb) INTO v_gd FROM public.producao_terceirizados WHERE id = _fonte;
  FOR ctv IN
    SELECT c.ordem, c.variante_tecido_id
      FROM public.cad_tecidos ct
      JOIN public.cad_tecido_variantes c ON c.cad_tecido_id = ct.id
     WHERE ct.cad_id = _cad_id AND ct.tipo='tecido' AND ct.numero=1
  LOOP
    v_grades := '{}'::jsonb; v_total := 0;
    FOR v_tam IN SELECT jsonb_object_keys(COALESCE(v_gd->ctv.variante_tecido_id::text,'{}'::jsonb)) LOOP
      v_rec := COALESCE((v_gd->ctv.variante_tecido_id::text->v_tam->>'recebida')::int,0);
      v_def := COALESCE((v_gd->ctv.variante_tecido_id::text->v_tam->>'defeito')::int,0);
      v_grades := jsonb_set(v_grades, ARRAY[v_tam], to_jsonb(GREATEST(0, v_rec - v_def)), true);
      v_total := v_total + GREATEST(0, v_rec - v_def);
    END LOOP;
    -- Só cria/atualiza a linha se a variante tem alguma célula no grade_detalhe (evita zerar variantes intactas).
    IF v_gd ? ctv.variante_tecido_id::text THEN
      INSERT INTO public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
      VALUES (_cad_id, ctv.ordem, v_grades, v_grades, v_total, v_total)
      ON CONFLICT (cad_id, variante_numero) DO UPDATE
        SET grades_reais = EXCLUDED.grades_reais, grade_total_real = EXCLUDED.grade_total_real;
    END IF;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._aplicar_reais_do_grade_detalhe(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- 6) salvar_terceirizados estendido: após gravar os blocos, se o CAD tem CQ confirmado e um
--    bloco-fonte, re-deriva cad_grades do grade_detalhe (editar recebida no PCP move a Grade Real).
--    (Reaplicar o corpo VIGENTE de salvar_terceirizados + o trecho abaixo antes do último UPDATE cad.)
CREATE OR REPLACE FUNCTION public.salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid; b jsonb; v_id uuid; v_ids uuid[] := '{}'; v_fonte uuid; v_cq_conf boolean;
BEGIN
  -- (COPIAR VERBATIM do pg_get_functiondef vigente: as validações, o advisory lock, o loop
  --  UPDATE/INSERT dos blocos, a guarda de parcela paga e o DELETE dos removidos.)
  -- ... corpo atual inalterado até o final ...

  -- NOVO (após o DELETE dos removidos, antes do UPDATE cad observacoes_molde):
  SELECT public._resolver_fonte_confeccao(_cad_id) INTO v_fonte;
  SELECT (status = 'confirmado') INTO v_cq_conf FROM public.controle_qualidade WHERE cad_id = _cad_id;
  IF v_fonte IS NOT NULL AND COALESCE(v_cq_conf, false) THEN
    PERFORM public._aplicar_reais_do_grade_detalhe(_cad_id, v_fonte);
  END IF;

  UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
END;
$$;

-- 7) RECONCILIAÇÃO idempotente: para cada bloco-fonte, backfill de recebida/defeito no grade_detalhe
--    a partir de cq_variantes (traduzindo numero→vid) SOMENTE onde a célula do grade_detalhe está
--    ausente/zerada. grade_detalhe é autoritativo; divergências (ambos != e diferentes) só logam.
DO $recon$
DECLARE cad_rec record; v_fonte uuid; v_gd jsonb; cv record; v_vid uuid; v_tam text; v_q int; v_campo text; v_atual int;
BEGIN
  FOR cad_rec IN SELECT DISTINCT c.id AS cad_id FROM public.cad c
                 WHERE public._resolver_fonte_confeccao(c.id) IS NOT NULL LOOP
    v_fonte := public._resolver_fonte_confeccao(cad_rec.cad_id);
    SELECT COALESCE(grade_detalhe,'{}'::jsonb) INTO v_gd FROM public.producao_terceirizados WHERE id = v_fonte;
    FOR cv IN
      SELECT v.variante_numero, v.etapa, v.grades
        FROM public.cq_variantes v
        JOIN public.controle_qualidade q ON q.id = v.controle_qualidade_id
       WHERE q.cad_id = cad_rec.cad_id AND v.etapa IN ('recebimento','defeito')
    LOOP
      SELECT ctv.variante_tecido_id INTO v_vid
        FROM public.cad_tecidos ct JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
       WHERE ct.cad_id = cad_rec.cad_id AND ct.tipo='tecido' AND ct.numero=1 AND ctv.ordem = cv.variante_numero LIMIT 1;
      IF v_vid IS NULL THEN CONTINUE; END IF;
      v_campo := CASE WHEN cv.etapa='recebimento' THEN 'recebida' ELSE 'defeito' END;
      FOR v_tam IN SELECT jsonb_object_keys(COALESCE(cv.grades,'{}'::jsonb)) LOOP
        v_q := COALESCE((cv.grades->>v_tam)::int,0);
        v_atual := COALESCE((v_gd->v_vid::text->v_tam->>v_campo)::int,0);
        IF v_atual = 0 AND v_q <> 0 THEN
          v_gd := jsonb_set(v_gd, ARRAY[v_vid::text, v_tam],
            COALESCE(v_gd->v_vid::text->v_tam,'{}'::jsonb) || jsonb_build_object(v_campo, v_q), true);
        ELSIF v_atual <> 0 AND v_q <> 0 AND v_atual <> v_q THEN
          RAISE NOTICE 'reconciliacao: cad % vid % tam % campo % diverge (grade_detalhe=% cq=%) -> mantido grade_detalhe',
            cad_rec.cad_id, v_vid, v_tam, v_campo, v_atual, v_q;
        END IF;
      END LOOP;
    END LOOP;
    UPDATE public.producao_terceirizados SET grade_detalhe = v_gd WHERE id = v_fonte;
  END LOOP;
END
$recon$;

COMMIT;
```

- [ ] **Step 4: Apply the migration**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260806130000_grade_cortada_fonte_unica.sql`
Expected: `BEGIN`/`CREATE FUNCTION`.../`COMMIT` sem erro. Se falhar, corrigir e reaplicar (é idempotente).

- [ ] **Step 5: Diff-validate the touched functions**

Run: `psql "$(cat /tmp/dburl.txt)" -tA -c "SELECT pg_get_functiondef('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean)'::regprocedure);"` e o mesmo para `salvar_terceirizados(uuid,jsonb,text)`.
Expected: confirmar que (a) o bloco de `controle_qualidade` INSERT/UPDATE é IDÊNTICO ao vigente (copiado verbatim), (b) `salvar_terceirizados` manteve o advisory lock + guarda de parcela paga + DELETE de removidos, (c) os `REVOKE` pegaram: `has_function_privilege('anon','public._resolver_fonte_confeccao(uuid)','EXECUTE')` = `f`.

- [ ] **Step 6: Run integration test to verify it passes**

Run: `npx vitest run tests/integration/grade-cortada.test.ts`
Expected: PASS (3 testes; o 3º se auto-pula se não houver CAD adequado no tenant teste — não falha à toa).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260806130000_grade_cortada_fonte_unica.sql tests/integration/grade-cortada.test.ts
git commit -m "feat(cq): fonte única do recebido/defeito no grade_detalhe do bloco-fonte + reconciliação"
```

---

### Task 4: CQ front — Grade Cortada read-only + recebido/defeito da fonte única

**Files:**
- Modify: `src/routes/_authenticated/expedicao.cq.$modeloId.tsx` (`mainFabric` query l.106-119; seed `useEffect` l.260-315; `cadGradeByNum` l.339-345; alertas l.347-386; card "Grade (CAD)" l.683-697)

**Interfaces:**
- Consumes: `resolverFonteConfeccao` (Task 2); `salvar_cq` estendido (Task 3); `grade_detalhe` do bloco-fonte; `cad_tecido_variantes(variante_tecido_id, ordem)`; `tenant_config.confeccao_prioridade`.
- Produces: nada para tasks posteriores (é folha).

- [ ] **Step 1: Query the source block + build ordem↔vid maps**

Em `expedicao.cq.$modeloId.tsx`, adicionar `variante_tecido_id` ao select de `mainFabric` (l.112) para montar o mapa `ordem→vid`:

```ts
.select("tipo, numero, cad_tecido_variantes(ordem, variante_tecido_id, variantes_tecido:variante_tecido_id(nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
```

Adicionar imports e queries (após a query `tercs`, l.144):

```ts
import { resolverFonteConfeccao } from "@/lib/confeccao-fonte";
// ...
// Blocos de Serviços + categorias (p/ resolver o bloco-fonte da grade cortada).
const { data: blocosFonte = [] } = useQuery({
  queryKey: ["cq-blocos-fonte", cad?.id],
  enabled: !!cad?.id,
  queryFn: async () => (await supabase.from("producao_terceirizados")
    .select("id, categoria_terceirizado_id, detalhado, ativo, grade_detalhe").eq("cad_id", cad!.id)).data ?? [],
});
const { data: catsServico = [] } = useQuery({
  queryKey: ["cq-cats-servico", tenantId],
  enabled: !!tenantId,
  queryFn: async () => (await supabase.from("categorias_terceirizado").select("id, nome").eq("tenant_id", tenantId)).data ?? [],
});
const { data: prioridade = [] } = useQuery({
  queryKey: ["cq-confeccao-prioridade", tenantId],
  enabled: !!tenantId,
  queryFn: async () => ((await supabase.from("tenant_config").select("confeccao_prioridade").eq("tenant_id", tenantId).maybeSingle()).data as any)?.confeccao_prioridade ?? [],
});
```

Mapas e resolução (após `variantList`/`labelByNumero`, ~l.192):

```ts
// ordem (variante_numero) → variante_tecido_id, do Tecido Principal do CAD.
const vidByNum = useMemo(() => {
  const m: Record<number, string> = {};
  (((mainFabric as any)?.cad_tecido_variantes ?? []) as any[]).forEach((v) => {
    if (v.ordem != null && v.variante_tecido_id) m[Number(v.ordem)] = v.variante_tecido_id as string;
  });
  return m;
}, [mainFabric]);
const fonte = useMemo(
  () => resolverFonteConfeccao(
    (blocosFonte as any[]).filter((b) => b.ativo !== false).map((b) => ({ id: b.id, categoria_terceirizado_id: b.categoria_terceirizado_id, detalhado: !!b.detalhado })),
    catsServico as any[], prioridade as string[]),
  [blocosFonte, catsServico, prioridade]);
const fonteGrade = useMemo(() => {
  const b = (blocosFonte as any[]).find((x) => x.id === fonte.fonteId);
  return (b?.grade_detalhe ?? {}) as Record<string, Record<string, { cortada?: number; recebida?: number; defeito?: number }>>;
}, [blocosFonte, fonte.fonteId]);
const temFonte = !!fonte.fonteId;
```

- [ ] **Step 2: Seed recebido/defeito from the source when it exists**

No `useEffect` de hidratação (l.297-309), quando `temFonte`, semear `recebimento`/`defeito` a partir de `fonteGrade` (traduzindo vid→num) em vez de `cq_variantes`. Substituir o bloco `const g = emptyGrades(); (varRows...).forEach(...)` por:

```ts
      const g = emptyGrades();
      // conserto/lavagem (+ destino_defeito) sempre vêm de cq_variantes.
      (varRows as any[]).forEach((v) => {
        const et = v.etapa as Etapa;
        if (!ETAPAS.includes(et)) return;
        if (temFonte && (et === "recebimento" || et === "defeito")) {
          // recebimento/defeito virão do grade_detalhe (fonte única) — só preserva destino_defeito.
          if (et === "defeito") g.defeito[v.variante_numero] = { id: v.id, variante_numero: v.variante_numero, grades: {}, grade_total: 0, destino_defeito: v.destino_defeito };
          return;
        }
        g[et][v.variante_numero] = { id: v.id, variante_numero: v.variante_numero, grades: v.grades ?? {}, grade_total: Number(v.grade_total ?? 0), destino_defeito: v.destino_defeito };
      });
      if (temFonte) {
        variantList.forEach(({ num }) => {
          const vid = vidByNum[num]; if (!vid) return;
          const cel = fonteGrade[vid] ?? {};
          const rec: Record<string, number> = {}; const def: Record<string, number> = {};
          let rT = 0; let dT = 0;
          tamanhos.forEach((t) => { const rc = Number(cel[t]?.recebida) || 0; const dc = Number(cel[t]?.defeito) || 0; if (rc) { rec[t] = rc; rT += rc; } if (dc) { def[t] = dc; dT += dc; } });
          g.recebimento[num] = { variante_numero: num, grades: rec, grade_total: rT };
          g.defeito[num] = { ...(g.defeito[num] ?? { variante_numero: num }), grades: def, grade_total: dT } as VarRow;
        });
      }
      setGrades(g);
```

Adicionar `temFonte, fonteGrade, vidByNum, tamanhos` às deps do `useEffect` (l.315).

- [ ] **Step 3: Swap the reference card to "Grade Cortada" (read-only) when there is a source**

Substituir `cadGradeByNum` (l.339-345) por uma referência que é a **cortada** do bloco-fonte quando `temFonte`, senão a grade do CAD (retrocompat):

```ts
// Referência do CQ: com bloco-fonte = CORTADA do grade_detalhe; sem = grade planejada do CAD.
const refByNum = useMemo(() => {
  const m: Record<number, { grades: Record<string, number>; total: number }> = {};
  if (temFonte) {
    variantList.forEach(({ num }) => {
      const vid = vidByNum[num]; const cel = (vid && fonteGrade[vid]) || {};
      const grades: Record<string, number> = {}; let total = 0;
      tamanhos.forEach((t) => { const c = Number((cel as any)[t]?.cortada) || 0; grades[t] = c; total += c; });
      m[num] = { grades, total };
    });
  } else {
    (modeloGrades as any[]).forEach((g) => { m[Number(g.variante_numero)] = { grades: g.grades ?? {}, total: Number(g.grade_total ?? 0) }; });
  }
  return m;
}, [temFonte, fonteGrade, vidByNum, tamanhos, variantList, modeloGrades]);
```

Substituir TODAS as referências a `cadGradeByNum` (nos `useMemo` `recebDivergente` l.349-356, `realDivergente` l.379-386, e no `overFn` do Recebimento l.721-729) por `refByNum`. Atualizar o card (l.683-697):

```tsx
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">{temFonte ? "Grade Cortada" : "Grade (CAD)"}</h3>
          <span className="text-xs text-muted-foreground">{temFonte ? "Cortada reportada no PCP (Serviços) · referência" : "Grade planejada no CAD · referência"}</span>
        </div>
        <MatrizGradeResponsiva
          tamanhos={tamanhos}
          variantes={variantList.map((v) => ({ num: v.num, label: v.label }))}
          emptyLabel="Sem variantes no Tecido Principal."
          total={(num) => refByNum[num]?.total ?? 0}
          renderCell={(num, t) => (<div className="px-2 py-1 text-center bg-muted/20">{refByNum[num]?.grades?.[t] ?? 0}</div>)}
        />
      </Card>
      {temFonte && fonte.ambiguo && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          ⚠ Há mais de um serviço de confecção destrinchado neste modelo. A grade cortada usa o de maior prioridade (ajuste em Cadastro › Serviços).
        </div>
      )}
```

Ajustar os textos dos alertas de divergência (l.700-702 e l.804-807) para citar "grade cortada" quando `temFonte` (ex.: `{temFonte ? "da grade cortada" : "da grade do CAD"}`).

- [ ] **Step 4: Verify build + tsc**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep -E "expedicao.cq" || echo "ok"`
Expected: build OK; sem TS2304 no arquivo do CQ.

- [ ] **Step 5: Manual smoke (documented, no code)**

Verificação manual (registrar no PR): (a) modelo COM bloco PL destrinchado + cortada preenchida → card "Grade Cortada" aparece read-only; recebimento/defeito digitados no CQ persistem no `grade_detalhe` do bloco (checar em PCP › Serviços); (b) editar recebida no PCP e recarregar o CQ → o Recebimento reflete; (c) modelo SEM bloco destrinchado → card segue "Grade (CAD)", recebimento em `cq_variantes` como hoje.

- [ ] **Step 6: Commit**

```bash
git add "src/routes/_authenticated/expedicao.cq.\$modeloId.tsx"
git commit -m "feat(cq): Grade Cortada read-only + recebido/defeito da fonte única do bloco-fonte"
```

---

### Task 5: Docs + verificação final

**Files:**
- Modify: `CLAUDE.md` (invariantes #6 e #7 — nota da fonte única)
- Modify: `docs/mapeamento-campos-calculos.md` (grade_detalhe/cortada/Grade Real)
- Modify: memória `project_terceirizados_grade_detalhe.md` (via docs-keeper)

**Interfaces:** nenhuma (documentação + gates).

- [ ] **Step 1: Update CLAUDE.md invariants**

Em `CLAUDE.md`, no invariante **#6 (CQ)**, acrescentar 1-2 linhas: "Grade Cortada (ago/2026): quando o modelo tem um bloco-fonte de confecção destrinchado (`_resolver_fonte_confeccao`), o recebido/defeito do CQ são a FONTE ÚNICA = `producao_terceirizados.grade_detalhe` do bloco-fonte (chave `variante_tecido_id`, traduzida por `cad_tecido_variantes.ordem` ↔ `variante_numero`); `_salvar_cq_core` grava lá e deriva `cad_grades.grades_reais` (recebida−defeito) na mesma txn; `salvar_terceirizados` re-deriva quando o CQ está confirmado. Sem bloco-fonte = `cq_variantes` como hoje. CORTADA só edita no PCP." No invariante **#7**, reforçar: "`grades_planejada` inalterada; só a EXIBIÇÃO da referência no CQ vira a cortada."

- [ ] **Step 2: Update local mapping doc**

Em `docs/mapeamento-campos-calculos.md`, adicionar a célula `grade_detalhe = { enviada, cortada, recebida, defeito }`, as fórmulas `Saldo = Cortada − Recebida` e `Grade Real = max(0, Recebida − Defeito)`, e a ponte de chave `variante_numero == cad_tecido_variantes.ordem == variante_tecido_id`.

- [ ] **Step 3: Full verification gate**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep -E "TS2304" | grep -Ev "^$" || echo "sem TS2304"` e `npm test`
Expected: build OK; sem TS2304; unit todos verdes; integração verde ou auto-pulada (sem credencial/dado). Registrar as saídas no PR (evidência antes de afirmar conclusão).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/mapeamento-campos-calculos.md
git commit -m "docs: fonte única da grade cortada (invariantes #6/#7 + mapeamento)"
```

---

## Self-Review

**1. Spec coverage** (cada seção da spec → task):
- §1 Fonte por prioridade + config Cadastro + guarda de ambiguidade → **T2** (resolver TS + coluna `confeccao_prioridade` + UI) e **T3** (`_resolver_fonte_confeccao` autoritativo). ✓
- §2 PCP: 4º campo `cortada`, coluna CORTADA entre Enviada/Recebida, Saldo, totais Σ → **T1**. ✓
- §3 Cadastro: config de prioridade → **T2 Step 6**. ✓
- §4 CQ: "Grade Cortada" read-only + Recebido/Defeito fonte única + alerta vs cortada → **T4** (front) + **T3** (backend atômico). ✓
- §5 Compatibilidade/invariantes: retrocompat sem bloco-fonte (**T3/T4** branch `temFonte`), `grades_planejada` intacta (**T3** não toca planejadas), reconciliação idempotente (**T3 Step 3 §7**). ✓
- Segurança/atomicidade: uma txn no `_salvar_cq_core`; REVOKE dos três nos helpers (**T3**). ✓
- Testes: integração transacional (**T3**), unit de Saldo/Grade Real (**T1**) e resolução da fonte (**T2**). ✓
- Fora de escopo respeitado: nada para blocos não-confecção; CORTADA só com `detalhado`; sem histórico; 1 fonte/modelo; Grade Real segue Recebido−Defeito. ✓

**2. Placeholder scan:** Os únicos "copiar verbatim" são T3 Step 3 (bloco de `controle_qualidade` INSERT/UPDATE e corpo de `salvar_terceirizados`) — deliberado e seguro: o corpo vigente foi lido e está reproduzido no INSERT/UPDATE do CQ; o `salvar_terceirizados` marca EXATAMENTE onde inserir (após o DELETE de removidos, antes do UPDATE cad) e o Step 5 diff-valida que o corpo vigente foi preservado. Não há "TBD/implementar depois". ✓

**3. Type/identifier consistency:**
- `CelulaGrade` ganha `cortada` (T1) e é reusada no PCP (import) e espelhada no CQ. ✓
- `somaCampo` exportado como `somaGrade` no PCP (alias) — mantém as chamadas existentes. ✓
- `resolverFonteConfeccao(blocos, categorias, prioridade?)` — mesma assinatura em T2 (def), T4 (uso). ✓
- Ponte de chave `variante_numero == cad_tecido_variantes.ordem`, `vid = variante_tecido_id` — consistente em T3 (SQL `_aplicar_reais_do_grade_detalhe`, `_salvar_cq_core`) e T4 (`vidByNum`). ✓
- `_resolver_fonte_confeccao(uuid)`/`_aplicar_reais_do_grade_detalhe(uuid,uuid)`/`_categoria_eh_confeccao(text)`/`_categoria_eh_pl(text)` — nomes idênticos entre def (T3) e testes (T3 Step 1). ✓

**Riscos/incertezas honestas (não resolvidos no papel — validar na execução):**
- **Drift TS↔SQL na resolução da fonte:** o resolver TS (UI) e o SQL (escrita) precisam concordar. O servidor é autoridade na escrita; a UI serve para leitura/seed. Se divergirem, o CQ pode mostrar um card e o backend gravar em outro bloco. Mitigar com um teste de integração que compare `_resolver_fonte_confeccao` com o caso conhecido (adicionável em T3). Documentado.
- **`unaccent_simple`:** VERIFICADO no banco vivo que a extensão `unaccent` NÃO está instalada (`SELECT extname FROM pg_extension WHERE extname='unaccent'` = 0 linhas) — por isso o helper `translate`-based é obrigatório (não é mero fallback). Não trocar por `unaccent(...)` sem antes `CREATE EXTENSION`.
- **`salvar_terceirizados` não é wrapper+core hoje** (é DEFINER único com gate inline). Mantido assim (não regredir); os helpers NOVOS seguem #9 (REVOKE dos três). Se a revisão exigir split wrapper+core, é refactor separado.
- **`_aplicar_reais_do_grade_detalhe` só materializa variantes presentes no `grade_detalhe`** (guarda `v_gd ? vid`) para não zerar variantes intactas — validar que cobre o caso de uma variante sem nenhuma célula preenchida.
- **CORREÇÃO (aplicar na execução) — `jsonb_set` NÃO cria chaves intermediárias.** Nos dois pontos que gravam célula aninhada (`_salvar_cq_core` bloco FONTE ~l.727 e o `DO $recon$` ~l.840), o `jsonb_set(v_gd, ARRAY[v_vid::text, v_tam], …, true)` só cria a ÚLTIMA chave do caminho: se `v_gd` ainda **não tem** a chave da variante (`v_vid::text`), a escrita vira no-op silencioso. Na prática o toggle `detalhado` semeia todas as variantes×tamanhos (então `v_gd ? vid` costuma ser true), mas para blindar contra variante adicionada depois, **garantir o pai antes** do set aninhado, nos dois locais:
  ```sql
  -- ANTES do FOR v_tam … LOOP (garante o objeto da variante):
  IF NOT (v_gd ? v_vid::text) THEN
    v_gd := jsonb_set(v_gd, ARRAY[v_vid::text], '{}'::jsonb, true);
  END IF;
  ```
  Alternativa equivalente: montar a célula inteira e fazer merge no topo (`v_gd := v_gd || jsonb_build_object(v_vid::text, (v_gd->v_vid::text) || …)`). Verificar com um teste onde o bloco-fonte começa com `grade_detalhe = '{}'::jsonb` e o CQ grava recebido — o `grades_reais` derivado deve refletir o valor (não ficar vazio).
