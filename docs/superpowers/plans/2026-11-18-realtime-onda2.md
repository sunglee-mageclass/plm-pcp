# Realtime Onda 2 — presença de campo "quem está onde" em toda tela Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender o anel de presença de campo (nome + cor por pessoa) às telas editáveis que ainda não o têm, para ver quem está editando qual campo em toda tela possível.

**Architecture:** Pura ADESÃO aos dois mecanismos já prontos e em uso: `ColabPresenceOverlay` (anel por `data-colab-path`, para telas de DETALHE com `useColabRegistro`) e `useColabPresencaPagina` (canal por página + `campoFocado` que codifica `<campo>:<id>`, para telas de LISTA/kanban). Nenhum mecanismo novo. Cada tela faltante ganha: montar o overlay, marcar inputs com `data-colab-path`, e (nas listas) ligar `useColabPresencaPagina` + `onFocus/onBlur` que setam `campoFocado`.

**Tech Stack:** React + Supabase Realtime (presence + broadcast). Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-realtime-coedicao-ondas-design.md` (Onda 2).

## Global Constraints

- Deploy ÚNICO com a Revenda + Onda 1 (acumula na branch `feature/plan-tecido-a1`); publicação é portão do dono.
- Front puro, ZERO banco. Presença (presence + broadcast) NÃO passa por RLS, mas o canal SEMPRE leva o tenant no nome (`colab-canvas:<tela>:<tenant>`) — reforço de segurança S1.
- Reusar: `ColabPresenceOverlay` (`src/components/shared/ColabPresenceOverlay.tsx`), `useColabPresencaPagina` (`src/hooks/useColabPresencaPagina.ts`), `useColabRegistro` (`src/hooks/useColabRegistro.ts`), `colab-field-path.ts` (`data-colab-path`), `presenca-cor.ts` (cor por usuário). NÃO reimplementar.
- Padrão de DETALHE (tela com registro aberto): a tela já tem `useColabRegistro` → passar `campoFocado` + montar `<ColabPresenceOverlay presentes={...} scopeRef={...}/>` + `data-colab-path` nos inputs.
- Padrão de LISTA/kanban (canvas de cards, sem registro único): `useColabPresencaPagina({canal: 'colab-canvas:<tela>:<tenant>', campoFocado})` + `<ColabPresenceOverlay presentes scopeRef/>` + `data-colab-path={'<campo>:<id>'}` nos campos + `onFocus`/`onBlur` que setam `campoFocado` (`setCampoFocado('<campo>:<id>')` no foco, `null` no blur).
- Telas SÓ-leitura (Dashboard): só presença de "quem está vendo" (sem anel de campo) OU nada — ver Review Focus; YAGNI.
- `tsc --noEmit | grep TS2304` após imports.

## Review Focus

- **Canal sem tenant no nome:** um canal de presença sem o tenant vazaria presença entre lojas — toda tela nova usa `colab-canvas:<tela>:<tenant>`. Cada task cobre com asserção de fonte.
- **`campoFocado` não limpa no blur:** se o `onBlur` não setar `null`, o anel "gruda" no campo após sair — cada task de lista testa o par foco/blur.
- **Overlay sem scope correto:** o `scopeRef` tem de envolver os campos marcados; fora dele o anel não acha o elemento. Cada task confirma o scopeRef.
- **Presença em tela só-leitura:** Dashboard não deve montar anel de campo editável (não há campo). Task 4 decide (provável: nada).
- **Colisão de `data-colab-path`:** dois campos com o mesmo path confundem o anel — paths por `<campo>:<id>` únicos.

---

### Task 1: Oficina ganha o anel de presença de campo

A Oficina já ganhou `useColabRegistro` na Onda 1 (presença existe, `presentes` disponível), mas sem o overlay/`data-colab-path`. Esta task adiciona o anel.

**Files:**
- Modify: `src/routes/_authenticated/pcp.oficina.$modeloId.tsx`
- Test: `tests/unit/oficina-presenca-campo.test.ts` (teste de fonte)

**Interfaces:**
- Consumes: `presentes` do `useColabRegistro` (já montado na Onda 1); `ColabPresenceOverlay`, `data-colab-path`.
- Produces: nada exportado.

- [ ] **Step 1: Write the failing test (fonte)**

```ts
// tests/unit/oficina-presenca-campo.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const src = readFileSync("src/routes/_authenticated/pcp.oficina.$modeloId.tsx", "utf8");
describe("Oficina: anel de presença de campo", () => {
  it("monta ColabPresenceOverlay com presentes do colab", () => {
    expect(src).toMatch(/ColabPresenceOverlay/);
    expect(src).toMatch(/presentes=\{presentes\}/);
  });
  it("marca o campo do molde (e demais) com data-colab-path", () => {
    expect(src).toMatch(/data-colab-path=/);
  });
  it("passa campoFocado ao useColabRegistro", () => {
    expect(src).toMatch(/campoFocado/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/oficina-presenca-campo.test.ts --no-file-parallelism` → FAIL (ainda não há overlay).

- [ ] **Step 3: Implementação**

- Adicionar estado `const [campoFocado, setCampoFocado] = useState<string|null>(null)` e passá-lo ao `useColabRegistro({..., campoFocado})` (o arg já é aceito; na Onda 1 foi omitido).
- Criar `const scopeRef = useRef<HTMLDivElement|null>(null)` envolvendo o formulário da Oficina; montar `<ColabPresenceOverlay presentes={presentes} scopeRef={scopeRef} />` dentro desse container.
- Nos inputs (textarea do molde, e os campos de data/nf se houver), adicionar `data-colab-path={'oficina-molde:' + cad?.id}` (path único por campo) + `onFocus={() => setCampoFocado('oficina-molde:' + cad?.id)} onBlur={() => setCampoFocado(null)}`.
- Importar `ColabPresenceOverlay`.

- [ ] **Step 4: Run to verify it passes** + `npx tsc --noEmit 2>&1 | grep -E "oficina|TS2304" | head`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/pcp.oficina.$modeloId.tsx tests/unit/oficina-presenca-campo.test.ts
git commit -m "feat(realtime): Oficina mostra quem edita qual campo (anel de presenca)"
```

---

### Task 2: Cadastros editáveis ganham o anel (detalhe + listas simples)

Telas de Cadastro sem presença: `cadastro.atributos.tsx`, `cadastro.aviamentos.tsx`, `cadastro.colaboradores.tsx`, `cadastro.destinos.tsx`, `cadastro.etiquetas.tsx`, `cadastro.servico.tsx`, `cadastro.lojas.tsx`. São telas de LISTA/form de cadastro (não há "registro aberto" com `useColabRegistro` em todas). Usar o padrão de LISTA (`useColabPresencaPagina`).

**Files:**
- Modify: as 7 rotas de cadastro acima (as que de fato têm campos editáveis inline/dialog)
- Test: `tests/unit/cadastro-presenca-campo.test.ts` (fonte, varre as telas)

**Interfaces:**
- Consumes: `useColabPresencaPagina`, `ColabPresenceOverlay`, `useActiveTenantId`.
- Produces: nada.

- [ ] **Step 1: Write the failing test (fonte)**

```ts
// tests/unit/cadastro-presenca-campo.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const telas = [
  "src/routes/_authenticated/cadastro.atributos.tsx",
  "src/routes/_authenticated/cadastro.servico.tsx",
  "src/routes/_authenticated/cadastro.colaboradores.tsx",
];
describe("Cadastros: presença de campo", () => {
  for (const t of telas) {
    it(`${t} monta presença de página com canal por tenant`, () => {
      const src = readFileSync(t, "utf8");
      expect(src).toMatch(/useColabPresencaPagina/);
      expect(src).toMatch(/colab-canvas:[a-z-]+:\$\{?/); // canal leva o tenant
      expect(src).toMatch(/ColabPresenceOverlay/);
    });
  }
});
```
(O implementador ajusta a lista `telas` para as que realmente têm edição inline; telas de cadastro que abrem SÓ Dialog de "novo" com Salvar podem ficar fora — anotar no relatório.)

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implementação (por tela, padrão idêntico)**

Em cada rota de cadastro com campos editáveis:
- `const tenantId = useActiveTenantId();`
- `const [campoFocado, setCampoFocado] = useState<string|null>(null);`
- `const { presentes } = useColabPresencaPagina({ canal: tenantId ? 'colab-canvas:cad-<nome>:' + tenantId : null, campoFocado });`
- `const scopeRef = useRef<HTMLDivElement|null>(null);` no container da lista/form; `<ColabPresenceOverlay presentes={presentes} scopeRef={scopeRef} />`.
- Nos campos editáveis: `data-colab-path={'<campo>:' + row.id}` + `onFocus/onBlur` setando `campoFocado`.
- ⚠️ `<nome>` do canal ÚNICO por tela (cad-atributos, cad-servico, cad-colaboradores…).

- [ ] **Step 4: Run to verify it passes** + tsc.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/cadastro.*.tsx tests/unit/cadastro-presenca-campo.test.ts
git commit -m "feat(realtime): Cadastros mostram quem edita qual campo"
```

---

### Task 3: Telas de LISTA/kanban de negócio ganham o anel

Telas de lista/kanban editáveis sem presença de campo: `criacao.desenvolvimento.tsx` (kanban), `financeiro.tsx`, `otb.index.tsx`, `expedicao.lancamentos.tsx`, `pcp.etapas.tsx`, `criacao.armario.tsx`. Mesmo padrão de LISTA. (Só as que têm campo editável inline; kanban que só arrasta card não tem campo — anotar.)

**Files:**
- Modify: as rotas de lista/kanban acima que têm edição inline
- Test: `tests/unit/listas-presenca-campo.test.ts` (fonte)

**Interfaces:**
- Consumes: `useColabPresencaPagina`, `ColabPresenceOverlay`.
- Produces: nada.

- [ ] **Step 1: Write the failing test (fonte)** — mesma forma da Task 2, varrendo as telas de lista que recebem presença.

```ts
// tests/unit/listas-presenca-campo.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const telas = ["src/routes/_authenticated/financeiro.tsx"]; // + as que o implementador confirmar com edição inline
for (const t of telas) {
  it(`${t} tem presença de campo com canal por tenant`, () => {
    const src = readFileSync(t, "utf8");
    expect(src).toMatch(/useColabPresencaPagina/);
    expect(src).toMatch(/ColabPresenceOverlay/);
    expect(src).toMatch(/colab-canvas:[a-z-]+:/);
  });
}
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implementação** — mesmo padrão de LISTA da Task 2, um canal `colab-canvas:<tela>:<tenant>` por tela. ⚠️ Se uma tela (ex.: kanban do Desenvolvimento) NÃO tem campo editável inline (só move card), ela NÃO entra (presença de página já existe via overlay de outra forma, ou não se aplica) — anotar no relatório qual e por quê. Financeiro (edição de parcela inline), OTB (qtds por semana), Lançamentos, PCP Etapas e Armário são os candidatos com campo.

- [ ] **Step 4: Run to verify it passes** + tsc.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/financeiro.tsx src/routes/_authenticated/otb.index.tsx tests/unit/listas-presenca-campo.test.ts
git commit -m "feat(realtime): listas/kanban mostram quem edita qual campo"
```

---

### Task 4: Telas de Admin + decisão de só-leitura

Telas de Admin editáveis sem presença: `admin/identidade.tsx`, `admin/lojas.tsx`, `admin/usuarios.tsx`, `admin/usuarios-loja.tsx`. Baixo valor colaborativo (poucas pessoas editam loja/usuário juntas), mas o dono pediu "toda tela possível". Decisão (Ruling no plano): incluir Admin com o padrão de LISTA é barato; fazer. Dashboard é SÓ-leitura → só presença de "quem está vendo" (sem anel de campo) ou nada — Ruling: NADA (sem campo editável, anel de campo não se aplica; presença de página de leitura é YAGNI).

**Files:**
- Modify: `admin/identidade.tsx`, `admin/lojas.tsx`, `admin/usuarios.tsx`, `admin/usuarios-loja.tsx`
- Test: `tests/unit/admin-presenca-campo.test.ts` (fonte)

**Interfaces:**
- Consumes: `useColabPresencaPagina`, `ColabPresenceOverlay`.

- [ ] **Step 1: Write the failing test (fonte)** — varre as 4 telas de Admin asseverando `useColabPresencaPagina` + `ColabPresenceOverlay` + canal com tenant.

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implementação** — padrão de LISTA, canal `colab-canvas:admin-<nome>:<tenant>`. Dashboard NÃO é tocado (ruling: só-leitura, sem anel). Se uma tela de Admin for global (super admin, sem tenant único), usar um canal que não vaze entre tenants — para Admin Mestre, o canal pode ser por usuário/global; anotar no relatório a escolha (presença entre super admins é aceitável).

- [ ] **Step 4: Run to verify it passes** + tsc.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/admin/*.tsx tests/unit/admin-presenca-campo.test.ts
git commit -m "feat(realtime): Admin mostra quem edita qual campo (Dashboard fica so-leitura)"
```

---

### Task 5: Manual — seção "Trabalhar em equipe ao mesmo tempo"

O Manual (guia de uso, front puro — `src/lib/manual/conteudo/`) hoje NÃO menciona colaboração em tempo real. Com a Onda 2 a presença fica visível; com a Onda 1 e a revenda o comportamento mudou (tela atualiza sozinha, aviso de conflito). Esta task adiciona uma seção TRANSVERSAL de colaboração ao Manual.

**Files:**
- Modify: `src/lib/manual/conteudo/outros.ts` (ou um novo arquivo de conteúdo `colaboracao.ts`) + o agregador `src/lib/manual/conteudo/tipos-conteudo.ts`
- Possível: `src/lib/permissions-catalog.ts` / `nav.ts` se for preciso um pageKey próprio
- Test: `tests/unit/manual-colaboracao.test.ts` (fonte: a seção existe e cita os 3 pontos)

**Interfaces:**
- Consumes: os tipos de conteúdo do Manual (`SecaoConteudoManual`, `p`, `lista`, bloco `passos`).
- Produces: uma seção de conteúdo acessível no Manual a TODOS os logados.

- [ ] **Step 1: Decidir a âncora (o implementador resolve seguindo o padrão)**

O conteúdo é transversal (não é de uma tela só). Opções, em ordem de preferência:
1. Ancorar numa entrada própria visível a todos — reusar o pageKey `manual` (a própria tela do Manual) como host de uma seção "Trabalhar em equipe", se o `ManualPage`/`conteudoDaTela` permitir conteúdo para o host sem recursão; OU
2. Criar um pageKey leve `ajuda_colaboracao` no catálogo (sem rota real, como `manual` já é), filtrado a todos os logados, e registrar o conteúdo nele.
Abrir `ManualPage.tsx` + `montarEstruturaManual` (`src/lib/manual/estrutura.ts`) e escolher a opção que NÃO quebra o filtro por loja/permissão (a tela do Manual é universal). Anotar a escolha no relatório.

- [ ] **Step 2: Write the failing test (fonte)**

```ts
// tests/unit/manual-colaboracao.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// ajuste o caminho ao arquivo onde a seção foi escrita (outros.ts ou colaboracao.ts)
const src = readFileSync("src/lib/manual/conteudo/outros.ts", "utf8");
describe("Manual: seção de colaboração em tempo real", () => {
  it("existe uma seção sobre trabalhar em equipe ao mesmo tempo", () => {
    expect(src).toMatch(/equipe ao mesmo tempo|tempo real|ao vivo/i);
  });
  it("explica a atualização automática (sem recarregar)", () => {
    expect(src).toMatch(/sem recarregar|atualiza sozinha|F5/i);
  });
  it("explica o anel/quem está editando", () => {
    expect(src).toMatch(/cor|anel|quem está|está editando/i);
  });
  it("explica o aviso de conflito", () => {
    expect(src).toMatch(/manter o meu|usar o novo|outra pessoa salvou|conflito/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run tests/unit/manual-colaboracao.test.ts --no-file-parallelism` → FAIL.

- [ ] **Step 4: Escrever a seção**

Conteúdo didático (passos/parágrafos, no estilo do resto do Manual), cobrindo:
- **A tela atualiza sozinha:** quando outra pessoa salva o mesmo card/tela, o seu muda sem recarregar (sem F5). (Não prometer co-edição ao vivo — isso é a Onda 3, futura.)
- **Quem está editando o quê:** as bolinhas/anéis coloridos mostram quem está na tela e em qual campo cada pessoa está; cada pessoa tem uma cor.
- **Quando duas pessoas mexem no mesmo lugar:** aparece o aviso "outra pessoa salvou" com "manter o meu / usar o novo"; nada é apagado em silêncio.
Registrar o conteúdo no agregador (`tipos-conteudo.ts`) sob a âncora escolhida no Step 1.

- [ ] **Step 5: Run to verify it passes** + `npx tsc --noEmit 2>&1 | grep -E "manual|TS2304" | head`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/manual/conteudo/ tests/unit/manual-colaboracao.test.ts
git commit -m "feat(manual): secao 'Trabalhar em equipe ao mesmo tempo' (realtime/presenca/conflito)"
```

---

## QA no navegador (:5190, após as 5 tasks)

Duas abas (2 usuários) na mesma tela: Oficina, um Cadastro, uma lista de negócio (Financeiro/OTB), uma tela de Admin. Focar um campo numa aba → a outra aba mostra o anel colorido com o nome da pessoa no campo certo; sair do campo → o anel some. Conferir que a cor é consistente por pessoa e que não há vazamento entre lojas (canal com tenant). Dashboard: confirmar que não tenta montar anel de campo.

## Decisões adiadas / Rulings

- Dashboard = só-leitura, sem anel de campo (YAGNI). Se o dono quiser "quem está vendo", é item próprio.
- Telas de cadastro que só abrem Dialog de "novo" (sem edição inline da lista) podem ficar fora — o anel de campo é para edição concorrente de um registro existente; anotar quais ficaram fora e por quê.
- Admin Mestre (super admin, sem tenant): canal de presença por usuário/global (presença entre super admins aceitável); não vaza dado de loja (é só nome+foco).
