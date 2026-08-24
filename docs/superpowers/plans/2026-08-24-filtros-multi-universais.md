# Filtros multi-select universais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (ondas paralelas). Steps use checkbox (`- [ ]`).

**Goal:** Todo filtro de lista das ~14 telas client-side vira dropdown-com-checkbox (multi), com persistência por tela+usuário (localStorage) e "Limpar filtros" que zera o persistido. Multi vira o PADRÃO do `FilterButton`.

**Architecture:** (1) Fundação: `FilterButton`/`FilterConfig` com multi como default (single = opt-in `single:true`) + hook `useFilterState` (localStorage por screen+key). (2) Conversão por tela: estado `string`→`string[]` via `useFilterState`, remove "Todos" sintético, predicado `!==`→`.includes`/`.in`. (3) Cascatas (4): pai multi → filho = união + poda de órfãos. Dashboard/Financeiro/Auditoria FORA (fast-follow).

**Tech Stack:** Vite+React+TS, TanStack, Tailwind+shadcn, Vitest. **Sem banco** (client-side; OCs server usam `.in`, já suportado por PostgREST).

**Execução:** ondas paralelas de 5-6 telas. Fase 0 (fundação) SOZINHA e primeiro (tudo depende). Fases 1-3 em paralelo. tsc fica VERMELHO entre tasks (é a checklist do que falta); verde total na review final.

## Global Constraints

- **Padrão de conversão de um filtro de lista** (o núcleo mecânico, aplicar idêntico em toda tela):
  - Estado: `const [fX, setFX] = useState("all")` → `const [fX, setFX] = useFilterState("<screen>", "<Label>", [])` (tipo `string[]`).
  - Config no array de `filters`: remover `{ id: "all", nome: "Todos" }` das `options` (o "todos" = nada marcado). NÃO adicionar `multi:true` (é o default). Manter `label`, `value: fX`, `onChange: setFX`, `options`.
  - Predicado CLIENT: `if (fX !== "all" && m.campo !== fX) return false;` → `if (fX.length && !fX.includes(m.campo ?? "")) return false;`.
  - Predicado SERVER (`.eq`): `if (fX !== "all") q = q.eq("col", fX)` → `if (fX.length) q = q.in("col", fX)`. (queryKey do useQuery deve incluir o array — ex. `fX.join(",")` — senão não refetcha.)
  - Filtro com estado inicial `""` (ex. `fSemana`): mesma coisa, inicial `[]`.
- `<screen>` = uma string estável e única por tela (ex. `"planejamento"`, `"oc-tecido-estoque"`). Reusar o mesmo valor já passado no `screen=` do `FilterButton` quando existir; senão criar um curto e único.
- Anti-drift ATIVO: só classes-token; sem hex/px cru. `tsc --noEmit` e `npm run build` por task (esperado: build pode falhar em OUTRAS telas não migradas — o gate por-task é "esta tela compila isolada em termos de lógica + o build do projeto só reclama das telas ainda não feitas"; ver nota de migração). Anti-drift test deve passar sempre.
- NÃO tocar: Dashboard (`dashboard.tsx`, RPCs `dashboard_*`), Financeiro (`financeiro.tsx`), Auditoria (`admin/auditoria.tsx`) — fast-follow.
- Cada task edita idealmente 1 arquivo de tela (isolamento p/ paralelismo). Cascatas podem tocar 1 tela + (Colaborador→Responsável) o hook compartilhado.

---

## FASE 0 — Fundação (SOZINHA, primeiro, bloqueia todas as outras)

### Task 0.1: `useFilterState` hook (persistência localStorage)

**Files:** Create `src/hooks/useFilterState.ts` · Test `src/hooks/useFilterState.test.ts` (ou `tests/unit/`)

**Interface produzida:** `useFilterState(screen: string, key: string, initial: string[]): [string[], (v: string[]) => void]`.

- [ ] **Step 1 (teste primeiro):** testar: (a) inicial vazio → retorna `initial`; (b) setValue grava e re-lê de localStorage sob a chave `filtros:v1:{screen}:{key}`; (c) JSON corrompido no localStorage → cai no `initial` sem throw; (d) valor não-array persistido → `initial`.
- [ ] **Step 2:** implementar: `useState` hidratado de `localStorage.getItem("filtros:v1:"+screen+":"+key)` com `try/catch` (JSON.parse; se não for array de string, `initial`); `useEffect` grava no change (`JSON.stringify`); retornar `[value, setValue]`. SSR-safe (`typeof window`). Chave versionada `v1`.
- [ ] **Step 3:** rodar o teste (verde), `tsc --noEmit` no arquivo.
- [ ] **Step 4: Commit** `feat(filtros): hook useFilterState (persiste seleção por tela+usuário)`

### Task 0.2: `FilterButton` — multi vira o DEFAULT

