# CAD dentro do Desenvolvimento (CAD extinto como tela) — Design

**Data:** 2026-07-17
**Módulos:** `criacao` (→ "Estilo & Engenharia") + `producao` (→ "PCP")
**Base de investigação:** `docs/superpowers/specs/2026-07-17-cad-no-desenvolvimento-impacto.md`
**Status:** aprovado no brainstorm (decisões abaixo); pronto para plano.

---

## 1. Objetivo
Extinguir o **CAD como tela separada**. O que era o CAD passa a viver dentro do fluxo de Estilo & Engenharia: o **cálculo de corte** vira uma seção do card de Desenvolvimento; a **baixa de estoque** vira uma tela nova chamada **"Explosão"**; as **fichas** (Corte/Técnica) são impressas do card; e o modelo vai **direto para Serviços**, sem o passo manual "Enviar ao CAD".

Chave da abordagem (decisão travada): **manter a entidade `cad` como encanamento invisível** — as tabelas `cad`/`cad_grades`/`cad_id` continuam (auto-criadas), então CQ/Direcionamento/custo/dashboards/corte seguem funcionando quase sem mudança de banco. **Zero refactor das ~9 FKs de `cad_id`.**

## 2. Decisões travadas (do brainstorm)
| Tema | Decisão |
|---|---|
| **Entidade `cad`** | Fica, invisível/automática (não a tela). Sem refactor de FK. |
| **Tela de CAD** | **Extinta** (rota removida). Suas funções se dividem entre o card e a tela "Explosão". |
| **Grade** | Definida 1× no card (**"7. Grade"**, planejada). Ao dar baixa (Explosão), vira **real** (semeada = grade cheia). **CQ pode ajustar a grade final por defeito** (Recebimento − Defeito). |
| **Seção "4. CAD" no card** | Só o **cálculo**: reflete o consumo de "3. Tecidos" → **folhas, tamanho da folha, metragem planejada**. NÃO repete grade, explosão de aviamentos/insumos nem partes do molde (já vivem em 3/5/6/7). |
| **"Quantidade a enviar"** | Sempre a **grade cheia** (não é lote parcial). Preenchida na tela **"Explosão"**. |
| **Botão "Enviar"** (card) | Substitui "Enviar ao CAD"/"Enviar ao corte". Faz o modelo aparecer na tela **"Explosão"** (não faz baixa ainda). |
| **Baixa de estoque** | Acontece na tela **"Explosão"**, quando a quantidade a enviar é confirmada (com déficit). |
| **Fluxo** | Desenvolvimento → **Enviar** → **Explosão** (qtd → baixa + grade real) → **Serviços** → CQ → Direcionamento → Lançar. Corte ANTES de Serviços. |
| **2º lote** | Conceito à parte (enviar para vender em outro lugar); não é lote parcial de corte. |
| **Sidebar** | "Criação" → **"Estilo & Engenharia"**; "Produção" → **"PCP"**; **Desenvolvimento continua "Desenvolvimento"**; **Consumo por OC** e **Explosão** ficam abaixo de Desenvolvimento (grupo Estilo & Engenharia). |
| **Fichas** | "Imprimir Ficha de Corte" e "Imprimir Ficha Técnica" no card de Desenvolvimento. |

## 3. Fluxo novo (com bastidores)
```
ESTILO & ENGENHARIA                         PCP
  Planejamento                               Serviços ─→ CQ ─→ Direcionamento ─→ Lançar
  Desenvolvimento (card)                       │(refina grade real por defeito)
    3.Tecidos(consumo) 4.CAD(cálculo)          │
    7.Grade  [Imprimir Fichas]  [Enviar] ──┐   │
  Explosão (nova) ←──────────────────────── ┘   │
    qtd a enviar → BAIXA + grade real ─────────→┘ (aparece em Serviços)
  Consumo por OC
```
**Bastidores (invisível):**
- **"Enviar"** (card) = `enviar_modelo_para_cad` automático → snapshot do BOM em `cad_*` (`cad_grades.grades_planejadas` = grade do card). Modelo fica "enviado" e aparece em **Explosão**.
- **Explosão** (confirmar qtd) = `baixar_estoque_tecido_corte(_cad_id)` (baixa atômica + `deficit[]`) **e** semeia `cad_grades.grades_reais` = grade cheia (a grade "vira real"). Modelo aparece em **Serviços**.
- **CQ** = como hoje, mas agora só **refina** `grades_reais` por defeito (o gate `cqLiberado` segue).
- **Direcionamento / custo real / dashboards / oficina / terceirizados** = lêem `cad_*`/`grades_reais` **sem mudança**.

## 4. Card de Desenvolvimento (nova estrutura)
Ordem das seções: `1. Informações · 2. Ajustes na Prova · 3. Tecidos · **4. CAD** · 5. Aviamentos · 6. Insumos · **7. Grade** · 8. Custos · 9. Anexos`.

