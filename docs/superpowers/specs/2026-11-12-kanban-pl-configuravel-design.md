# Kanban das Etapas PL configurável — desenho (campanha)

> Desenho para aprovação do dono ANTES do plano. Ex-"Fluxo 3" do F6, destacado como frente própria
> por ser escala de campanha (comparável à F1/F2 do kanban automático do Desenvolvimento).

## Objetivo (pedido do dono, 12/nov)

Transformar o kanban das **Etapas PL** (PCP › Etapas) — hoje auto-avanço puro, 5 etapas fixas, 1 card
por bloco de serviço, só aparece pós-Explosão — num **kanban completo como o do Desenvolvimento**:
1 card por **produto**, colunas que a loja **cria/edita/remove/reordena**, **requisitos de entrada**
por etapa, **arraste** + **chave automático**, **estado persistido**. A **entrada** no quadro passa a
ser pela **peça teste** (o card aparece já na 1ª etapa ao ganhar peça teste, pré-Explosão).

## Estado atual (mapeado, read-only)

- Tela: `src/routes/_authenticated/pcp.etapas.tsx` → `EtapasBoard`. SEM drag-and-drop. A coluna é
  **derivada** no cliente a cada render (`etapaDoBloco`, `src/lib/pcp-etapas.ts`), **1 card por BLOCO**
  de `producao_terceirizados`. Config `tenant_config.pcp_etapas` = array `{key,label,ativa}` (só
  renomear/ativar; ordem e keys fixas no código). 5 etapas default: `peca_teste`, `separacao`,
  `retorno_grade`, `oficina`, `finalizacao` + coluna sintética `__finalizado__` (`modelos.lancado`).
- O card só existe com `cad.enviado_corte=true` (pós-Explosão).
- O motor do Dev (que vamos espelhar) tem **camada pura TS reusável** (`statusDerivado`/`destinoDrop`/
  `faltandoPara` em `kanban-auto.ts`, parametrizados por `KanbanAutoConfig`) e **camada SQL acoplada a
  `status_desenvolvimento`** (`kanban_mover`, `_kanban_cfg`, `_kanban_aplicar`, fila
  `kanban_recalculo_fila`, CONSTRAINT TRIGGER no COMMIT, `fn_kanban_status_guard`, enfileiradores,
  histórico `modelo_kanban_historico`, snapshot, `kanban_definir_automatico`/`trg_kanban_chave_protegida`).
  Essa camada SQL precisa ser **duplicada** para o PL (nada é parametrizável por "board" hoje).
- UI reusável quase direto: `RequisitosStatusButton` (editor de requisitos), `SortableListCard`
  (editor de colunas arrastável, `@dnd-kit`).
- A entrada por peça teste e o card-por-produto já têm base: `peca_teste_quadro` devolve 1 item por
  modelo com trilha de peça teste; "tem peça teste" = `EXISTS modelo_servico_mo JOIN
  categorias_terceirizado ON exige_peca_teste` (mesmo join do selo da lista que foi ao ar no 26º deploy).

## Decisões travadas (do dono, 12/nov)

1. **Grão:** 1 card por **produto/modelo** (serviços dentro do card). Alinha ao motor do Dev (por modelo).
2. **Remover peça teste pré-Explosão → card SAI do PL.**
3. **Chave automático: SIM, igual ao Dev.** Ligada: coluna COM requisito = automática (anda sozinho até
   a 1ª que falha), SEM requisito = manual (arrasta/fixa); Reprovado sempre manual. Desligada: tudo
   manual, requisitos só avisam na tela. **Reusa a mecânica exata do motor do Dev.**
4. **5 etapas atuais = padrão inicial editável** (renomear/reordenar/remover/adicionar). Ninguém perde.
5. **Entrada no PL pela PEÇA TESTE** (adicionada no Sheet do Dev OU Planejamento OU aba Serviços) → 1ª
   etapa "Peça Teste" (PRÉ-Explosão). Tudo configurável.
6. **Peça Teste → próxima etapa:** requisito PADRÃO = peça teste APROVADA + enviado à Explosão
   (afrouxável na config).
7. **Gate da aba Peça Teste (Serviços):** a loja configura a partir de qual etapa do PL a aba abre.
8. **Consolidação N serviços → etapa do card = a MENOS avançada** (o card espera todos; mostra o gargalo).
9. **Catálogo de condições PRÓPRIO do PL** (enxuto, de produção): `peca_teste_aprovada`,
   `enviado_a_servicos` (ex-enviado à Explosão), `materiais_separados`, `grade_cortada_retornou`,
   `oficina_entregue`, `cq_liberado`, `lancado`… (lista final na spec do catálogo). NÃO reusar as 39 do Dev.
10. **Auto + arraste convivem exatamente como no Dev.**
11. **"Enviar para PCP" (Explosão) → renomear rótulo para "Enviar a Serviços"** (mesma ação; só texto).
12. **Pós-Explosão o card vai para Serviços, mas isso é CONFIGURÁVEL** (a transição/ordem das etapas é
    parte da config do kanban PL; não é regra fixa).

## Arquitetura

### Banco (a maior parte — duplicar o motor, por "board PL")

- **Estado de posição:** `modelos.status_etapa_pl text` (a key da etapa; NULL = fora do PL) + histórico
  `modelo_etapa_pl_historico` (espelho de `modelo_kanban_historico`: `status`, `entrou_at`, `origem`,
  `lote_id`) para o Leadtime do PL.
