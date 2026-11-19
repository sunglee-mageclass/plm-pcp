# Lote de demandas front (19/nov) — OC no Modo Plano, filtro sticky, base nasce 0, sigla na Grade

**Data:** 2026-11-19
**Frente:** 4 demandas front do dono, zero-banco, no mesmo deploy da navegação por teclado.
**Branch:** `feature/plan-tecido-a1`
**Tipo:** bounded × 4 — **ZERO migration, ZERO banco** (tudo reusa RPC/dados que já existem).

---

## Entendimento (confirmado com o dono, 19/nov)

Quatro mudanças de front, independentes entre si, todas front puro. Vão juntas numa branch para
ir num único `wrangler deploy` com a navegação por teclado (já aprovada).

### Demanda 1 — Modo Plano: inserir OC manualmente no produto
**Hoje:** o Modo Plano (`ModoPlanoView.tsx`) só MOSTRA as OCs auto-vinculadas (leitura, derivadas
de `slotOcMap`/`vinculoOcMap`); o `OcVinculadaDialog` é só visualização. O modo NÃO-plano
(`ModelCard.tsx`) já permite ADICIONAR OC à mão, via `SlotOcHint` (RPC `plan_tecido_set_slot_oc`) +
`pedirVinculo`.
**Quer:** expor no Modo Plano a MESMA inserção manual do modo não-plano — reusando `SlotOcHint`/o
mecanismo do `ModelCard` (mesma RPC `plan_tecido_set_slot_oc`, `onEnsureSaved` para garantir o slot
salvo antes do FK). Nenhum conceito novo, nenhuma RPC nova.
**Sucesso:** no Modo Plano, dá para adicionar uma OC a um produto como já se faz no modo normal; a
OC passa a aparecer junto das auto-vinculadas.

### Demanda 2 — Plan.Tecido: header de filtros sticky
**Hoje:** o bloco de filtros do Plan.Tecido (`criacao.plan-tecido.tsx`) rola junto com a página e
some.
**Quer:** o container de filtros fixo no topo ao rolar (`position: sticky; top: <abaixo do header
sticky existente>`), z-index acima do conteúdo, sem quebrar o scroll da lista. CSS/layout; nenhuma
mudança de lógica.
**Sucesso:** rolar a página mantém os filtros visíveis e usáveis a qualquer momento.

### Demanda 3 — Distribuir por loja: base nasce 0, auto só quando o total bate
**Hoje:** `DistribuirPorLojaDialog` PRÉ-PREENCHE a base a partir do Cadastro › Lojas sempre que não
há distribuição salva (`devePrePreencher = !temDistribuicao`; `aplicarConfigPorCor`/`baseDaCor`/
`aplicarBaseConfig` em `src/lib/distribuicao-produto.ts`). Ex.: todo "Day Chic" já nasce 96.
**Quer (regra confirmada):** a célula/base **nasce 0** (deixa de pré-preencher). Quando o usuário
digita o **total de uma cor**: SE esse total **for IGUAL** ao total cadastrado em Cadastro › Lojas
para aquela linha/cor (a soma da base cadastrada = `Σ baseDaCor(config, qtd)`), o sistema **aplica
a base automática** (reparte pelas lojas conforme o cadastro); SE for **diferente**, a base fica
**manual** (usuário distribui à mão, começando de 0). O cadastro de Lojas deixa de ser um total
imposto e passa a valer só como base quando o total digitado coincide.
**Desenho:** `devePrePreencher` deixa de pré-preencher na abertura (nasce 0). Nova função pura que,
dado o total digitado de uma cor e a config da linha, decide: total == total cadastrado → devolve a
base por loja (`baseDaCor`); senão → não mexe (manual). O dialog chama essa função no evento de
digitar o total da cor. Lógica pura em `distribuicao-produto.ts`, testável; o dialog só liga o
gatilho. A RPC de leitura (`loja_base_linha_ler`) não muda.
**Sucesso:** abrir o dialog mostra 0; digitar 96 (== cadastro) reparte automático; digitar 100 (≠)
deixa manual.

