# Simulação de custo no card do Planejamento — Design

> Design aprovado (dono, 21/jul/2026). Escopo: detalhe do card em Planejamento
> (`src/routes/_authenticated/criacao.planejamento.tsx`).
> Terminal do brainstorming → próximo: writing-plans → implementação com teste.

## Objetivo

Dar ao usuário um **"e se?" de custo bem cedo no planejamento**, antes de existir
BOM/CAD real: ele digita valores previstos e vê um **custo estimado** e o **preço
que poderia ser** (custo × markup da linha), com uma mensagem clara de que **não é
o custo nem o preço real**.

## Onde

Nova seção **"Simulação de custo"** dentro do Dialog de detalhe do card, **logo após
Tecido Planejado** (revisão 21/jul: era a última; movida pra ficar abaixo dos seus
insumos — Linha e Tecido — e perto do Preço real). O detalhe abre ao clicar no card
(`setOpenId(m.id)` → Dialog).

Ordem final das seções: Informações Gerais → Coleção → Preço → Tecido Planejado →
**Simulação de custo** → Anexos → Lançamento → Produto Relacionado.

## Dados (persistidos por modelo)

Nova coluna `custo_simulado jsonb` em `modelos` (default `NULL`, tudo opcional):

```json
{
  "consumo_tecido": 1.35,   // metros — OVERRIDE manual (quando nulo, a tela usa o consumo real do BOM)
  "aviamento": 4.50,        // R$
  "mao_obra": 12.00         // R$
}
```

> **Refinamento (21/jul):** `preco_tecido_m` **não é gravado** — é derivado do Tecido
> Planejado mais caro. `consumo_tecido` guarda só o **override**; sem override, a tela
> puxa o consumo real do BOM ao vivo. O tipo `CustoSimInput` ainda carrega `preco_tecido_m`
> porque é parâmetro da função pura `custoSimulado` (o chamador resolve e passa).

- Migration aditiva (só adiciona a coluna; nada destrutivo).
- Sem RLS nova: é uma coluna de `modelos`, já isolada por tenant nas policies
  existentes. Salva pelo mesmo UPDATE INVOKER que o detalhe já faz (`save.mutate()`).
- Sem RPC nova.

## Cálculo (front, reusa `src/lib/preco.ts`)

Nova função **pura e testável** em `preco.ts`:

```ts
export type CustoSimInput = {
  consumo_tecido?: number | null;
  preco_tecido_m?: number | null;
  aviamento?: number | null;
  mao_obra?: number | null;
};

/** Custo estimado por peça: tecido (consumo × preço/m) + aviamento + mão de obra. */
export function custoSimulado(i: CustoSimInput): { tecido: number; total: number } {
  const consumo = Number(i.consumo_tecido) || 0;
  const precoM = Number(i.preco_tecido_m) || 0;
  const tecido = consumo > 0 && precoM > 0 ? consumo * precoM : 0;
  const total = tecido + (Number(i.aviamento) || 0) + (Number(i.mao_obra) || 0);
  return { tecido, total };
}
```

Preço estimado: reusa o `precoInfo` existente:

```ts
const { total: custoEst } = custoSimulado({ consumo_tecido: consumoUsado, preco_tecido_m: precoTecidoM, aviamento, mao_obra });
const pi = precoInfo(custoEst, markup, null); // markup = markup da linha, já em escopo
// pi.sugerido = custoEst × markup → arredonda 4,90/9,90 (0 se falta custo ou markup)
```

- markup = `linhas.markup` da linha do modelo (`draft.linha_id`) — **exibido read-only** na seção.
- Sem linha/markup ou sem custo → preço estimado exibe "—" + nota
  "defina a Linha pra ver o preço".

### Refinamentos do bloco de tecido (21/jul)

- **Preço/m = o Tecido Planejado MAIS CARO** (`max(artigos.preco_por_metro)` entre
  `draft.tecidos_planejados`). Read-only, derivado do cadastro — **não é digitado**. Mostra o
  nome do tecido escolhido. Sem tecido planejado → "—".