- **Config por loja** (3 colunas novas em `tenant_config`, espelhando o Dev):
  - `etapas_pl_kanban` (array de labels, como `status_kanban` — ordem = ordem do board; keys derivadas).
  - `etapas_pl_requisitos` (mapa `{etapa_key: [cond_key]}`, como `kanban_requisitos`).
  - `etapas_pl_automatico` (boolean, como `kanban_automatico`; porta única = RPC `etapas_pl_definir_automatico`
    + gatilho protetor espelhando `trg_kanban_chave_protegida`).
  - `etapas_pl_aba_peca_teste_status` (a etapa a partir da qual a aba Peça Teste abre — decisão 7).
  - Todas entram na lista branca do `salvar_config_loja` (CAS por coluna) + `config-loja-colab.ts`.
- **Catálogo de condições PL** (decisão 9): novo `src/lib/etapas-pl-condicoes.ts` (type `CondicaoPL`,
  espelho do `kanban-condicoes.ts`) + avaliador SQL `avaliar_condicoes_etapas_pl`/`_core` (por modelo,
  mapa `{key:bool}`). As condições de produção (`materiais_separados`/`grade_cortada_retornou`/
  `oficina_entregue`) derivam dos blocos de serviço do modelo, **consolidando pela regra "menos
  avançada"** (decisão 8): a condição "oficina entregue" só é true se TODOS os blocos relevantes
  entregaram, etc. Anti-drift catálogo↔RPC (como o do Dev).
- **Motor duplicado** (acoplado a `status_etapa_pl`): `etapa_pl_mover(_modelo_id,_para)`,
  `_etapas_pl_cfg`, `_etapas_pl_aplicar`, fila `etapas_pl_recalculo_fila` + CONSTRAINT TRIGGER no COMMIT,
  `fn_etapas_pl_status_guard`, enfileiradores nas tabelas-fonte (serviços/CQ/modelos), snapshot/restaurar.
  **Derivação pura** `_etapas_pl_derivar_puro` = espelho de `statusDerivado` (reusa o TS puro, só com a
  config PL).
- **Entrada/saída pela peça teste** (decisões 2 e 5): um enfileirador/gatilho que, quando o modelo
  passa a ter trilha de peça teste (`modelo_servico_mo` + `exige_peca_teste`), seta `status_etapa_pl` na
  1ª etapa (se estava NULL e pré-Explosão); quando perde a última trilha pré-Explosão, volta a NULL
  (sai do PL). Pós-Explosão não sai (decisão 12; a permanência é configurável pelas etapas).
- Padrão da casa: migrations aditivas, idempotentes, md5 ANTES/DEPOIS, `_core` REVOKE dos 3, RAISE ASCII,
  rollback LIFO. **Migração** das 5 `pcp_etapas` atuais → `etapas_pl_kanban` (seed do padrão editável).

### Front

- **Board novo** `pcp.etapas.tsx`/`EtapasBoard`: ganha arraste (extrair/reusar o padrão do Dev —
  `criacao.desenvolvimento.tsx` tem o drag inline; avaliar extrair um componente compartilhado),
  colunas dinâmicas, selo de requisitos "Faltam X", "Mover para…", chave automático. Card por produto
  (base `peca_teste_quadro` estendida ou nova RPC de board).
- **Config da Loja:** editor de colunas (`SortableListCard`) + requisitos por etapa
  (`RequisitosStatusButton`) + switch automático + "a partir de qual etapa abre a aba Peça Teste".
- **Ajuste pequeno:** renomear "Enviar para PCP" → "Enviar a Serviços" no botão da Explosão (decisão 11).

## Ondas (implementação)

Dada a escala, implementar em ondas, cada uma testável/deployável:
1. **Onda 1 — banco base:** estado (`status_etapa_pl` + histórico), 3 configs novas + `salvar_config_loja`,
   catálogo PL + avaliador, migração das 5 etapas. Sem mudar a tela ainda (chave desligada = nada muda).
2. **Onda 2 — motor:** duplicar o motor (mover/cfg/aplicar/fila/trigger/guard/snapshot) + derivação pura +
   entrada/saída pela peça teste. Chave por loja.
3. **Onda 3 — front:** board novo (arraste + colunas dinâmicas + requisitos + automático), editor na
   Config, card por produto, renomear o botão.
4. **Onda 4 — migração/limpeza:** aposentar `etapaDoBloco`/1-card-por-bloco; gate configurável da aba
   Peça Teste; QA e deploy.

## O que NÃO entra

- Mudar o kanban do Desenvolvimento (só espelhamos o motor dele).
- Mudar a mecânica da peça teste em si (só o gatilho de entrada no PL a consome).

## Riscos / cuidados

- **Duplicar o motor** é a maior fonte de risco (fila + CONSTRAINT TRIGGER + guard + recursão). Espelhar
  fielmente o do Dev, com os mesmos cuidados (GUC de recursão, erro no recálculo nunca derruba o COMMIT).
- **Consolidação "menos avançada"** precisa de uma regra clara por condição (qual conjunto de blocos conta).
- **Entrada pela peça teste** muda QUANDO o card aparece (hoje pós-Explosão) — a migração precisa não
  "inundar" o PL com cards antigos de forma confusa; decidir o backfill no plano.
- Banco antes do site; cada onda com kit próprio.

## Verificação

- Anti-drift catálogo PL ↔ avaliador SQL (como o do Dev).
- Anti-drift `_etapas_pl_derivar_puro` ↔ `statusDerivado` (fixtures compartilhadas).
- Integração (cópia local, txn revertida): entrada pela peça teste; consolidação menos-avançada; chave
  automático liga/desliga; arraste manual com requisitos; guard; migração das 5 etapas.
- QA na prévia: montar colunas, ligar automático, mover card, abrir aba Peça Teste pela etapa configurada.
