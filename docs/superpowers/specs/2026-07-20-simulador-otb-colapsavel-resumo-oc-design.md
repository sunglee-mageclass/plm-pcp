# Simulador OTB — árvore colapsável + resumo de OC agregado

**Data:** 2026-07-20
**Componente:** `src/components/otb/SimulacaoSheet.tsx` (Simulador de Uso de OC) + `src/lib/simulacao.ts`

## Objetivo
Rolar uma árvore recolhível (subcoleção → linha) à esquerda com um **resumo de OC sempre à vista** à direita, que **soma o uso da mesma OC entre subcoleções** (por cor), pra responder "essa OC dá conta?".

## Modelo de dados (existente)
- `Cenario { id, nome, unidades: UnidadeSim[] }`
- `UnidadeSim { id, subcolecaoId, ocId, variantes: VarianteSim[] { ocItemId, ordem }, linhas: LinhaSim[] }`
- `LinhaSim { id, linhaId, profCor, modelos: ModeloSim[] { modeloId, consumo } }`
- OCs (`ocs`): `{ id, numero_pedido, itens: [{ id, quantidade_pedida, quantidade_recebida, artigo: { nome, unidade_medida, rendimento }, variante }] }`

## Cálculo (fiel ao existente)
- Demanda de uma unidade (mesma p/ toda cor): `demU = Σ linhas demandaLinha(profCor, 1, modelos.map(m=>m.consumo))`.
- Disponível de uma cor (item de OC): `metragemDisponivel(artigo.unidade_medida, item.quantidade_pedida, artigo.rendimento)`.
- Saldo por cor = disp − demanda; sobra (≥0) / falta (<0).

## Novidade 1 — `agregarUsoOC(unidades, ocs)` (puro, em `simulacao.ts`)
Agrega **entre subcoleções**, por OC e por cor (item):
```
demanda[(ocId, ocItemId)] = Σ (unidades u onde u.ocId=ocId e u escolheu ocItemId) demU(u)
```
Retorna, por OC usada:
```
{ ocId, numero, cores: [{ ocItemId, label, disp, dem, saldo }], totalDisp, totalDem, totalSaldo, ok }
```
- `disp` da cor = metragem do item da OC (fixo).
- `dem` da cor = soma acima (uso somado entre subcoleções).
- `ok` = todas as cores com saldo ≥ 0.
- Só inclui OCs efetivamente atribuídas a ≥1 unidade e cores efetivamente escolhidas.
Teste unitário: soma entre 2 subcoleções na mesma cor; cor compartilhada estoura; OC não usada não aparece.

## Novidade 2 — Layout 2 colunas
A área rolável do Sheet vira flex 2 colunas:
- **Esquerda** (`flex-1`, rola): a lista de subcoleções (árvore).
- **Direita** (desktop, `sticky top-0`, largura fixa ~18–20rem, scroll próprio): `<SimulacaoResumoOC>` — por OC, chip ✓/⚠ + total, e por cor: label, disp, dem, saldo + barrinha (mesma do resultado atual).
- **Mobile** (`max-md`): a coluna vira uma **faixa sticky no topo** (compacta: 1 linha por OC com ✓/⚠ e total; toque expande cores), pois lado a lado não cabe no Sheet full-width.

## Novidade 3 — Árvore colapsável (esquerda)
- Cada **subcoleção** (unidade) e cada **linha** viram `Collapsible` (`@/components/ui/collapsible`, Radix). Default **expandido**.
- Header da subcoleção (sempre visível): nome + OC atribuída + mini ✓/⚠ da subcoleção (derivado do seu resultado por cor). Chevron recolhe/expande.
- Header da linha: nome da linha + prof/cor + demanda; recolhe os modelos.
- O bloco de resultado por-cor que já existe por subcoleção **permanece** (detalhe local); o resumo à direita é a visão global agregada.

## Não-objetivos
- Não muda cálculo de demanda/disponível nem o schema/RPCs.
- Não muda "Aplicar no plano" nem a semântica de cores (variantes por subcoleção).
