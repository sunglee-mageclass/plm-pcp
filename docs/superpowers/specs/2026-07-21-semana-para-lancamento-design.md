# Semana → Lançamento (rótulos + lógica do OTB)

**Data:** 2026-07-21
**Tipo:** nomenclatura (UI) + mudança de lógica no OTB. **Sem alteração de banco.**

## Decisão de escopo (via leve)

Nada muda no banco. O valor `1..5` já é um ordinal — passa a significar
"ordinal do lançamento" em vez de "semana do calendário". **Todos os
identificadores internos ficam**: coluna `semana` (`modelos`, `colecao_semanas`,
`colecao_semana_categorias`), jsonb `qtd_semanas`/`datas_semanas`, array
`colecao_subcolecoes.semanas`, params `_semana`/`p_semana` das RPCs. Nenhuma
migration, nenhum types.ts, nenhuma janela de deploy.

Muda só (a) o que o usuário vê e (b) a lógica de lançamento do OTB.

## Nomenclatura (só rótulo, app inteiro)

- "Semana N" → "**Lançamento N**"
- "Sem N" (cabeçalho/estreito) → "**Lan N**"

Pontos: OTB PV (bulk "Não atribuídos", cabeçalhos da tabela de qtd, doc-comment),
OTB Orçamento (bulk "Não classificados", msg de erro, label "…por Lançamento"),
`BulkEditDialog`, Planejamento (filtro, card, form de edição, label de coluna),
Desenvolvimento (filtro), Lançamentos (filtro, card), Dashboard (filtros comercial
+ leadtime, `"Sem "+c` → `"Lan "+c`).

## Núcleo: lançamentos contíguos (`src/lib/lancamentos.ts`)

Helper puro + testes Vitest:

- `proximoLancamento(ordinais, max=5)` → menor ordinal livre em 1..max (append
  contíguo), ou `null` no teto.
- `removerLancamento(ordinais, alvo)` → `{ ordinais, remap }` renumerando os
  sobreviventes para contíguo 1..N-1; `remap: Map<oldOrdinal, newOrdinal>`.
- `normalizar(ordinais)` → conjunto possivelmente com buracos (dado antigo, ex.:
  [1,3,5]) para [1,2,3] + `remap`.
- `remapChaves(mapObj, remap)` → reindexa um `Record<string,T>` keyed por ordinal.

**Invariante:** dentro dos editores, ordinal = posição = número exibido. Na
**carga**, cada subcoleção é normalizada para contíguo (aplica `remap` aos mapas
de qtd/data/categoria). Persiste ordinal contíguo no Salvar (coluna `semana`
intacta).

**Caveat aceito:** em coleção **confirmada**, mexer nos lançamentos reembaralha os
buckets ao reconfirmar (pode recriar cards). Mesmo comportamento de editar o plano.

## Editor PV (`src/components/otb/ColecaoPVSheet.tsx`)

**Remove:** `semanaRange`, `dataDefault`, `rangeLabel`, `semanaDaData`,
`onDataChange` (bidirecional), `moverSemana`, o `<Sel>` "Semana N" por lançamento,
a prévia "dd/MM–dd/MM", o aviso "Defina Mês e Ano pra calcular as datas", e os
imports `startOfWeek`/`addWeeks`/`addDays`.

**Vira:** cada linha de lançamento = rótulo estático "Lançamento N" + `DateField`
(data livre; `defaultMonth`=mês/ano da coleção só como conveniência de abertura,
sem acoplamento) + remover (renumera contíguo via `removerLancamento`, remapeando
`datasSemanas` + `q` de cada linha). "+ Lançamento" acrescenta `proximoLancamento`.
Cabeçalhos da tabela de qtd "Sem N" → "Lan N". `dataSemana(s,w)` =
`datasSemanas[w] ?? ""` (sem default de calendário). Mês/Ano seguem como período da
coleção (não derivam mais datas). Carga aplica `normalizar`.

## Editor Orçamento (`src/components/otb/ColecaoSheet.tsx`)

`WeeksEditor` (checkbox Semana 1–5) → **`LancamentosEditor`** sequencial. Prop única
`value: { weeks, meta, cats }` + `onChange` (para renumerar os três mapas juntos).
Renderiza uma linha por lançamento ativo (1..N): "Lançamento N" + texto +
`DateField` + qtd + botão Categorias + remover. "+ Lançamento" acrescenta
`proximoLancamento`; remover usa `removerLancamento` + `remapChaves` nos três mapas.
Carga normaliza cada subcoleção (e o modo simples). Distribuição por categoria segue
por ordinal. Labels e msg de erro passam a "Lançamento".

## Fora de escopo

- Sem migration/rename de coluna/RPC/jsonb; sem types.ts.
- Dropdowns de bulk-assign continuam oferecendo 1–5 fixos (comportamento atual).
- Tela "Lançamentos" (produção, `modelos.lancado`) é outro conceito — intacta.

## Verificação

- `npm run build` + `npx tsc --noEmit` (TS2304) + `npm test` (helper novo).
- Conferência visual dos dois editores (sequencial, sem prévia de semana) e dos
  filtros/labels.
- **Time multi-agente** varre o projeto: todo "Semana"/"Sem N" virou
  "Lançamento"/"Lan N" E os identificadores internos foram preservados.
