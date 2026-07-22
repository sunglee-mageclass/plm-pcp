# Resumo do modelo (info + foto) nas telas de produção

**Data:** 2026-07-22
**Tipo:** UI — padronizar o resumo do modelo (Coleção/Subcoleção/Lançamento/Mês/Ano
+ foto) nos cards/headers das telas de produção. Sem migration.

## Motivação

Vários resumos de modelo não mostram período (Lançamento/Mês/Ano), subcoleção nem a
foto do modelo. Padronizar isso deixa o operador situado em cada etapa.

## Peças compartilhadas novas (`src/components/shared/`)

- **`ModeloResumoFoto`** — thumbnail da foto do modelo. Recebe `fontes` (hierarquia de
  capa `[fotos_modelo[0], desenho_tecnico_url, croqui_url]`), resolve a 1ª não-nula via
  `useSignedUrl(path, "modelos")`, mostra `<img>` ou um placeholder (ícone). Ignora PDF
  (placeholder). Tamanho via `className` (default `h-16 w-16`).
- **`ModeloResumoMeta`** — renderiza uma linha `Coleção · Subcoleção · Lançamento N ·
  Mês / Ano`. Props opcionais (`colecao`, `subcolecao`, `lancamento`, `mesNome`,
  `anoNome`); só entram as partes não-nulas. Cada tela passa o subconjunto que quer
  (evita duplicar o que já é exibido). Retorna `null` se nada.

Nomes de Mês/Ano: nas telas de detalhe vêm por **embed PostgREST** (`mes:mes_id(mes)`,
`ano:ano_id(ano)` — FKs confirmadas). No card do Desenvolvimento, resolvidos pelos
`meses`/`anos` já carregados no pai.

## Por tela

| Tela | Arquivo | Adiciona | Foto | Query |
|---|---|---|---|---|
| Desenvolvimento (card) | criacao.desenvolvimento (MobileCard/KanbanCard) | `ModeloResumoMeta` com Lançamento + Mês/Ano | já tem | sem mudança (resolve nome no pai) |
| Explosão (resumo) | producao/explosao/ExplosaoDetail | spans Subcoleção + Lançamento + Mês + Ano (grid existente) | — | `+ mes:mes_id(mes), ano:ano_id(ano)` |
| Serviços (resumo) | producao.terceirizados.$modeloId | `ModeloResumoFoto` + `ModeloResumoMeta` (Subcol·Lançamento·Mês/Ano; coleção já exibida) | sim | `+ subcolecao, semana, fotos_modelo, desenho_tecnico_url, croqui_url, mes/ano` |
| CQ (resumo) | producao.cq.$modeloId | idem | sim | idem |
| Direcionamento (resumo) | producao.direcionamento.$modeloId | idem (+ Subcoleção) | sim | idem |

Explosão não recebe foto (só os campos de texto), conforme pedido. Nos resumos de
Serviços/CQ/Direcionamento a **coleção já é exibida** na linha atual — o `ModeloResumoMeta`
acrescenta Subcoleção·Lançamento·Mês/Ano sem repetir.

## Fora de escopo

- Sem migration; identificador interno `semana` (rótulo "Lançamento") intacto.
- Não altero os layouts gerais dos headers — só injeto foto + linha de meta.

## Verificação

- `npm run build` + `npx tsc --noEmit`.
- Conferência visual das 5 telas (foto carrega/placeholder; meta com Lançamento N).
