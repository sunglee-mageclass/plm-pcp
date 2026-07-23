# Plan. Tecido — Design (Fase A.1)

> Planejamento de compra de tecido por coleção, tecido-cêntrico, dentro de **Estilo & Engenharia**.
> Data: 2026-07-22 (atualizado após rodada de mockups no companion visual). Projeto: sisTrama (PLM+PCP de moda, React+TS+Vite+Supabase, multi-tenant).
> Cobre a **Fase A.1** em detalhe; registra o **roteiro** (A.2 / B / C / limpeza) sem especificá-lo.

---

## 1. Contexto e objetivo

Hoje o OTB tem um **"Simulador de uso de OC"** (`src/components/otb/SimulacaoSheet.tsx`, botão-calculadora por card em `otb.index.tsx`): parte de uma **OC** e mostra se a coleção "zera" aquela OC. Cálculo puro em `src/lib/simulacao.ts`.

**Plan. Tecido** promove isso a **fluxo próprio** e **inverte o eixo**: parte do **tecido** (artigo), não da OC. Responde, **antes de comprar**: *"quanto de cada tecido a coleção precisa?"* — base para depois **gerar as OCs** (Fase B) e **conferir contra OCs reais** (Fase C). Substitui a calculadora do OTB e a tela **Consumo por OC**.

---

## 2. Decisões-chave (aprovadas pelo dono; ✔ = validado em mockup)