- **4. CAD (nova seção — só cálculo):** lê o consumo de "3. Tecidos" e calcula **folhas** (nº de folhas), **tamanho da folha** (comprimento do encaixe) e **metragem planejada** por tecido/variante. Componentes: reaproveitar a lógica de `CadTecidosSection`/`useFichaData` (tamanho folha, metragem) sem re-digitar consumo. Read-mostly (deriva do BOM).
- **7. Grade:** inalterada (é a grade planejada; já editável, com proporção/auto — ver `ModeloGradeSection`).
- **Botões de impressão:** "Imprimir Ficha de Corte" + "Imprimir Ficha Técnica" — reaproveitar `FichaTecnica`, `CadFichaCorte`, `PrintFicha`, `PrintArea` (portal no body; já são agnósticos ao lugar). `useFichaData` ganha **fallback**: se ainda não há `cad` (antes do Enviar), lê `modelo_tecidos`/`modelo_aviamentos`/`modelo_etiquetas`; depois lê `cad_*`.
- **Botão "Enviar":** substitui "Enviar ao CAD". Chama `enviar_modelo_para_cad` (snapshot) e marca `enviado_cad=true` (o flag continua sendo o marcador). Modelo aparece em **Explosão**. Guardas atuais de "pode enviar" (aprovado + BOM completo + grade) permanecem.

## 5. Tela nova "Explosão" (abaixo de Desenvolvimento)
- Lista os modelos **enviados** (`enviado_cad=true` e ainda não cortados, i.e. `cad.enviado_corte=false`).
- Por modelo: mostra a **explosão** (tecido/aviamentos/insumos derivados da grade) e o campo **quantidade a enviar** (= grade cheia). Botão **"Dar baixa"** → `baixar_estoque_tecido_corte(_cad_id)`:
  - baixa atômica (Fase 1 por_oc + Fase 2 FIFO) + retorna **déficit**;
  - **semeia `cad_grades.grades_reais` = grade cheia** (a "grade vira real") — hoje isso já acontece na criação do CAD; aqui garantimos que sai da Explosão como real;
  - marca `cad.enviado_corte=true`.
- Depois da baixa, o modelo **aparece em Serviços**.
- É essencialmente a função de **corte** da antiga tela de CAD (metragem a enviar + enviar ao corte), agora dedicada. Reaproveita `CadTecidosSection` (metragem_enviada por variante) + a mutation de `baixar_estoque_tecido_corte`.
- **Rota:** `/criacao/explosao` (novo), permissão nova `criacao_explosao` (ou reusar `producao_cad`/gate — ver §8). Ícone próprio.

## 6. Sidebar (F1)
**Estrutura-alvo (do dono):**
```
Estilo & Engenharia          PCP
  Planejamento                 Serviços
  Desenvolvimento              Controle de Qualidade
  Explosão                     Direcionamento
  Consumo por OC               Lançamentos
```
**Verificado (sem pendência):** a lista de PCP (4 itens) está completa. **Oficina** já NÃO é item de sidebar — é acessada **dentro de Serviços** (`app-sidebar.tsx:95` comenta isso); as rotas `producao.oficina*` continuam existindo, só não aparecem no menu. **Alertas de Tecido** é do módulo **Entrada e Saída** (`/entrada-saida/alertas-tecido`), não de Produção. Então após extinguir CAD e mover Consumo por OC, os itens de sidebar de PCP são exatamente Serviços · CQ · Direcionamento · Lançamentos.

- **Renomear títulos de grupo** em `MODULE_META` (`src/components/app-sidebar.tsx:64-71`): `criacao.title` → "Estilo & Engenharia", `producao.title` → "PCP". ⚠️ O título final é `tabLabels[m.module] || MODULE_META...` — o override por-loja (`tabLabels`, do tenant_config) continua valendo; a mudança altera o **default**. Verificar que a loja-alvo não tem `tabLabels` fixando o nome antigo.
- **Consumo por OC** (hoje página do módulo `producao`, key `producao_consumo_oc`, url `/producao/consumo-oc`) passa a **renderizar no grupo Estilo & Engenharia, abaixo de Desenvolvimento**. ⚠️ **Não mudar o gate**: manter a permissão/gate como `producao` (a página é feature de produção). Fazer via **posicionamento no sidebar** (mover o item pro grupo criacao no build de `visibleMainItems`, mantendo o gate de módulo `producao` na filtragem), não movendo a permissão de módulo. Detalhe a resolver no plano.
- **Explosão** entra como novo item do grupo Estilo & Engenharia, abaixo de Desenvolvimento (e acima ou abaixo de Consumo por OC — ordem: Planejamento · Desenvolvimento · **Explosão** · **Consumo por OC**).

