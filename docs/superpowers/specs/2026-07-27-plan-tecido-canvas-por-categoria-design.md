# Plan. Tecido — Canvas por Categoria de Tecido — Design (reconciliado v2)

> Redesenho da experiência de trabalho do **Planejamento de Tecido**: navegação em níveis
> (Coleção → Subcoleções → Canvas), tela cheia (Sheet 100vw), planejamento por **categoria de tecido**
> (lanes), card **editável inline**, e Resumo à esquerda escopado à subcoleção com drill-down por OC.
> Data: 2026-07-27 · reconciliada 2026-07-28 após 10 rodadas de protótipo interativo + avaliação
> de 3 revisores (UX, viabilidade técnica, reconciliação). Projeto: sisTrama (React+TS+Vite+Supabase,
> multi-tenant/RLS). Branch: `feature/plan-tecido-a1`. Base da Fase A em `2026-07-22-plan-tecido-fase-a-design.md`.
>
> **Referência visual/comportamental:** protótipo HTML (10 versões) — o comportamento fino (estados,
> gating, tempo real) segue o protótipo. Este doc é a fonte da verdade das DECISÕES e do PLANO DE FASES.

---

## 1. Contexto e objetivo

Hoje o Plan. Tecido (Fase A) abre num Sheet 70vw que despeja a árvore inteira da coleção com o Resumo à
direita. O redesenho inverte a experiência para o fluxo real das estilistas + comprador de tecido:

1. **Coleção → Subcoleções → Canvas** (tela cheia).
2. Na subcoleção, planeja-se por **categoria de tecido** (lanes): a estilista declara as categorias, distribui
   os modelos, e só depois **pesquisa → cadastra → associa** o tecido concreto (com fornecedor).
3. **Resumo à esquerda** (escopo da subcoleção): a comprar, pendências, poder de venda, situação da OC — com
   **drill-down por tecido/variante** num subsheet.
4. **Pedido gated por categoria**; wizard **paginado, uma OC por fornecedor**, com prazo/parcelas.

A "categoria da lane" é **rótulo de planejamento** (das `categorias_tecido`), desacoplada da heurística de
papel. O *papel* (tecido/forro) é bloco **dentro** do card; a categoria é a lane.

---

## 2. Decisões-chave (aprovadas pelo dono via protótipo)