### Demanda 4 — Grade do Sheet: sigla na variante (SÓ na Grade)
**Hoje:** a seção Grade (`ModeloGradeSection.tsx`) recebe `tecido1Variantes` com `label` pronto,
montado em `ModeloDetailPanel.tsx` (query `tecido1VariantesLabels`, ~linha 1521). O label é
"NOME - COR - APELIDO" (via o rótulo de variante).
**Quer:** o label da Grade mostrar a SIGLA de cada cor entre parênteses: **"AMARELO (AM) - AMARELO
(019)"** (sigla da cor base + sigla do apelido). Sigla vem do cadastro de cor (a MESMA do SKU:
`cores.sigla` / `cores_apelido.sigla`). Cor **sem sigla** → `()` vazio.
**Desenho:** SÓ na Grade — NÃO mexer no `varianteLabel`/`labelVarianteRow` global (`src/lib/
variante.ts`), que é fonte única de dezenas de telas. Em vez disso: (a) a query
`tecido1VariantesLabels` passa a trazer a `sigla` da cor base e do apelido no embed; (b) um helper
novo (ex. `labelVarianteComSigla` em `src/lib/variante.ts`, SEPARADO, ou local do Dev) monta
"NOME (SIGLA) - APELIDO (SIGLA)", com `()` quando a sigla falta; (c) `tecido1VariantesLabels` usa
esse helper. Nenhuma outra tela muda.
**Sucesso:** na Grade do Sheet, cada variante aparece com a sigla ao lado da cor/apelido (ou `()`
quando não cadastrada); nenhuma outra tela de variante muda de texto.

## Restrições globais
- **ZERO migration, ZERO banco** nas 4. Reusam RPCs/dados existentes (`plan_tecido_set_slot_oc`,
  `loja_base_linha_ler`, embeds de cor).
- Demanda 4 NÃO altera `varianteLabel`/`labelVarianteRow` globais (fonte única) — helper separado.
- Demanda 3: a lógica de decisão é PURA e testável em `distribuicao-produto.ts`.
- Front: após imports, `npx tsc --noEmit | grep TS2304`; `npm run build`.

## Review Focus
- **Dem. 3, total digitado == cadastro mas com arredondamento:** a comparação "total bate" deve ser
  por igualdade do total (Σ), não célula a célula — testar total que casa e total que não casa.
- **Dem. 3, cor sem config no cadastro:** total digitado qualquer → sempre manual (não há base). Testar.
- **Dem. 4, cor sem sigla:** label sai "AMARELO () - AMARELO (019)" (parênteses vazios), não quebra. Testar o helper.
- **Dem. 1, slot não salvo:** adicionar OC exige `onEnsureSaved` antes (o slot precisa existir p/ o FK) — como no ModelCard.
- **Dem. 2, sticky sobre modal/scroll:** o filtro sticky não pode cobrir o conteúdo nem brigar com o header já sticky (z-index/top corretos).

## Arquivos (previstos)
- **Dem.1:** `src/components/plan-tecido/ModoPlanoView.tsx` (expor o adicionar manual) reusando
  `SlotOcHint`/`plan_tecido_set_slot_oc`. Confirmar o ponto de montagem (por produto/slot do grupo).
- **Dem.2:** `src/routes/_authenticated/criacao.plan-tecido.tsx` (sticky no container de filtros).
- **Dem.3:** `src/lib/distribuicao-produto.ts` (nova função pura + `devePrePreencher` não pré-preenche) + `src/components/plan-tecido/DistribuirPorLojaDialog.tsx` (liga o gatilho no total). Testes `tests/unit/distribuicao-produto*.test.ts`.
- **Dem.4:** `src/lib/variante.ts` (helper novo `labelVarianteComSigla`, sem tocar os existentes) + `src/components/desenvolvimento/ModeloDetailPanel.tsx` (query `tecido1VariantesLabels` traz sigla e usa o helper). Teste do helper.

## Riscos
1. **Dem.4 vazar para telas que não pediram** — mitigado: helper SEPARADO, só a query da Grade usa.
2. **Dem.3 mudar comportamento de quem já salvou** — `devePrePreencher` hoje congela cor já salva; a mudança é só na ABERTURA sem distribuição (nasce 0). Cor já distribuída fica intocada.
3. **Dem.1 duplicar OC / FK sem slot salvo** — reusar `onEnsureSaved` + a mesma RPC do ModelCard (idempotente por `_oc_ids`).
4. **Dem.2 quebrar o layout mobile** — conferir sticky no breakpoint pequeno (QA).