**Files:** Modify `src/components/shared/filters.tsx` · Modify `src/components/dashboard/mobile.tsx` (o MobileFilterBar espelha) · Test `src/components/shared/filters.test.tsx` (ou unit) para o novo default.

**Interface produzida:** `FilterConfig` = `FilterConfigMulti` (default, `value: string[]`) | `FilterConfigSingle` (`single: true`, `value: string`). O componente renderiza checkbox-dropdown por padrão; só renderiza `<Select>` quando `single: true`.

- [ ] **Step 1:** Inverter a união em `filters.tsx`: `FilterConfigMulti` (sem flag ou `multi?: true`) é o default (`value: string[]`, `onChange: (v:string[])=>void`); `FilterConfigSingle` ganha `single: true` obrigatório (`value: string`). `renderFilter`: se `f.single` → o `<Select>` atual; senão → `MultiFilter` (já existe). Ajustar `isActive`/`computedCount`/`handleClear` (multi é o caminho comum agora; single é o ramo `f.single`).
- [ ] **Step 2:** Mesmo em `mobile.tsx` (`MobileFilterBar`): o ramo default vira multi (checkbox list), `f.single` → `<Select>`.
- [ ] **Step 3:** Teste: um `FilterConfig` sem flag renderiza checkboxes; com `single:true` renderiza um Select. `handleClear` zera `[]` no multi e `emptyValue` no single.
- [ ] **Step 4:** `tsc --noEmit` — ESPERADO: agora TODAS as ~14 telas não-migradas viram erro de tipo (passam `value:string` sem `single:true`). Isso é a checklist. NÃO tentar consertar as telas aqui. Confirmar que `filters.tsx` + `mobile.tsx` em si estão sem erro próprio e o teste passa.
- [ ] **Step 5: Commit** `feat(filtros): multi vira o padrão do FilterButton (single = opt-in)`

> Após a Fase 0, o tsc lista exatamente as telas a migrar. As fases seguintes rodam em PARALELO (cada tela 1 task).

---

## FASE 1 — Telas SEM cascata (ondas paralelas de 5-6)

Cada task: converter TODOS os filtros de lista da tela pelo Padrão (Global Constraints). Screen key sugerida entre parênteses.

- [ ] **Task 1.1 — Cadastro Tecidos** (`cadastro.tecidos.index.tsx`, screen `"cad-tecidos"`): Fornecedor, Categoria. Predicado client (checa join M:N + col legada em Categoria — preservar a lógica, só trocar igualdade por `.some/.includes`).
- [ ] **Task 1.2 — Plan. Tecido** (`criacao.plan-tecido.tsx`, `"plan-tecido"`): Mês, Ano, Status (binário), Tipo (binário).
- [ ] **Task 1.3 — Explosão** (`entrada-saida.explosao.index.tsx`, `"explosao"`): Coleção, Mês, Ano.
- [ ] **Task 1.4 — CQ** (`expedicao.cq.index.tsx`, `"cq"`): Coleção, Mês, Ano, Status.
- [ ] **Task 1.5 — Direcionamento** (`expedicao.direcionamento.index.tsx`, `"direcionamento"`): Status (binário), Coleção, Mês, Ano, Linha.
- [ ] **Task 1.6 — Lançamentos** (`expedicao.lancamentos.tsx`, `"lancamentos"`): Grupo, Coleção, Subcoleção, Categoria, Subcategoria, Linha, Mês, Ano, Lançamento nº, Repetição (binário). NÃO mexer nos filtros de data (`fDe`/`fAte`, children — ficam).
- [ ] **Task 1.7 — PCP CAD** (`pcp.cad.index.tsx`, `"pcp-cad"`): Coleção, Mês, Ano, Status CAD (binário).
- [ ] **Task 1.8 — PCP Oficina** (`pcp.oficina.index.tsx`, `"pcp-oficina"`): Coleção, Mês, Ano.
- [ ] **Task 1.9 — PCP Serviços** (`pcp.servicos.index.tsx`, `"pcp-servicos"`): Coleção, Mês, Ano, Status Geral.
- [ ] **Task 1.10 — OTB** (`otb.index.tsx`, `"otb"`): Ano, Mês.
- [ ] **Task 1.11 — Cadastro Aviamentos (parte não-cascata)** — ATENÇÃO: tem cascata Categoria→Subcategoria; vai na Fase 2. NÃO fazer aqui.

Cada Fase-1 task termina com: converter os filtros, ajustar predicado, `tsc --noEmit` (o arquivo da tela deve estar sem erro PRÓPRIO — os erros restantes são de OUTRAS telas), anti-drift verde, e Commit `feat(filtros): {tela} multi-select`.

---

## FASE 2 — Telas COM cascata (paralelo, tasks mais pesadas)

Padrão de cascata (pai `paiSel: string[]`): opções do filho = `filhos.filter(f => !paiSel.length || paiSel.includes(f.pai_id))`; `useEffect([paiSel])` poda `filhoSel` p/ o conjunto válido (`setFilhoSel(prev => prev.filter(id => validos.has(id)))`).

