# Casar variantes — Fatia 2 (reserva pelo par casado + pares na Ficha Técnica) — Design

## Contexto
As Fatias 1 e Multi (já pushadas em `feature/plan-tecido-a1`) permitem casar variantes de um bloco complementar (Tecido 2/3, Forro, Entretela) com N variantes do Tecido 1 (`modelo_tecido_variantes.complementa_variante_ids uuid[]`, espelhado em `cad_tecido_variantes`). Até aqui o vínculo é PERSISTIDO e exibido, mas **não muda o cálculo de reserva** — o bloco complementar ainda reserva pela grade da sua PRÓPRIA posição (`ordem` → `variante_numero`), que é arbitrária.

## Decisões do dono (26/ago/2026)
- **Reserva do bloco complementar CASADO** passa a seguir as cores do Tecido 1 com que ele casa: consumo = `consumo × (1+loss%) × (Σ grade_total das variantes do Tecido 1 casadas) × multiplicador`. **SEM arredondamento** (mantém fracionado — o "ceil independente" que se discutiu antes está FORA de escopo).
- **N-pra-N**: quando o forro casa com várias cores do Tecido 1, soma as `grade_total` de TODAS as cores casadas.
- **Bloco complementar SEM casamento**: comportamento de HOJE intacto (grade da própria `ordem`). Zero regressão para modelos que usam forro sem casar.
- **Ficha Técnica**: mostrar os pares ("tecido x1, y3; ...").
- **NÃO** mexer no abate (baixa) — a baixa (`_baixar_estoque_tecido_corte_core`) usa `cad_tecido_variantes.metragem_enviada` (número congelado no CAD), não a grade. Fica fora desta fatia (o `metragem_enviada` do par seria um refinamento futuro).

## Fórmula atual (confirmada no banco)
`_estoque_tecido_core` → CTE `reserva_mod`:
```sql
SELECT mv.variante_tecido_id,
  SUM(consumo × (1+loss/100) × grade.gt × multiplicador) AS m
FROM modelo_tecido_variantes mv
JOIN modelo_tecidos mt ...
LEFT JOIN grade g ON g.modelo_id = mt.modelo_id AND g.variante_numero = mv.ordem   -- ← grade da PRÓPRIA ordem
GROUP BY mv.variante_tecido_id
```
`grade` CTE: `SUM(grade_total) por (modelo_id, variante_numero)`.
`grade_total` mapeia à variante por POSIÇÃO: `modelo_grades.variante_numero = modelo_tecido_variantes.ordem`. A grade é autorada contra as variantes do TECIDO 1 (numero 1). Para o Tecido 1, `mv.ordem` casa com a grade certa. Para blocos complementares, `mv.ordem` hoje aponta pra grade da posição — **é o que muda**.

Duplicada (deve espelhar): `detalhe_estoque_variante`.

## Arquitetura da mudança (reserva)
Substituir o `grade.gt` do bloco complementar CASADO pela soma das grades das variantes do Tecido 1 casadas. O `complementa_variante_ids` é um array de `variante_tecido_id` do Tecido 1; para chegar à grade, traduz cada id → a `ordem` da variante do Tecido 1 nesse modelo (`modelo_tecido_variantes` do bloco Tecido 1, `variante_tecido_id = <id>`), e soma `modelo_grades.grade_total` dessas `variante_numero`.

**Regra por linha `mv` de `modelo_tecido_variantes`:**
- Se `mv` é do Tecido 1 (bloco tipo `tecido`, numero 1) OU `complementa_variante_ids` é NULL/vazio → `gt = grade.gt(mv.ordem)` (COMO HOJE).
- Se `mv` é de bloco complementar E tem `complementa_variante_ids` → `gt = Σ grade_total das variantes do Tecido 1 cujo `variante_tecido_id` ∈ `complementa_variante_ids`` (via ordem do Tecido 1).

Isso é uma expressão `CASE` no `reserva_mod` (e espelhada em `detalhe_estoque_variante`). **Sem ceil.** Agrupamento final segue por `variante_tecido_id` (a variante do forro), inalterado.

⚠️ Sub-ponto: a soma das grades das cores casadas é POR MODELO (o `complementa_variante_ids` aponta variantes do Tecido 1 DAQUELE modelo). O join tem que amarrar por `mt.modelo_id` para não somar grade de outro modelo que use a mesma variante.

## Arquitetura da mudança (Ficha Técnica)
- `useFichaData.ts` (~:156-166): o mapping de `TecidoRow.variantes` passa a carregar `complementa_variante_ids` (o embed `cad_tecido_variantes(*)` já traz a coluna; falta propagar no map). Traduzir os ids para rótulos legíveis das variantes do Tecido 1 (mesma fonte de label das variantes).
- `MaterialTable` (`CadFichaCorte.tsx:62-106`): para uma variante de bloco complementar casada, mostrar ao lado do rótulo o(s) par(es) "casada com {Tecido 1 · cor}, ..." (mesma linguagem da grade no card). Afeta Ficha Técnica E Ficha de Corte (compartilham `MaterialTable`) — ok, os dois devem mostrar o par.

## Fora de escopo (registrado)
- Arredondamento (ceil) independente por tecido.
- `metragem_enviada` do par no abate (baixa) — continua pela posição/CAD.
- Bloco complementar sem casamento (intacto).

## Riscos
- Invariante #4: a fórmula de reserva é SSOT em `_estoque_tecido_core` mas DUPLICADA em `detalhe_estoque_variante` — a mudança tem que entrar nas DUAS idênticas, senão a tela de detalhe da variante diverge do estoque. Teste transacional deve comparar as duas.
- A tradução `complementa_variante_ids` (variante_tecido_id) → `ordem` do Tecido 1 → `grade_total` tem que ser POR MODELO e robusta a variante do Tecido 1 removida (id órfão no array → simplesmente não soma; sem erro).
- Modelo sem casamento e Tecido 1: número idêntico ao de hoje (byte-a-byte) — o teste tem que provar isso.