- **Consumo = override do usuário, senão o consumo REAL do BOM** (`modelo_tecidos.consumo`
  do artigo do tecido mais caro, `tipo='tecido'`), carregado por query nova
  `["modelo-tecidos-consumo", modeloId]`. Pré-preenche quando o modelo avançou; **editável**
  (o override persiste; limpar volta ao real). Legenda "do BOM — edite para simular".
- **Aviamento e mão de obra** seguem manuais (R$).
- **Markup da linha** aparece como campo read-only na linha de resultados.

## UI da seção

- **Banner** no topo (muted/aviso):
  > ⚠️ Estimativa — não é o custo nem o preço real (esses vêm do BOM/CAD).
- **Linha de campos** (grid 4), no grid padrão do detalhe:
  - Consumo de tecido (m) — input; pré-preenche do BOM (legenda), editável
  - Preço do tecido (R$/m) — **read-only** (tecido planejado mais caro; nome na legenda)
  - Aviamento (R$) — input manual
  - Mão de obra (R$) — input manual
- **Saídas read-only** (grid 4; `CampoRO`, `brl()` p/ moeda):
  - Custo do tecido (= consumo × preço/m)
  - **Markup da linha** (da linha selecionada)
  - **Custo estimado** (destaque)
  - **Preço estimado** (destaque; "—" se falta linha/markup/custo)
- Reatividade: recalcula ao digitar (deriva do `draft.custo_simulado`, sem estado
  extra). Persiste no `save.mutate()` junto com o resto do draft.

## Seções colapsáveis (aplica a TODAS as seções do detalhe)

O componente `Secao` (`{ titulo, children }`) passa a ser colapsável:

- Cabeçalho vira botão clicável com **chevron** (▼ aberto / ▶ fechado), mantendo o
  estilo atual (`text-sm font-semibold border-b`).
- `useState(true)` **por seção** — **expandida por default**; cada seção abre/fecha
  independente.
- **Não persiste** o estado aberto/fechado (reseta ao reabrir o card).
- Acessibilidade: `aria-expanded` no botão; conteúdo com `id` referenciado.
- Aplica automaticamente a todas as seções (Informações Gerais, Coleção, Preço,
  Tecido, Anexos, Lançamento, Produto Relacionado, Simulação).

## Isolamento (invariantes)

- A simulação é **display-only** na tela + persistência do input. **Não** altera
  `preco_venda`, `custo_unitario_modelos`, nem o poder de venda / resumos do
  Planejamento e Lançamentos.
- Nenhum cálculo de preço "real" lê `custo_simulado`.

## Fora de escopo (fases futuras)

- Poder de venda simulado (× grade) — o dono escolheu por-peça.
- Comparação estimado vs real / botão "puxar do real".
- Indicador da estimativa no card compacto do grid (fica só no detalhe).
- Persistir o estado colapsado das seções.

## Testes

- **Unidade (Vitest, `tests/unit/preco.test.ts`):** `custoSimulado` — tecido = consumo × preço/m; total soma
  aviamento + MO; zeros/nulos → 0; consumo sem preço (ou vice-versa) → tecido 0.
- **Migration:** aplica em txn (coluna adicionada, default NULL, nada quebra);
  round-trip de UPDATE do jsonb por um modelo do tenant.
- **Build/tsc:** `vite build` + `tsc --noEmit` limpos (grep TS2304 pós-imports).
- Persistência ponta-a-ponta e colapso: verificação manual (é update de coluna +
  estado de UI).

## Arquivos tocados

- `supabase/migrations/20260724100000_modelos_custo_simulado.sql` — nova coluna jsonb
  (numerada após a última existente, `20260723150000`).
- `src/lib/preco.ts` — `custoSimulado` + tipo `CustoSimInput`.
- `tests/unit/preco.test.ts` (novo) — testes de `custoSimulado`.
- `src/routes/_authenticated/criacao.planejamento.tsx` — `Secao` colapsável;
  campos `custo_simulado` no tipo `Modelo`/`draft`/select/UPDATE; nova seção.
- `src/integrations/supabase/types.ts` — regenerar (coluna nova em `modelos`).
