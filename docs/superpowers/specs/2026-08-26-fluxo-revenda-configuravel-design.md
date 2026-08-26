# Fluxo de Revenda configurável (por loja) — Design/Spec

## Contexto e problema
Produtos de origem **Revenda** (`modelos.origem='revenda'`, comprados prontos, feature Produto Acabado — invariante #13) passam pelo Planejamento, mas quando o usuário clica "Enviar Ordem de Criação" (botão SEM guard de revenda, `PlanejamentoDetail.tsx:1279-1295`) o card ganha `ordem_criacao_enviada=true` e **entra no kanban de Desenvolvimento**, onde **trava** no gate `cadMissing` (`ModeloDetailPanel.tsx:1496-1512`) que exige Tecido com variante, Grade, Data Desenho Técnico, Data Piloto — campos que revenda **nunca tem** (não se fabrica). E os requisitos de coluna (`kanban_requisitos`) podem exigir condições estruturalmente impossíveis p/ revenda (`tecido_com_variante`, `cad_preenchido`, `enviado_cad`, `grade_todas_variantes`, `servico_finalizado`, `grade_cortada_lancada`).

## Objetivo
Uma configuração de fluxo **própria da revenda**, por loja, em Config da Loja, com 3 eixos:
1. **Colunas do kanban** por onde a revenda passa (mesmas colunas do Desenvolvimento; subconjunto marcável). Coluna fora da lista = **bloqueada** p/ revenda.
2. **Requisitos** de entrada por coluna, próprios da revenda (mapa separado; reusa o catálogo e o dialog existentes; condições impossíveis p/ revenda aparecem esmaecidas "n/a revenda").
3. **Seções e campos** do sheet visíveis p/ revenda — granularidade por **seção inteira** E por **campo individual**. Desligado = some do sheet + **não exigido** em nenhum gate + **dado preservado** no banco.

O fluxo INTERNO (não-revenda) fica **byte-a-byte intocado** — toda a config nova só é lida quando `origem === "revenda"`.

## Decisões do dono (26/ago/2026)
- Config de revenda **SEPARADA** da normal (chaves próprias em `tenant_config`).
- Granularidade **por campo individual** + seções.
- **Tudo de uma vez** (configurável desde o início; sem fatia "fixo primeiro").
- Colunas: **mesmas** do Desenvolvimento, marca quais a revenda usa + requisitos próprios.
- Coluna fora da lista = **bloqueada** (revenda não entra).
- Campo desligado = não exige + **preserva** o dado.
- Item 1 (campo Origem no sheet + tag na lista) **já atendido** (fundo navy + Origem read-only) — fora desta spec.

## Modelo de dados (`tenant_config`, 3 chaves novas)
1. **`revenda_kanban_colunas: string[]`** — keys de colunas de `status_kanban` por onde a revenda passa. Vazio/ausente ⇒ **fallback: revenda usa TODAS as colunas** (não trava por omissão — mas sem a config, os requisitos podem travar; a UI incentiva configurar). Decisão: default = as colunas mínimas que o dono citou NÃO existem por key fixa (labels são livres por loja), então o default de fábrica é **[] = todas**, e a loja configura. Documentar isso.
2. **`revenda_kanban_requisitos: Record<colKey, condKey[]>`** — igual ao `kanban_requisitos`, próprio da revenda.
3. **`revenda_campos: Record<string, boolean>`** — visibilidade por chave. Chaves = **seções** (`s1, prova, s2, s-cad, s3, s3e, s4, s5, s6`) E **campos** (`modelista_id, piloteiro1_id, piloteiro2_id, piloteiro3_id, data_piloto1, data_piloto2, data_piloto3, data_desenho_tecnico, data_aprovacao`). Ausente ⇒ **default TRUE** (visível), EXCETO os 9 campos/seções que o dono listou, cujo **default de fábrica é FALSE** para revenda (semeados no DEFAULTS da Config): campos `modelista_id, piloteiro1/2/3_id, data_piloto1/2/3, data_desenho_tecnico, data_aprovacao` + seções `prova, s2, s-cad`. Nome é sempre obrigatório (não desligável).

**Sem migração de schema** — `tenant_config` é jsonb-friendly (as chaves ridem no payload existente do `save`, `configuracoes.tsx:224` spread). Precisa só semear os defaults na hidratação/`DEFAULTS`.

## Onde a config é LIDA (4 pontos, todos gated por `origem==='revenda'`)
1. **Sheet — seções (`ModeloDetailPanel.tsx`):** o `secOrdem` (`:1536-1540`, hoje `on:true` fixo) passa a: `on: isRevenda ? (revendaCampos[secKey] !== false) : <regra atual>`. Seção desligada some (e o `secNum` não conta, sem gap).
2. **Sheet — campos (`ModeloInfoSection.tsx`):** recebe `isRevenda` + `revendaCampos`; esconde `modelista_id/piloteiro*/data_*` quando `isRevenda && revendaCampos[campo]===false`. (O componente já recebe `origem`.)
3. **Gate de destrava (`cadMissing`, `:1496-1512`):** cada push condicional passa a checar se o campo/seção correspondente está ligado p/ revenda antes de exigir. Ex.: só exige "Data Desenho Técnico" se `!isRevenda || revendaCampos['data_desenho_tecnico']!==false`; só exige "tecido com variante"/"grade" se a seção `s2`/`s4` estiver ligada p/ revenda. Resultado: revenda flui.
4. **Kanban board + Select de status (`criacao.desenvolvimento.tsx` + `ModeloDetailPanel` status Select):** para card de revenda, as colunas permitidas = `revenda_kanban_colunas` (fora dela = bloqueada, mesmo esmaecer de falta-de-requisito); os requisitos de entrada vêm de `revenda_kanban_requisitos[col]` em vez de `kanban_requisitos[col]`. `podeEntrar`/`podeEntrarStatus` ganham o branch por origem.

## UI de Config da Loja (mockup aprovado — artifact `00ec5c95`)
Novo card **"Fluxo de Revenda"** em `admin/configuracoes.tsx`, **gated pelo módulo `produto_acabado`** (só aparece se ligado). 3 blocos:
- **Bloco 1 — Colunas:** lista das colunas de `status_kanban` (reordenável? NÃO — a ordem é a do board; aqui é só marcar), cada uma com toggle "revenda passa" (grava em `revenda_kanban_colunas`) + botão "Requisitos" (abre o `RequisitosStatusDialog` existente, gravando em `revenda_kanban_requisitos[col]`). No dialog, as condições impossíveis p/ revenda (`REVENDA_COND_NA` = `tecido_planejado, tecido_com_variante, grade_todas_variantes, cad_preenchido, enviado_cad, servico_finalizado, grade_cortada_lancada`) aparecem **esmaecidas + não selecionáveis** com tag "n/a revenda".
- **Bloco 2 — Seções + campos:** lista das 9 seções com toggle (grava `revenda_campos[secKey]`); a seção "1. Informações Básicas" expande os campos individuais (`modelista_id`…`data_aprovacao`) com toggle cada (grava `revenda_campos[campoKey]`). "Nome" travado ON (obrigatório sempre).
- Salvar = mesma mutation `save` (as 3 chaves ridem no payload).

## Fora de escopo
- Enforcement SERVER-SIDE dos requisitos de revenda (hoje `kanban_requisitos` é enforçado só no front; a spec mantém a paridade — front-only, como o normal).
- Mudar `origem` no sheet (é read-only; revenda tem estrutura própria; fora).
- Guard de revenda no botão "Enviar Ordem de Criação" (não pedido; o fluxo de config destrava sem precisar).
- Campos individuais em seções ALÉM de Info Básicas (só Info Básicas tem campos configuráveis; as outras seções são liga/desliga inteiras — decisão implícita do dono, os campos listados são todos de Info Básicas).

## Riscos
- **`secOrdem` byte-a-byte p/ não-revenda:** o branch `isRevenda ? ... : <hoje>` tem que preservar EXATAMENTE a regra atual (ex.: `s5` gated por custos). Teste: modelo não-revenda = seções idênticas.
- **`cadMissing`:** afrouxar p/ revenda sem afrouxar p/ interno. Cada push ganha guard; interno intocado.
- **Fallback de config vazia:** loja que não configurou revenda — as colunas default = todas, campos default = os 9 desligados de fábrica. Sem trava por omissão.
- **Catálogo de condições:** `REVENDA_COND_NA` é derivado (as condições que revenda nunca satisfaz). Manter alinhado ao `CONDICOES`/RPC (anti-drift já existe p/ o catálogo; a lista NA é uma const nova a documentar).
- **Colunas por label:** `status_kanban` guarda LABELS; `normalizeKanbanStatuses` resolve p/ keys. `revenda_kanban_colunas` guarda KEYS (estáveis). A UI mostra labels, grava keys.