## 7. Fases (implementação incremental, cada fase é testável)
- **F1 — Sidebar (isolada):** renames (Criação→Estilo & Engenharia, Produção→PCP) + posicionar Consumo por OC abaixo de Desenvolvimento (sem mexer no gate). Baixo risco, valor imediato.
- **F2 — CAD no card + Explosão:**
  - Seção "4. CAD" (cálculo folhas/tamanho folha/metragem) no card.
  - Botões de impressão no card + `useFichaData` com fallback.
  - Botão "Enviar" (cria `cad` automático) no card; remove "Enviar ao CAD".
  - Nova tela "Explosão" (qtd a enviar → `baixar_estoque_tecido_corte` + semear `grades_reais`).
  - Garantir que a grade sai "real" da Explosão (semear `grades_reais` no corte, não só na criação do CAD).
  - **A tela de CAD antiga CONTINUA funcionando em paralelo durante F1+F2** — nada é removido; o novo fluxo (card + Explosão) roda **ao lado** do antigo até estar validado. Assim dá pra comparar/reverter sem perder nada.
- **F3 — Extinguir a tela de CAD (só após validar F2 em produção):** remover a rota `/producao/cad*` (redirecionar/404) e o item do sidebar; **manter as tabelas** `cad`/`cad_grades` e todas as RPCs. Ajustar links internos que apontam pra tela de CAD. **Reversível:** restaurar a rota + item = `git revert` da F3; dados intactos.

## 8. Invariantes e cuidados a preservar
- **Não quebrar as ~9 FKs de `cad_id`** (estoque_tecido_baixas NO ACTION, cad_grades, controle_qualidade, producao_terceirizados, producao_oficina, lancamentos, cad_tecidos/aviamentos/etiquetas). O `cad` continua existindo.
- **Invariante #4/#5 (estoque/ledger):** a baixa continua **só** via `baixar_estoque_tecido_corte` → `estoque_tecido_baixas` (ledger). `excluir_cad`/`reverter_corte` seguem com guarda NO ACTION.
- **Invariante #6 (grade real):** `grades_reais` continua em `cad_grades`; CQ segue sendo quem refina por defeito (`_salvar_cq_core`), e desmarcar reverte pra planejada. A mudança é **onde a grade real é semeada** (agora na Explosão/corte, garantindo que sai real de lá).
- **Invariante #10 (Direcionamento):** lê `grades_reais` autoritativa; trigger `trg_rebaixa_direcionamento_grade` inalterado.
- **Gate `cqLiberado`:** inalterado (Serviços→CQ→Direcionamento/Lançar seguem gateados).
- **Custo congelado (Fase B):** `cad_tecidos.custo_cad` via preço da OC — preservar no snapshot do "Enviar".
- **Permissões:** a nova tela "Explosão" precisa de permissão (nova `criacao_explosao` ou reuso); a tela de CAD extinta libera a permissão `producao_cad` (decidir manter p/ histórico ou migrar).
- **Impressão:** manter `PrintArea` em portal no body (senão sai torto pela sidebar).
- **Build + tsc** antes de commit; **migration** aplicada por `psql -f`; revisar embeds/RLS/queryKeys a cada mudança.

## 9. Pontos a resolver no plano (não bloqueiam o design)
- **`useFichaData` fallback** modelo_* ↔ cad_* (antes/depois do Enviar) — shape exato.
- **Posicionamento de Consumo por OC** no grupo criacao sem mudar o gate `producao` (mecânica no `app-sidebar`).
- **Permissão da tela Explosão** (nova vs reuso de `producao_cad`).
- **Semear `grades_reais` na Explosão**: ajustar `baixar_estoque_tecido_corte` (ou um wrapper) pra garantir `grades_reais` = grade cheia no corte (hoje a semeadura é na criação do CAD; validar que não duplica/conflita com o CQ).
- **Links internos** que apontam pra `/producao/cad` (Planejamento, dashboards, etc.) — redirecionar pro card/Explosão.

## 10. Reversão / Checkpoint (garantia de rollback)
Antes de qualquer código da migração, o estado atual foi **etiquetado** como ponto de reversão:
- **Tag:** `estavel-pre-cad-2026-07-17` (commit `55e7e85`) — sistema conhecido-bom com a **tela de CAD ainda ativa** e o fluxo antigo intacto. Reverter front por completo: `git reset --hard estavel-pre-cad-2026-07-17`.

**Por que a migração é reversível por construção:**
- **Banco aditivo/não-destrutivo:** as tabelas `cad`/`cad_grades` e as ~9 FKs de `cad_id` **NÃO são removidas** (encanamento). A migração só **adiciona** (ex.: garantir semeadura de `grades_reais` no corte, permissão da tela Explosão). Nada de `DROP` de tabela/coluna com dado. Migration em `BEGIN;…COMMIT;` idempotente.
- **Front em paralelo:** F1+F2 **não removem** a tela de CAD; o fluxo novo coexiste com o antigo. Dá pra desligar a Explosão/rollback do card e voltar a usar o CAD sem migrar dado.
- **F3 é a única remoção** e é puramente de UI (rota + item de sidebar). Reverter = `git revert` do commit da F3 (ou `git reset` pro checkpoint); os dados nunca saíram das tabelas `cad_*`.

**Regra:** só avançar pra F3 (extinguir a tela) **depois** de F2 validada em produção. Se algo der errado em F2, `git reset --hard estavel-pre-cad-2026-07-17` restaura o estado pré-migração (backend permanece compatível porque as tabelas ficaram).