- [ ] **Task 2.1 — Planejamento** (`criacao.planejamento.tsx`, `"planejamento"`): Status JÁ é multi (não mexer nele, só migrar p/ `useFilterState`). Converter os outros 11: Lançamento (bin), Estilista, Lançamento nº, Mês, Ano, **Grupo→Categoria (cascata)**, Subcategoria, Subcoleção, Coleção, Origem (bin), Repetição (bin). Grupo→Categoria: Grupo multi, Categoria = união + poda.
- [ ] **Task 2.2 — Desenvolvimento** (`criacao.desenvolvimento.tsx`, `"desenvolvimento"`): Status, Explosão (bin), Estilista, Modelista, Piloteiro (casa em piloteiro1/2/3 — OR, já é multi-campo), Coleção, Subcoleção, **Grupo→Categoria (cascata)**, Subcategoria, Lançamento nº, Mês, Ano.
- [ ] **Task 2.3 — Cadastro Aviamentos** (`cadastro.aviamentos.tsx`, `"cad-aviamentos"`): **Categoria→Subcategoria (cascata)**, Material, Intervalo Largura, Intervalo Vazado, Fornecedor.
- [ ] **Task 2.4 — Hook `useResponsavelFilter` + OCs** (`src/hooks/useResponsavelFilter.ts` + `entrada-saida.oc-tecido.tsx` + `oc-aviamento.tsx` + `oc-insumo.tsx`): a cascata **Colaborador(tipo)→Responsável(pessoa)** vive no hook — `tipo` vira `string[]`, `pessoas` = união dos colaboradores dos tipos marcados, `idsFiltro`/`nomesFiltro` já retornam array (predicado `.in` já pronto). Converter TAMBÉM os filtros próprios de cada OC (Fornecedor `.eq`→`.in`, Estoque bin, Categoria, Alerta). Esta task toca 4 arquivos (o hook + 3 telas) — é a mais acoplada; UM agente só (não paralelizar internamente). Testar as 3 telas.
- [ ] **Task 2.5 — PCP Etapas** (`pcp.etapas.tsx`, `"pcp-etapas"`): Coleção, **Fornecedor (cascata implícita de Coleção)** — Coleção multi alimenta `useEtapasCards`; Fornecedor = distinct dos cards filtrados; ADICIONAR poda explícita de Fornecedor quando Coleção muda (rede que hoje não existe).

Cada Fase-2 task: converter + implementar a cascata + `tsc` (arquivo próprio limpo) + anti-drift + Commit `feat(filtros): {tela} multi-select (+ cascata X)`.

---

## FASE 3 — Fechamento

- [ ] **Task 3.1 — Verde total:** `npx tsc --noEmit` = 0 erros (todas as telas migradas). Se sobrar erro, é tela esquecida → migrar. `npm run build` passa. Anti-drift 8/8. `grep` por `!== "all"` nos arquivos tocados p/ caçar predicado esquecido.
- [ ] **Task 3.2 — QA visual (Playwright, reusar :5173):** por amostragem — Planejamento (cascata Grupo→Cat), 1 OC (cascata Colaborador→Resp), 1 tela simples; abrir Filtros, marcar 2+, ver lista filtrar, recarregar → seleção persiste, Limpar → zera. Screenshots desktop.
- [ ] **Task 3.3 — Review final da branch** (opus): coerência do padrão em todas as telas, cascatas corretas (união + poda), persistência não vaza entre telas (chave por screen), binários funcionam (marcar 2 = tudo), nenhuma tela FORA (Dashboard/Fin/Aud) tocada, nenhum `!== "all"` órfão.

---

## Self-Review

**Spec coverage:** fundação (0.1/0.2) → hook + default multi; ~14 telas (Fase 1+2); 4 cascatas (2.1/2.2/2.3/2.4/2.5); persistência (useFilterState em toda tela); Limpar (handleClear já zera). Dashboard/Fin/Aud FORA.

**Placeholder scan:** o Padrão de conversão está explícito (Global Constraints) com o código exato das 4 trocas; cada task nomeia a tela, o screen-key e os filtros; cascatas têm o padrão de união+poda. Cada agente deve LER a tela real p/ achar os pontos (predicado, array de filters) — as âncoras vêm do relatório de inventário.

**Type consistency:** `string[]` em todo estado convertido; `useFilterState` assinatura fixa; `FilterConfigMulti` default. Screen-keys únicos por tela.

**Riscos:** (a) queryKey server-side esquecer o array → sem refetch (2.4/OCs — destacar); (b) cascata sem poda → filho órfão filtra nada (padrão de poda obrigatório); (c) predicado `!== "all"` esquecido (Task 3.1 faz grep); (d) screen-key duplicado → 2 telas compartilham persistência (revisar unicidade no 3.3).