| # | Decisão |
|---|---|
| C1 | **Grade = PROPORÇÃO por tamanho, INFORMATIVA.** No topo do card, fixa (não colapsável): tamanhos (`PPP..GG`, de `tenant_config.tamanhos_grade`, fallback `34\|PPP…44\|GG`) com campo de proporção (placeholder 0). É a **curva de tamanho** (`modelos.proporcoes`); **não** gera as peças. Ao "Aplicar ao modelo" já em Desenvolvimento, **atualiza a `proporcoes` existente e a partir daí é separada** (o Dev é dono). O número que conta é a **grade por VARIANTE (peças)**. |
| C2 | **3 telas dentro do Sheet 100vw** (`w-screen`): **Coleções** → **Subcoleções** → **Canvas**. Estado interno (`view`), sem rota nova. Breadcrumb clicável na topbar. |
| C3 | **Forro é bloco DENTRO do modelo, NÃO seção/lane separada.** Uma superfície: lanes por **categoria de tecido**. O card cai numa categoria de tecido; o forro se edita dentro do card. **Múltiplos tecidos e múltiplos forros** por card; **forro tem grade/variantes próprias** (deixa de ser multiplicador — reverte D8). Não pode remover o último tecido. |
| C4 | **Categoria da lane vem de `categorias_tecido`** (rótulo de planejamento), desacoplada do papel; a trava de papel só vale ao associar o artigo (forro = artigo cat "Forro"). |
| C5 | **Categoria de tecido é o agrupamento primário** dentro da subcoleção; **`linha` continua como dado** do modelo (markup/PV) mas não é mais o agrupamento visual. **Chips de filtro** por categoria ("Todos \| Malha \| …"). |
| C6 | **Persistência estende a árvore + o save existente** (`salvar_plan_tecido`/`plan_tecido_arvore`), com `dirty`/`UnsavedIndicator`/desfazer e **botão Salvar** na action bar. Um único caminho de save. |
| C7 | **Poder de venda GATED até fornecedor.** No Resumo e nas action bars, PV/preço mostram "R$ —" enquanto nenhum tecido tiver fornecedor; aí passam a exibir o **realizado c/ fornecedor**. **Custo** respeita a permissão (invariante #12, `custo_unitario_modelos`). |
| C8 | **Pedido gated POR CATEGORIA** (todos os modelos da categoria com fornecedor). 3 disparos: **por categoria** (lane), **por subcoleção** (canvas action bar), **por coleção** (lista de subcoleções). RPCs de prévia/pedido ganham `_subcolecao_id` e `_categoria_tecido_id` **opcionais** (`NULL`=comportamento atual). Botão desabilitado tem **tooltip** com o motivo. |
| C9 | **Card EDITÁVEL inline** (é o `ModelCard`, não mini-card+Dialog). Lado a lado com scroll horizontal por categoria; **colapsável** (colapsado mostra variantes+metragem) + "recolher/expandir todos". Acordeão: Grade-proporção (fixa) · Tecidos & Forros · Custo & Preço. Seleção (checkbox) + arraste (mudar de lane). |
| C10 | **Consumo/grade por VARIANTE**: metragem derivada = `Σ(consumo × grade_pç)` por material. Consumo com selo **est.** (editável) ou **Dev** (travado + tooltip) quando o modelo está avançado (espelha o BOM do Desenvolvimento). |
| C11 | **Cor planejada = cor base + cor apelido** (`cores`+`cores_apelido`, ver `src/lib/variante.ts`). "+ adicionar cor" oferece a base combinada; **quando há artigo, filtra pelas cores cadastradas do tecido**. |
| C12 | **Alerta de divergência de cor**: se a cor planejada não existe no tecido escolhido → alerta + "remover cores divergentes". (Fluxo cor-primeiro.) |
| C13 | **Tecido (artigo) filtrado pela categoria da lane** no seletor do card (∩ com a paleta da coleção, se mantida). Rótulo "Tecido"/"Forro" (não "Artigo"). |
| C14 | **Custo destrinchado**: custo tecido (auto) · custo forro (auto) · custo materiais (editável/prev. ou Dev) · mão de obra (editável/prev. ou Dev) · custo total · markup (linha) · preço sugerido · preço p/ venda. **Aprovar/Reprovar mão de obra** só quando avançado (flag `modelos.custo_terceirizados_aprovado`, já existente). |
| C15 | **"Criar card no Planejamento"** (planejamento-primeiro: o item pode existir só no plano) e **"Aplicar ao modelo"** (staging, grava no Salvar do Dev; só avançado). Já existem: `plan_tecido_criar_card`/`plan_tecido_aplicar_ao_modelo`. |
| C16 | **OC vinculada por MODELO** (seletor filtrado pelos tecidos do modelo) + **auto-atribuição** ao gerar o pedido. **Situação da OC POR OC** (pedida/entregue/reservada/usada/sobra) em tempo real; **reserva por MATERIAL** (não por modelo inteiro — corrige forro de outro fornecedor). |
| C17 | **Subsheet drill-down** (extensão do Resumo, empurra — não sobrepõe; toggle): 3 modos — a comprar por tecido/variante, situação por tecido/variante, uma OC por tecido/variante. **Resumo colapsável** num trilho fixo (Resumo · A comprar · OC) que abre o subsheet direto. |
| C18 | **Bloco de Pendências** no Resumo: nº de modelos sem categoria, sem tecido/fornecedor, sem card, mão de obra não aprovada, divergência de cor. |
| C19 | **Fazer pedido = wizard PAGINADO, uma OC por fornecedor**; cada OC com **prazo de pagamento (digitável, dias)**, **parcelas de recebimento**, data prevista. Vincula a OC à subcoleção. **Vincular OC existente** (menu no Resumo). |
| C20 | **Breadcrumb clicável** (candidato a padrão global) + **action bars inferiores** (`<PageActionBar>`) por tela: Voltar · métricas · Salvar · Fazer pedido. **"A comprar"** não duplica forro (linha de categoria = só tecido; forro em linha própria; total = tecido+forro). |

**Correções de UX apontadas pela avaliação, a incorporar na implementação:** re-render cirúrgico (não reconstruir o canvas a cada tecla — preservar scroll/foco); **acessibilidade** (checkbox real, dropdown de categoria por card além do arraste, focus-trap nos diálogos, `:focus-visible` global); **confirmação/desfazer** em remoções (categoria/cor/material); alvos ≥44px; `DateField` para datas; persistir dispensa do hint.

---

## 3. Escopo

**Entra:** telas Coleções/Subcoleções/Canvas dentro do Sheet 100vw; breadcrumb clicável; lanes por categoria
de tecido + chips de filtro + seleção/aplicar/"+categoria"/arraste; card editável inline (grade-proporção fixa,
múltiplos tecidos/forros, consumo/grade por variante, divergência de cor, custo destrinchado + aprovar MO, criar
card/aplicar ao modelo); Resumo à esquerda colapsável (a comprar, pendências, poder de venda gated, OCs
vinculadas, situação por OC) + subsheet drill-down; pedido por categoria/subcoleção/coleção (wizard paginado);
OC por modelo; botão Salvar (dirty/undo).

**NÃO entra:** limpeza de duplicatas de `categorias_tecido`; cadastro de tecido/fornecedor (segue no Cadastro);
regenerar `types.ts` (a feature usa `as any`, débito conhecido); toggle de tema (nível protótipo).

---

## 4. Modelo de dados (final)

Tudo persistido pela árvore (`salvar_plan_tecido`/`plan_tecido_arvore`), diff incremental por id (invariante #3).

- **`plan_tecido_slots`**: `+ categoria_tecido_id uuid REFERENCES categorias_tecido(id)` (nullable; `null`=Sem
  categoria). **NÃO** reaproveitar `categoria_id` (esse é `categorias_produto`, outro eixo). **Sem** `categoria_forro_id` (C3).
- **`plan_tecido_subcolecao_categorias`** (nova): quais lanes existem mesmo vazias — `(id, tenant_id, subcolecao_id
  FK ON DELETE CASCADE, categoria_id FK categorias_tecido, UNIQUE(subcolecao_id, categoria_id))`. RLS tenant-scoped +
  `set_tenant_id_trg` + índice em `subcolecao_id`. **Só tecido** (sem `papel`).
- **Materiais** (já existem em `plan_tecido_materiais`/`_variantes`): tecido/forro com `artigo_id`, `consumo`,
  variantes `{cor_id, cor_apelido_id, grade_total}`. **Forro passa a ter grade/variantes próprias** (C3) — hoje usa
  multiplicador; migrar a semântica (o forro deixa de derivar da grade do Tecido 1). Proporção por tamanho já existe
  (`plan_tecido_slots.proporcoes`, migração `20260731100200`).
- **Custos/preço no plano** (já em `slot.custo_simulado`/`preco_venda`): manter **estimativa** (não puxar custo real
  sem o gate #12). Markup lido de `linhas`. Mão de obra aprovada = `modelos.custo_terceirizados_aprovado`.
- **OC↔modelo**: `plan_tecido_slot_oc` (já existe, hint por slot) — usar single-select no card + **auto-atribuir**
  no fim de `_plan_tecido_fazer_pedido_core`. **OC↔subcoleção**: escopo em `plan_tecido_oc_aplicada`/`plan_tecido_ocs`.
- **RPCs de pedido**: `plan_tecido_previa_pedido`/`plan_tecido_fazer_pedido` ganham `_subcolecao_id`/
  `_categoria_tecido_id DEFAULT NULL`. Diff-validar (`pg_get_functiondef`) + teste txn revertido (ambiente §1).
- **Situação da OC** (RPC NOVA, leitura): wrapper+`_core` revogado (invariante #9). **pedida** = Σ
  `ocs_tecido_itens.quantidade_pedida`; **entregue** = Σ `quantidade_recebida`; **usada** = Σ
  `estoque_tecido_baixas.quantidade WHERE oc_tecido_item_id ∈ itens` (padrão da antiga `consumo_por_oc`); **sobra** =
  entregue − usada; **reservada** = demanda viva dos cards atribuídos à OC (plan-side, front). ⚠️ **NÃO** é o
  `reservado` do `_estoque_tecido_core` (invariante #4) — não conflatar, não reimplementar o core, não criar baixa.

---

## 5. Plano de implementação (fases)

> Muito do fluxo **já está implementado** e não deve ser refeito: aprovar/reprovar MO (#8/#12), criar card /
> aplicar ao modelo (#6/#7), wizard Fazer pedido + parcelas (#1), `plan_tecido_estoque` (roda o core, #4),
> `plan_tecido_slot_oc` (hint por slot), cobertura/status de OC. A migração `20260728000000` descrita na v1 desta
> spec **nunca foi aplicada** — a Fase 1 a materializa (com o ajuste C3: só `categoria_tecido_id`).

**Fase 1 — Canvas por categoria (núcleo).** Migração `categoria_tecido_id` no slot + `plan_tecido_subcolecao_categorias`;
`salvar`/`arvore` estendidos (diff por id); quebra do `PlanTecidoSheet` em `SubcolecaoList`/`CanvasSubcolecao` (sem
regredir `useUnsavedGuard`); tela de Coleções + breadcrumb clicável; lanes + chips + seleção múltipla + "Aplicar
categoria" + "+categoria"; Resumo à esquerda escopado (a comprar sem duplicar forro + pendências + PV gated) + trilho
colapsável. Card = `ModelCard` inline colapsável. *Arraste `@dnd-kit` como incremento — seleção é o caminho garantido.*
*Risco médio · esforço médio-alto.*

**Fase 2 — Pedido por categoria/subcoleção + OC por modelo.** `_subcolecao_id`/`_categoria_tecido_id DEFAULT NULL` na
prévia/pedido (diff-validado + teste txn); botões por lane/subcoleção/coleção com tooltip de bloqueio; wizard
paginado; auto-atribuição de OC ao slot; vincular OC existente. *Risco médio · esforço médio.*

**Fase 3 — Situação da OC + subsheet drill-down.** RPC nova de leitura (wrapper+`_core` revogado dos TRÊS; filtra
`tenant_id` no `_core`; validar `has_function_privilege`) sobre `ocs_tecido_itens`+`estoque_tecido_baixas`; Resumo
"por OC" + subsheet por tecido/variante; reserva viva (front). *Risco ALTO (invariantes #4/#9) · esforço médio.*

**Fase 4 — Refinos.** Custo tecido/forro separado; forro com grade própria (semântica nova; migrar D8); divergência
de cor (fluxo cor-primeiro no `MaterialBlock`); lock de consumo Dev; combinação paleta ∩ categoria; re-render
cirúrgico; acessibilidade; confirmações; DateField; `PageActionBar`. *Baixo-médio · sem banco (exceto forro).*

**Transversal (fora do Plan. Tecido):** extrair `<Breadcrumb>` clicável reutilizável e adotar aos poucos.

---

## 6. Componentes (novos/alterados)

- `criacao.plan-tecido.tsx` (lista de coleções — já existe; virar 1ª tela navegável).
- `PlanTecidoSheet.tsx` → `w-screen` + estado `view`; monta `SubcolecaoList` ou `CanvasSubcolecao`.
- **novos:** `SubcolecaoList`, `CanvasSubcolecao` (dono de seleção/DnD/dirty), `CategoriaSecao`+`CategoriaLane`,
  `FilterChips`, `ResumoRail`+`SubsheetDrilldown`, `PendenciasBlock`/`OcsVinculadasBlock`/`SituacaoOcBlock`,
  `VincularOcMenu`, `Breadcrumb` clicável.
- **reusar/estender:** `ModelCard` (card inline: grade-proporção fixa, OcVinculadaSelect, `MaterialBlock` c/
  DivergenciaCorAlert + consumo lock-Dev + cores/grade + AddCorMenu filtrado, `CustoSection` c/ AprovarMaoObra,
  rodapé Criar card/Aplicar ao modelo), `ResumoPanel`, `FazerPedidoWizard` (multi-OC paginado).
- `src/lib/plan-tecido/{calc,engine,types}.ts` (categoria por slot; forro com grade própria; necessidade por variante).

---

## 7. Riscos e invariantes (não regredir)

- **#3** diff incremental por id em `salvar` (categoria + materiais). **#1** parcelas: o pedido NÃO cria parcelas à
  mão (trigger em `ocs_tecido`). **#4** estoque: situação-da-OC é 100% leitura sobre `ocs_tecido_itens`+ledger; físico/
  previsto seguem via `plan_tecido_estoque` (core canônico). **#9** RPC nova = wrapper+`_core` revogado dos TRÊS +
  filtro de tenant no `_core`. **#12** custo respeita `custo_unitario_modelos`; plano fica em **estimativa**.
- **DnD + edição inline:** o card é arrastável E editável — cancelar `dragstart` iniciado sobre `select/input/summary/
  button/textarea` (o protótipo usa HTML5 drag; avaliar `@dnd-kit`).
- **Consumo compartilhado com Dev:** direção do sync (lock quando avançado) — risco de drift com o BOM.
- **"Aplicar ao modelo"/"Criar card":** staging (classe do "Importar dados"); impacto em REF automática (#11), OTB,
  contadores; guarda de sobrescrita.
- **Duplicatas de `categorias_tecido`** (FORRO/Forro) viram lanes distintas no "+categoria" — avisar o dono.
- **Forro multiplicador → grade própria** (C3): migração de semântica; recalcular necessidade em todos os pontos.

---

## 8. Fora de escopo (registro)
Limpeza/dedup de `categorias_tecido`; cadastro de tecido/fornecedor; regenerar `types.ts`; toggle de tema.
