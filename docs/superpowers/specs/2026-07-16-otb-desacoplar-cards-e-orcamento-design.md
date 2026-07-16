# OTB: desacoplar cards do Planejamento + orçamento de modelos — Design

**Data:** 2026-07-16
**Módulo:** `otb` (opt-in)
**Status:** aprovado no brainstorm (com ajustes); pronto para plano de implementação

---

## 1. Problema e objetivo

Hoje, confirmar uma coleção no OTB (`otb_confirmar` / `otb_confirmar_pv`) **cria
automaticamente** cards em branco no Planejamento, e o total do plano
(`colecao_semanas.qtd_planejada` / `colecao_pv_itens.qtd_semanas`) é mantido
**bidirecionalmente igual** à quantidade de cards pelo trigger `fn_otb_sync_semana`.
Resultado: "definido" e "cards" andam sempre juntos — não existe noção de
*progresso* nem de *divergência*.

O objetivo é transformar o OTB num **orçamento de modelos**: o plano vira um **alvo
fixo** e os cards do Planejamento são criados **manualmente**, contados **ao vivo**
contra o alvo. A tela mostra `realizado / total` (ex.: `10 / 100`), sinaliza quando
estoura, e ajuda o usuário a saber quantos ainda cabem em cada coleção/subcoleção/linha.

## 2. Decisões travadas (do brainstorm)

| Tema | Decisão |
|---|---|
| **Confirmar** | Deixa de **criar** cards. Passa a **apagar** os cards em branco "não tocados" (legado) e marcar `status='confirmada'`. Cards preenchidos (ou os de "Novos Cards", que já nascem com categoria) sobrevivem. |
| **Realizado** | `COUNT(modelos WHERE colecao_id = X)` — **todos os cards vinculados**, qualquer status (em_planejamento / reprovado / planejado). |
| **Total (alvo)** | O plano, **fixo**: PV = Σ `colecao_pv_itens.qtd_semanas`; Orçamento = Σ `colecao_semanas.qtd_planejada`. Definido só no editor do OTB. |
| **Fluxos** | PV **e** Orçamento. 3º nível: **Linha** (PV) / **Categoria** (Orçamento). Coleção e subcoleção nos dois. |
| **Divergência oficial** | `realizado > total` **no total da coleção**. Só coleções **confirmadas**. |
| **Sinal de dois tons** | Total da coleção estoura → **vermelho** (lista + card OTB + **bolinha vermelha no sidebar**). Subcoleção/linha/categoria estoura (mas coleção total cabe) → **âmbar** (dentro do card OTB, na linha da lista e nos **selecionáveis** do Planejamento). Âmbar **não** acende o sidebar. |
| **Sem bloqueio** | Criar além do limite é permitido; só sinaliza. |
| **Sync bidirecional** | **Removido**. O trigger `fn_otb_sync_semana`/`trg_otb_sync_semana` e a trava `app.otb_reconciling` saem. Reclassificar um card não mexe mais no plano. |

## 3. Confirmar (backend enxuto)

`otb_confirmar` e `otb_confirmar_pv` passam a:
1. **Apagar** os cards "não tocados" da coleção (predicado já existente: `nome=''`,
   `estilista_id`/`categoria_principal_id`/`linha_id`/… nulos, sem fotos/tecidos,
   `lancado=false`) — sem depender de bucket.
2. `UPDATE colecoes SET status='confirmada'`.

Sem `INSERT` de cards. Sem `app.otb_reconciling` (não há mais sync a proteger).
`DROP` de `trg_otb_sync_semana`, `fn_otb_sync_semana`, e do legado
`trg_otb_dec_semana`/`fn_otb_dec_semana_on_delete`. `otb_importar_colecoes` mantida
(vincula cards de texto a `colecao_id`); perde o guard de reconciling (inócuo).

## 4. Orçamento de modelos: total × realizado

- **Total (alvo fixo)** por coleção/subcoleção/nível-3, derivado do plano:
  - PV: por (subcoleção, linha) = Σ `qtd_semanas`; subcoleção = Σ das suas linhas;
    coleção = Σ das subcoleções.
  - Orçamento: por (subcoleção, semana) = `qtd_planejada`; por (subcoleção, categoria)
    = Σ `colecao_semana_categorias.qtd`; coleção = Σ.
- **Realizado (contagem viva)** = `COUNT(modelos)` agrupado por:
  - coleção: `colecao_id = X`;
  - subcoleção: `subcolecao = <nome>` (texto casado com `colecao_subcolecoes.nome`);
  - linha (PV): `linha_id = L` dentro da subcoleção;
  - categoria (Orçamento): `categoria_principal_id = C` dentro da subcoleção.
- Cards vinculados à coleção mas **sem** subcoleção reconhecida contam no total da
  coleção, não em nenhuma subcoleção (é um resíduo visível, não um erro).

## 5. Lista/card do OTB

- No lugar do "X/Y planejados" atual: **`realizado / total modelos`** (ex.: `10 / 100`).
- `realizado > total` (coleção) → número **vermelho** + rótulo "divergência".
- Card expandido mostra a árvore subcoleção → linha/categoria com `X/Y`; níveis
  estourados em **âmbar**. Se algum nível está âmbar mas a coleção cabe, a linha da
  lista ganha um marcador âmbar discreto (sem virar "divergência" oficial).