| # | Decisão |
|---|---|
| D1 | **Arquitetura B** — tela própria tecido-cêntrica, reusando libs de cálculo + componentes de grade. |
| D2 | **Reuso no nível de CÓDIGO** (motor extraído do `SimulacaoSheet`) + **tabelas NOVAS `plan_tecido_*`**. O `SimulacaoSheet`/`otb_simulacao_*` **ficam vivos** até a Fase C aposentar a calculadora do OTB. |
| D3 | **Escopo A.1 inclui os CUSTOS** (guardados no plano `plan_tecido_*`, isolados, reusando `preco.ts`). **Só o write-back ao modelo real** (empurrar grade + custo pro card) fica na **A.2** — é o ponto de risco. |
| D4 | **Metragem prevista SEM perda e SEM piloto**: `Σ consumo × grade_total × multiplicador`. Margem vem do arredondamento pra cima na Fase B. |
| D5 | **Resumo = "Necessidade de tecido"** (só metros). Estoque é **opcional**, via bloco **"Situação de compra"** (checkbox "Usar estoque existente" → abate o que já tem; sub-opção "Só estoque livre"). **Default: necessidade cheia** (OCs destinadas à coleção). **kg só no pedido** (Fase B). ✔ |
| D6 | **Remover a tela Consumo por OC** e **aposentar `estoque_zerado`** — fatia própria, junto da Fase C (mexe no core do estoque). Retalho vira baixa de ajuste **"- Metragem"** na OC Tecido; lotes zerados hoje são **revertidos**. |
| D7 | **Página inteira** (rota própria), **não** Sheet 70% — denso demais. Layout: **2 colunas de MODELOS diferentes**; expandir **na própria coluna** (não vira largura total); blocos internos empilham; **tudo colapsável em 4 níveis** (árvore → card → abas → bloco de material). ✔ |
| D8 | **Grade editável só no Tecido 1**; forro/tecido-2 têm variantes próprias + **multiplicador** (peças derivam do Tecido 1). Ao escolher um artigo, **todas as variantes cadastradas aparecem com CHECKBOX** — marca-se as usadas (a não usada fica de fora). Entretela **fora**. ✔ |
| D9 | **Proporção de grade acompanha o cadastro do modelo** (`modelos.proporcoes`, mesma do Dev/CAD); editável aqui, **não-destrutivo**. ✔ |
| D10 | Custos: **editável = branco / derivado = cinza** + banner âmbar "estimativa, não é o real". **Markup/preço são read-only** e via `preco.ts` (invariante #8). Resumo tem card **Poder de venda (previsto)** = `Σ preço efetivo × grade`. ✔ |

---

## 3. Escopo da Fase A.1

**Entra:**
- Rota/tela nova + item na sidebar (Estilo & Engenharia, acima de Plan. Produto), gating criacao+otb.
- Lista de coleções (confirmadas ou não) → abre a **página** "Planejamento de Tecido".
- Árvore coleção → subcoleção → linha (PV) / categoria (Orçamento) → slots de modelo (2 colunas). Toggle **"por linha ↔ por tecido"** (só visão).
- Card do modelo com abas colapsáveis **Tecidos & Forros · Grade · Custo & Preço**:
  - **+ tecido / + forro** (vários; entretela fora); cada material = artigo + variantes (checkbox) + consumo (estimativa, selo CAD/BOM/est.).
  - **Grade** por variante no Tecido 1 (prof/cor → Σ = total); proporção de tamanho do cadastro.
  - **Custo & Preço** (previsto): materiais (deriv.), mão de obra (edita), custo total (deriv.), markup (deriv.), preço sugerido (deriv.), preço p/ venda (edita) — tudo **no plano**, isolado.
- **Resumo** (coluna): bloco **"Situação de compra"** + **"Necessidade de tecido"** (metros, subtotais + total) + **"Poder de venda (previsto)"**.
- Persistência em `plan_tecido_*` (1 plano por coleção). Dirty + guarda de descartar; `MobileActionBar` no mobile.

**NÃO entra (A.2+):** "aplicar grade/custo ao modelo real" (write-back); badge de pedido; gerar OC; overlay de OC real.

---

## 4. Navegação e gating

- **Rota:** `src/routes/_authenticated/criacao.plan-tecido.tsx` → `/criacao/plan-tecido` (a **lista**). O painel de uma coleção é uma **sub-rota/página inteira** (ex.: `/criacao/plan-tecido/$colecaoId`), não um Sheet 70%. Envolver com `<RequirePermission page="criacao_plan_tecido">`; o layout `criacao.tsx` já aplica `<ModuleGuard module="criacao" />`.
- **Permissão:** `{ key: "criacao_plan_tecido", label: "Planejamento de Tecido" }` em `permissions-catalog.ts`, no bloco `module: "criacao"`, **antes** de `criacao_planejamento`.
- **Sidebar:** `criacao_plan_tecido: "/criacao/plan-tecido"` em `PAGE_URLS` (obrigatório) + rótulo curto "Plan. Tecido".
- **Gating por OTB:** checar `isModuleEnabled("otb")` no componente (mostra `EmptyState` se off) — a tela lê `colecoes`, que só existem com otb. Efeito: aparece com **criacao E otb**.
- **Breadcrumb** "Estilo & Engenharia › Plan. Tecido › {Coleção}" (dono quer replicar em outras telas — ver §12).

---

## 5. Tela 1 — Lista de coleções

- Query `["plan-tecido-colecoes"]` em `colecoes` (todas): `nome, mes_id, ano_id, tipo, status`.
- Card por coleção: nome, mês/ano, tipo, status.
- **Filtros** (reusa o padrão das outras telas): **mês**, **ano**, **status** (rascunho/confirmada), **tipo** (Orçamento/Poder de Venda). Client-side sobre as coleções carregadas; mês/ano de `meses`/`anos`.
- **Status de PEDIDO (Fase B)**: indicado pela **cor da BORDA do card** (🔴 não pedido / 🟡 encomendado / 🟢 entregue), **não** por bolinha. Na A.1 **não** há indicador de pedido (sem placebo — lógica só após a Fase B gerar OCs).
- Clicar → navega pra página do painel daquela coleção.

---

## 6. Tela 2 — Página "Planejamento de Tecido"

### 6.1 Estrutura
- **Esquerda (rola):** árvore da coleção. **Direita (fixa, redimensionável):** resumo. No mobile o resumo vira faixa sticky no topo.
- **Tudo colapsável em 4 níveis:** (1) árvore (subcoleção/linha), (2) card do modelo, (3) abas do card, (4) cada bloco de material. Abrem sob demanda (1º material e 1ª aba abertos por padrão).

### 6.2 Árvore + toggle
- `coleção → subcoleção → (linha | categoria) → slots de modelo` — **2 colunas de modelos**. Nº de slots = espelho do plano (`colecao_pv_itens.qtd_semanas` / `colecao_semanas.qtd_planejada`), reusando `semear()`.
  - PV → nível 3 = **linha**; Orçamento → **categoria** (resto sem categoria = bucket "Sem categoria").
- **Toggle "por linha ↔ por tecido"** (`ToggleGroup` sticky): só reagrupa a exibição; nunca é chave de gravação. Preservar expansão/scroll ao trocar.
- **Expandir um card acontece na própria coluna** (não vira largura total); os blocos internos empilham. Dá pra ter 2 modelos abertos lado a lado.
- Header colapsado do modelo: `ref · nome · Σ metragem · ✓ grade / ⚠ falta`.

### 6.3 Card do modelo (abas colapsáveis)
- **1. Tecidos & Forros:** botões **+ tecido / + forro**. Cada material colapsável (header = `artigo · consumo · N cores · Σm`):
  - Artigo (dropdown; entretela não entra) → **todas as variantes cadastradas** com **checkbox** (marca as usadas).
  - **Consumo** (m/pç) editável, com selo de procedência: **CAD** (congelado), **BOM** (dev), **est.** (média). `loss_percent` vem na query (para A.2/Fase B) mas **não** entra no cálculo (D4).
  - **Tecido 1:** variantes marcadas ganham **prof/cor**. **Forro/Tecido 2:** variantes marcadas ganham **multiplicador** (peças derivam da grade do Tecido 1).
- **2. Grade** (Tecido 1): prof/cor por variante (Σ = grade total) + **proporção de tamanho do cadastro** (`modelos.proporcoes`, editável, não-destrutivo).
- **3. Custo & Preço** (previsto, guardado no plano): banner âmbar; **materiais** (deriv., cinza), **mão de obra** (edita, branco), **custo total** (deriv.), **markup** (deriv.), **preço sugerido** (deriv.), **preço p/ venda** (edita). Via `preco.ts`.

### 6.4 Resumo (coluna direita)
- **Situação de compra:** ☐ Usar estoque existente (abate) · ☐ Só estoque livre (não reservado; sub-opção). Default off = **necessidade cheia**.
- **Necessidade de tecido (metros):** por tecido → por variante → subtotal → total. **Sem** estoque/coberto/limitador por padrão. Com "usar estoque existente" ligado, cada tecido ganha "tenho / a comprar" (lê `estoque_tecido()`; físico ou disponível conforme a sub-opção).
- **Poder de venda (previsto):** `Σ preço efetivo × grade` + margem média (via `preco.ts`).
- **kg:** só aparece no **pedido** (Fase B); no resumo tudo em metros.

### 6.5 Estado e ações
- **Dirty** explícito (● alterações não salvas) + Salvar/Salvo (o dono quer replicar esse indicador em outras telas — §12). Guarda de descartar ao fechar/trocar com dirty. `MobileActionBar` no mobile (não o rodapé interno do `SimulacaoSheet`). Toques 44px.

---

## 7. Reuso / refactor

- **Extrair o motor** do `SimulacaoSheet` para `src/lib/plan-tecido/` (semeadura da árvore, reconciliação, helpers de grade/consumo), importando puros de `simulacao.ts` (`splitEven`, `metragemDisponivel`, `mediaConsumoCategoria`). **Não** empilhar dois eixos no `simulacao.ts`.
- **Cálculo em lib nova** `src/lib/plan-tecido/calc.ts` com testes: `metragem = consumo × grade_total × multiplicador`; poder de venda via `preco.ts`; abatimento opcional de estoque.
- **`SimulacaoSheet` + `otb_simulacao_*` seguem vivos** até a Fase C. A A.1 coexiste sem tocá-los.
- **types.ts** pendente de regen → `plan_tecido_*` com `as any` em `.from()/.rpc()`; testar RPCs por txn revertida.

---

## 8. Modelo de dados e cálculo

### 8.1 Schema `plan_tecido_*` (A.1) — 1 plano por coleção

Migration aditiva, **`BEGIN;…COMMIT;`**, idempotente, aplicada por `psql -f` (regra 1). RLS por tenant (copiar bloco `DO $$` de `20260722100000`: rls + 4 policies `tenant_*` + trigger `set_tenant_id`). Índice em toda FK plana. Wrapper de módulo `criacao`.

```
plan_tecido            (id, tenant_id, colecao_id FK→colecoes CASCADE, created_at, updated_at)  UNIQUE(colecao_id)
plan_tecido_subcolecoes(id, tenant_id, plan_id FK CASCADE, subcolecao_id FK→colecao_subcolecoes CASCADE null, ordem)
                         UNIQUE NULLS NOT DISTINCT (plan_id, subcolecao_id)
plan_tecido_linhas     (id, tenant_id, sub_id FK CASCADE, linha_id FK→linhas null, categoria_id FK→categorias_produto null, ordem)
plan_tecido_slots      (id, tenant_id, linha_ref_id FK CASCADE, modelo_id FK→modelos ON DELETE SET NULL,
                         slot_index, nome,
                         -- custos guardados no plano (A.1, isolado):
                         custo_simulado jsonb, custo_terceirizados_previsto numeric(10,2),
                         custos_adicionais jsonb default '[]', preco_venda numeric(10,2))
plan_tecido_materiais  (id, tenant_id, slot_id FK CASCADE, artigo_id FK→artigos, tipo 'tecido'|'forro',
                         numero int, consumo numeric(10,4), loss_percent numeric(5,2), ordem)  UNIQUE(slot_id,tipo,numero)
plan_tecido_variantes  (id, tenant_id, material_id FK CASCADE, variante_tecido_id FK→variantes_tecido,
                         ordem int, multiplicador numeric default 1, grades jsonb '{tam:qtd}', grade_total int)
                         UNIQUE(material_id, ordem)
```

Notas: grade fica **dentro de `plan_tecido_variantes`** (só reexpande p/ `modelo_grades` na A.2). Sem `oc_tecido_id` (OC = Fase C, modelada **por variante-de-tecido**). `plan_tecido_variantes` guarda só as variantes **marcadas** (checkbox on). Custos no `plan_tecido_slots` (não no modelo real). Slot↔card via `modelo_id` nullable (SET NULL); **não** alimenta `otb_orcamento` (evita contagem dupla).

### 8.2 Cálculo
- **Necessidade por variante** (m): `consumo × grade_total × multiplicador` (D4).
- **Necessidade por tecido** = Σ das variantes daquele artigo na árvore (independe do eixo de visão).
- **Abatimento opcional** (só com "usar estoque existente"): `a comprar = max(0, necessidade − estoque)`; estoque = físico (ou disponível = físico − reservado, se "só estoque livre") via `estoque_tecido()`/`_estoque_tecido_core` (invariante #4, não reimplementar).
- **kg** (Fase B): `kg = m ÷ rendimento` (guardar `rendimento>0`).
- **Poder de venda (previsto):** `Σ (preço efetivo × grade)` via `precoInfo` de `preco.ts`.

### 8.3 Persistência (RPCs) — wrapper + `_core`, REVOKE dos TRÊS (invariante #9)
- **Leitura:** `plan_tecido_arvore(_colecao_id)` → árvore inteira em `jsonb` (evita N+1), com labels de artigo/variante. Fallback do consumo: se slot tem `modelo_id` e material sem consumo próprio, lê `modelo_tecidos.consumo`.
- **Escrita:** `salvar_plan_tecido(_colecao_id, _arvore jsonb)` — upsert atômico delete-then-insert. Grava tecidos/forros/variantes/grade/**custos no plano**. **NÃO** escreve em `modelo_tecidos`/`modelo_grades`/`modelos` (write-back é A.2). **NÃO** propaga consumo pro BOM.

---

## 9. Testes (A.1)
- **Unit:** `plan-tecido/calc.ts` — necessidade por variante/tecido, abatimento opcional, kg, poder de venda. Bordas: `rendimento=0`, grade vazia, mult≠1, variante desmarcada.
- **Integração transacional:** `salvar_plan_tecido` + `plan_tecido_arvore` (upsert idempotente, isolamento por tenant, fallback de consumo).
- **Segurança:** `has_function_privilege('anon'|'authenticated','_..._core','EXECUTE') = false`.
- **Build/tsc:** `npm run build` + `npx tsc --noEmit | grep TS2304` (regra 4).

---

## 10. Riscos herdados (relevantes na A.2 — a A.1 não os toca)
1. **Write-back grade+custo ao modelo (A.2):** o `_aplicar_sim_no_modelo_core` (`20260720310000`) faz `DELETE` de `modelo_grades` + reinsere `grades='{}'` e só guarda `status='aprovado'` — **não** contra `enviado_cad`/CQ. Na A.2: passar por `salvar_modelo_bom`, **preservar `grades`** por tamanho, **bloquear/avisar** se foi ao corte/CQ (`modelo_etapas_afetadas` + `DownstreamConfirmDialog`), `#Erro` só em diff real.
2. **PV=linha × Orçamento=categoria**: eixo primário por `tipo`; "por tecido" só visão.
3. **Contagem dupla** slot×card — `plan_tecido` não alimenta `otb_orcamento`.

---

## 11. Fatia de limpeza — remover Consumo por OC + aposentar `estoque_zerado` (D6)
Fatia própria (mexe no core do estoque, invariante #4), sugerida junto da Fase C.
- Remover `criacao.consumo-oc.tsx` + rota + permissão `producao_consumo_oc` + item da sidebar (inclui "Consumo por Rolo").
- Aposentar `estoque_zerado`: **reverter** os itens zerados hoje (→ estoque real), migration `BEGIN/COMMIT`; conferir que `_estoque_tecido_core` e derivados não dependem mais do flag.
- Retalho → **"- Metragem"** (baixa de ajuste) na OC Tecido (já existe). Avaliar dropar a RPC `consumo_por_oc`.

---

## 12. Roteiro das próximas fases (registro)
- **A.2** — **"Aplicar ao modelo"**: empurra **grade + custo previsto** do plano pro card real (`modelo_grades` via `salvar_modelo_bom`; `custo_simulado`/`custo_terceirizados_previsto`/`preco_venda` em `modelos`), com as guardas do §10.1. Só faz sentido em slot ligado a card real.
- **Fase B** — **"Fazer pedido"**: gera OC automática, **pede só o déficit** (necessidade − estoque), **arredonda pra cima** (metro → dezena em 0; kg → dezena em 5/0). Badge 🔴/🟡/🟢 na lista.
- **Fase C** — **Simular com 1+ OC reais** (overlay; seletor = código + nome do tecido). **Aposentar a calculadora do OTB**.
- **Transversais (dono pediu p/ replicar em outras telas):** o indicador **"● alterações não salvas"** e o **breadcrumb** "Estilo & Engenharia › … ›". Fora do escopo da A.1, rastreados aqui.

---

## 13. Decisões em aberto (não bloqueiam A.1)
- Físico vs disponível quando "usar estoque existente": a sub-opção "só estoque livre" cobre; confirmar o default (físico).
- A.2: política de "aplicar" em slot vazio (obriga criar card antes, reusando `criar_card_simulacao`).
- Piloto na compra (Fase B): D4 = sem piloto; reavaliar se o arredondamento cobre.