- Só coleções **confirmadas** entram nessa contagem.

## 6. Contadores ao criar (Planejamento)

- **Novo Modelo:** ao escolher coleção → `Resort 27 — 10/100`; ao escolher subcoleção
  → `Praia 3/30`; ao escolher linha/categoria → `Vestidos 2/10`. Mostra o **estado
  atual** (quantas vagas restam). Não bloqueia estourar.
- **Novos Cards (em massa):** abaixo do "total de cards criados", **resumo projetado**
  ("com esse planejamento: **20/100** nesta coleção, **3/10** nesta subcoleção"),
  recalculado conforme as quantidades mudam. Para o nível de subcoleção existir, o
  diálogo ganha um campo **Subcoleção** (hoje só tem coleção/semana/mês/ano + linhas
  de categoria×qtd). A projeção cobre **coleção** (sempre) + **subcoleção** (quando
  escolhida) + **categoria** por linha (Orçamento). Projeção por **linha (PV)** no
  bulk fica deferida — o diálogo não captura linha (ver §10).
- **Selecionáveis** (dropdowns de coleção/subcoleção/linha/categoria no Novo Modelo e
  Novos Cards): cada opção mostra `X/Y`; opções estouradas em âmbar. Um helper único
  de rótulo (`<OrcamentoLabel>` ou função) evita duplicar a lógica.

## 7. Sidebar

`sidebar_badges` (RPC) ganha `otb_divergencia` = nº de coleções **confirmadas** com
`realizado > total` (nível coleção). Se > 0, **bolinha vermelha** no item **OTB**.
Como o item OTB não tem subitens, incluir o dot também no ramo *sem-subs* do
`app-sidebar.tsx` (hoje o dot só é renderizado em itens com subitens).

## 8. Backend: RPC única (SSOT)

`otb_orcamento(_colecao_id uuid default null)` — SECURITY DEFINER, padrão
**wrapper + `_core`** (invariante #9: `REVOKE … FROM PUBLIC, anon, authenticated`),
gate `tenant_module_enabled('otb')`. Retorna, por coleção **confirmada** (todas se
`_colecao_id` nulo; senão só ela):

```jsonc
{
  "colecao_id": "…", "nome": "Resort 27", "tipo": "poder_venda",
  "total": 100, "realizado": 10, "diverge": false,
  "subcolecoes": [
    { "nome": "Praia", "total": 30, "realizado": 3, "over": false,
      "nivel3": [ { "id": "…", "label": "Vestidos", "total": 10, "realizado": 2, "over": false } ] }
  ]
}
```

Fonte única para: lista/card do OTB, contadores dos diálogos de criação, e o
`sidebar_badges.otb_divergencia` (que reusa a contagem de `diverge`). Um hook
`useOrcamentoColecao(colecaoId)` no front expõe isso aos diálogos.

Migration **destrutiva** (drop de trigger/função) em `BEGIN; … COMMIT;` +
idempotente (`IF EXISTS`). Regenerar `types.ts`. Aplicar com
`psql "$(cat /tmp/dburl.txt)" -f`.

## 9. Migração de dados

Coleções já confirmadas têm hoje `qtd` sincronizado com os cards, então nascem em
`realizado == total` (sem divergência). O dono reajusta o alvo no editor do OTB se
o plano pretendido era outro. Sem backfill automático.

## 10. Escopo / YAGNI

**v1 (este spec):**
- Confirmar enxuto + drop do sync; RPC `otb_orcamento`; lista/card com realizado/total
  e dois tons; contadores em Novo Modelo e Novos Cards + selecionáveis; sidebar dot.

**Fica pra depois:**
- Bloquear criação ao estourar.
- Divergência de subcoleção/linha no **sidebar** (hoje só o total da coleção).
- Projeção/criação por **linha (PV)** no "Novos Cards" (o diálogo é por categoria;
  precisaria capturar linha). v1: bulk projeta coleção + subcoleção + categoria.
- Selecionáveis com orçamento no `BulkEditDialog` e nos dropdowns inline do card
  (v1 foca Novo Modelo + Novos Cards).
- Histórico/relatório de divergências.

## 11. Invariantes e cuidados

- **Módulo `otb`**: tudo gated; sem o módulo, nada muda.
- **Multi-tenant/RLS** na RPC e nas leituras; sem vazamento cross-tenant.
- **Segurança RPC** (invariante #9): `_core` revogado de PUBLIC, anon **e** authenticated.
- **Remoção do sync**: revisar consumidores de `colecao_semanas.qtd_planejada` /
  `colecao_semana_categorias.qtd` — passam a ser **alvo fixo do editor**, não mais
  espelho dos cards. Conferir que nada depende do valor "espelhado".
- **CLAUDE.md + memória**: atualizar o bloco do OTB (o comportamento de sync
  bidirecional documentado deixa de valer) — papel do `docs-keeper`.
- Build + `npx tsc --noEmit | grep TS2304` antes de commit.
