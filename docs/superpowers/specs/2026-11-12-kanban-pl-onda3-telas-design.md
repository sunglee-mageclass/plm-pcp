# Kanban das Etapas PL configurável — Onda 3 (telas + ajuste de entrada no motor) — Design

**Data:** 2026-11-12
**Frente:** Kanban das Etapas PL configurável (ex-F6 Fluxo 3). Campanha própria.
**Spec da campanha:** `docs/superpowers/specs/2026-11-12-kanban-pl-configuravel-design.md`
**Ondas anteriores:** Onda 1 (banco base) + Onda 2 (motor) — PRONTAS, revisadas, SHIP, inertes (chave off). Migrations `20261126100000`..`20261127150000`.
**Branch:** `feature/plan-tecido-a1`.

## Intenção (design brief, validado com o dono)

Dar a **carcaça** (telas) ao motor das Etapas PL, que hoje existe só no banco e é invisível. Sem as telas o dono não tem o que conferir. A Onda 3 transforma a tela atual de Etapas PL (board sem arraste, derivação por datas no cliente, 5 etapas fixas, vários cards por produto) num **kanban completo configurável**, espelhando o quadro do Desenvolvimento, mas **reaproveitando ao máximo** o que já existe.

**Decisões do dono (travadas nesta sessão):**
1. **1 card por PRODUTO** (não por bloco de serviço). Os blocos de serviço são o conteúdo, não cards separados.
2. **O card abre o Sheet de Serviços que já existe** (`TerceirizadosDetail` de PCP › Serviços). Zero editor novo. "Etapas PL" e "Serviços" são duas formas de ver a mesma coisa.
3. **Sem campos editáveis no card** — como o card abre o Sheet, nada se edita direto no card. O card é só visual.
4. **Etapa do card = misto** (automática/manual), igual ao Dev: coluna com requisito = automática; sem requisito = manual.
5. **A entrada vira requisito da 1ª coluna** (não um gatilho especial). A 1ª coluna é a porta de entrada configurável; o que faz o card entrar nela = cumprir os requisitos dela. A porta padrão = **ter um bloco de peça teste** (aprovado ou não).
6. **Config da Loja das Etapas PL = só** colunas (add/remover/renomear/reordenar) + requisitos por coluna + chave (liga/desliga com prévia e restaurar).

## Escopo

**DENTRO:**
- **A. Motor (banco):** substituir a entrada hard-coded pela entrada-via-requisito-da-1ª-coluna + condição nova `tem_peca_teste` no catálogo PL.
- **B. Libs de front** (espelho das do Dev, próprias do PL): leitura de config, derivação de selo, mover, prévia/chave, RPC wrappers.
- **C. Config da Loja:** bloco "Etapas PL" com colunas + requisitos + chave.
- **D. Board:** nova tela `/pcp/etapas` com arraste, selo, "Mover para…" mobile, abrindo o Sheet de Serviços.
- **E. Selo/filtro de etapa** onde fizer sentido (card do board; filtro de etapa).

**FORA (Onda 4 / depois):**
- Backfill de entrada (pôr no board os produtos que já têm peça teste/explosão antes de ligar) — Passo 0 da ida, item operacional.
- Gate configurável da aba Peça Teste por etapa (`etapas_pl_aba_peca_teste_status`) — existe no banco (Onda 1), mas a UI fica para a Onda 4.
- Limpeza da tela/libs antigas de Etapas PL (`pcp-etapas.ts` derivação por datas, `EtapasPlPanel` órfão).

## A. Motor (banco) — entrada vira requisito da 1ª coluna

### A.1 Condição nova `tem_peca_teste`

Hoje o catálogo PL tem `peca_teste_aprovada` = *"as trilhas de peça teste existentes estão aprovadas"* (vacuamente `true` sem trilha). A porta de entrada precisa de uma condição DIFERENTE: `tem_peca_teste` = *"existe ao menos um bloco de peça teste (aprovado ou não)"*.

- **SQL** (`avaliar_condicoes_etapas_pl`, migration nova): adicionar a key `tem_peca_teste` =
  `EXISTS (SELECT 1 FROM modelo_servico_mo pm JOIN categorias_terceirizado pc ON pc.id = pm.categoria_terceirizado_id AND pc.tenant_id = m.tenant_id AND pc.exige_peca_teste WHERE pm.modelo_id = m.id)`.
- **TS** (`src/lib/etapas-pl-condicoes.ts`): adicionar `{ key: "tem_peca_teste", label: "Tem peça teste", descricao: "Existe ao menos um bloco de peça teste (aprovado ou não)." }`.
- **Anti-drift** (`tests/integration/kanban-pl-condicoes.test.ts`): a key nova casa TS↔SQL.

O catálogo PL passa de 7 → 8 condições.

### A.2 Trocar o gatilho de entrada pela derivação normal

Hoje `fn_etapas_pl_entrada` (migration `20261127140000`) seta `status_etapa_pl` na 1ª etapa quando ganha trilha de peça teste, e tira quando perde (pré-Explosão). Com a entrada = requisito da 1ª coluna, isso vira redundante/conflitante com a derivação do motor.

**Decisão de design (a confirmar na revisão da spec — ver "Pontos a validar"):** a entrada passa a ser governada pelo MESMO mecanismo de derivação das outras colunas. Ou seja:
- Um produto está "no board" (`status_etapa_pl IS NOT NULL`) quando a derivação o coloca na 1ª coluna (cujos requisitos ele cumpre) ou além.
- A condição de entrada é a da 1ª coluna configurada (ex.: `tem_peca_teste`, ou `enviado_a_servicos`, ou ambas).

**Implicação:** hoje a elegibilidade PL é `status_etapa_pl IS NOT NULL` — o card só deriva se já está no board. Se a entrada vira requisito, precisa haver um caminho que coloque o card no board quando ele passa a cumprir o requisito da 1ª coluna, mesmo partindo de `NULL`. Duas opções:

- **(A2-i) Manter um gatilho de entrada, mas lendo a 1ª coluna** (não mais "peça teste" fixo): quando um evento-fonte muda (ganhou trilha de peça teste, foi à Explosão, etc.), reavaliar: se `status_etapa_pl IS NULL` e o produto cumpre o requisito da **1ª coluna**, entra na 1ª coluna (e a fila deriva daí para frente). Se está no board e deixa de cumprir QUALQUER requisito que o manteria no board (pré-Explosão), sai. Isso **reaproveita** `fn_etapas_pl_entrada`, trocando o predicado fixo pela avaliação da 1ª coluna via `avaliar_condicoes_etapas_pl` + requisitos configurados.
- **(A2-ii) Elegibilidade = "cumpre a 1ª coluna OU já está no board"**: muda `_etapas_pl_derivar_lote` para considerar elegível quem cumpre o requisito da 1ª coluna, mesmo com `status_etapa_pl NULL`. Mais invasivo no motor derivador.

**Recomendação:** **A2-i** — menos invasivo, reaproveita o gatilho existente, e mantém o derivador (Ondas 1/2, já revisado) intocado. O gatilho de entrada deixa de ter predicado fixo e passa a: *"se NULL e cumpre o requisito da 1ª coluna configurada → entra na 1ª coluna; se no board e a 1ª coluna exige algo que ele não cumpre mais E não está pós-Explosão → sai"*. A "saída pós-Explosão nunca sai" permanece.

Isto é um ajuste pontual numa função já existente (`fn_etapas_pl_entrada`) + o avaliador. Risco controlado; testes espelham os da Onda 2.

### A.3 Seed inicial

A Onda 1 semeia `etapas_pl_kanban` das `pcp_etapas` atuais (Peça Teste/Separação/Retorno de Grade/Oficina/Finalização). A entrada configurável NÃO muda o seed — a 1ª coluna semeada ("Peça Teste") simplesmente nasce SEM requisito, e a loja adiciona o requisito `tem_peca_teste` a ela quando configurar. **Ou** o seed já grava `etapas_pl_requisitos` da 1ª coluna com `tem_peca_teste` por padrão (decisão a confirmar — ver "Pontos a validar").

## B. Libs de front (espelho das do Dev)

Novas, próprias do PL, espelhando `kanban-auto*.ts`:
- **`src/lib/etapas-pl-config.ts`** — `lerEtapasPlConfig`, `boardEtapasPl`, `fluxoEtapasPl`, `reqsEtapasPl`, `colunaManualPl`, `derivarEtapaPl`, `destinoDropPl`, `faltandoParaPl`, `statusParaSeloPl`. Espelho PURO do SQL do PL (anti-drift com fixtures, como `kanban-auto.test.ts`). Reaproveita onde possível as puras já compartilhadas.
- **`src/lib/etapas-pl-ui.ts`** — `modoColunaPl`, `subtituloColunaPl`, `dropBloqueadoPl`, `notaMoverPlPara`, `toastDoMoverPl`, `etapaDoProduto` (selo), `etapaPlFiltroOpts`, `motorEtapasPlDisponivel`, `RPC_ETAPAS_PL` (contrato das RPCs).
- **`src/lib/etapas-pl-rpc.ts`** — wrappers: `etapasPlMover`, `etapasPlPreviaRecalculo` (se existir prévia de recálculo; senão reusa a da RPC `etapas_pl_definir_automatico`), `etapasPlDefinirAutomatico`, `etapasPlPreviaRestauracao`, `etapasPlRestaurar`.
- **`src/hooks/useEtapasPlConfig.ts`** — `useQuery(["tenant-etapas-pl", tenantId])` lendo `tenant_config` (select "*", como `useKanbanConfig`), devolve `{cfg, ligado, motorDisponivel, carregando, isError}`.

RPCs do banco já existem (Onda 2): `etapas_pl_mover`, `etapas_pl_definir_automatico`, `etapas_pl_previa_restauracao`, `etapas_pl_restaurar`, `avaliar_condicoes_etapas_pl`.

## C. Config da Loja — bloco "Etapas PL"

Substitui o `EtapasPLCard` atual (que só renomeia/ativa as 5 etapas fixas de `pcp_etapas`). Novo bloco espelhando o card "Status do Kanban" do Dev:
- **Colunas** (`etapas_pl_kanban`): `SortableListCard` reaproveitado (add/remover/renomear/reordenar). `data-colab-path="cfg:etapas_pl_kanban"`.
- **Requisitos por coluna** (`etapas_pl_requisitos`): `RequisitosStatusButton`/`RequisitosStatusDialog` reaproveitado, com o catálogo PL (`CONDICOES_PL`, 8 keys incl. `tem_peca_teste`) em vez do catálogo do Dev. A 1ª coluna mostra um rótulo "porta de entrada".
- **Chave** (`etapas_pl_automatico`): `KanbanAutomaticoBloco`/`KanbanChaveDialog` reaproveitado/adaptado, chamando `etapas_pl_definir_automatico` + `etapas_pl_previa_restauracao`/`etapas_pl_restaurar`. Prévia "N produtos vão mudar de etapa" ao ligar; restaurar ao desligar. Gate de board vazio (Onda 2): ligar com board vazio é recusado — a UI avisa.
- **Colaborativo:** `etapas_pl_*` entram em `COLUNAS_PAGINA`/`BLOCO_DA_COLUNA`/`BLOCO_DO_FOCO` de `config-loja-colab.ts` (já estão em `COLUNAS_PAGINA` e no tipo; faltam os mapas de bloco e a UI). Grava via `salvar_config_loja` (CAS por coluna) — exceto `etapas_pl_automatico`, que só muda pela RPC (ignorado via config, Onda 2).
- **Visibilidade:** bloco visível com `completo && producao && etapas_pl` (como o `EtapasPLCard` hoje).

## D. Board — `/pcp/etapas`

Nova versão de `pcp.etapas.tsx` + componentes. Espelha `criacao.desenvolvimento.tsx`:
- **Colunas** de `etapas_pl_kanban` (via `useEtapasPlConfig`), 1ª e última sempre visíveis, coluna terminal sintética "Finalizado" para `lancado=true`.
- **Cards** = 1 por produto. Lê `modelos` com `status_etapa_pl` + embeds necessários (foto, atraso de serviço, selo). Produto sem `status_etapa_pl` não aparece. Status órfão cai na 1ª coluna.
- **Arraste** HTML5 nativo (como o Dev) + **"Mover para…"** mobile (Select). Chama `etapas_pl_mover`. Com a chave desligada: a pessoa decide (mover direto); com a chave ligada: fixar/soltar + "Faltam X" no drop bloqueado.
- **Card abre o Sheet de Serviços** (`TerceirizadosDetail`) — reaproveitado, com `UnsavedChangesGuard`. (A tela atual já abre esse Sheet no card de bloco; agora é o clique do card-produto.)
- **Selo da etapa** no card (`etapaDoProduto`), badge de atraso (`ServicoAtrasoBadge`, já existe), foto (`ModeloResumoFoto`).
- **Filtros** (Coleção/Fornecedor/Origem/Status) + busca + recolher colunas/cards — reaproveitar o que a tela atual já tem.
- **Mobile:** mesmo padrão do board (Accordion ou SegmentedTabs — seguir o que o Dev usa para consistência).

## E. Selo/filtro de etapa

- Selo da etapa PL no card do board (via `etapaDoProduto` de `etapas-pl-ui.ts`).
- Filtro "Etapa" no board (multi-select, como o filtro de etapa do kanban do Planejamento).
- (Fora de escopo agora: selo PL no card do Planejamento/PA-PI — só se o dono pedir.)

## Arquitetura / isolamento

- **Libs puras** (`etapas-pl-config.ts`, `etapas-pl-ui.ts`) sem React — testáveis isoladamente, anti-drift com o SQL.
- **Hook** (`useEtapasPlConfig`) isola a leitura da config.
- **Board** quebrado em componentes próprios (`EtapasPlBoard`, card), não inline numa rota de 1400 linhas como o Dev — oportunidade de fazer melhor que o modelo (o Dev tem card/coluna inline; aqui componentizar).
- **Config:** reaproveita `SortableListCard`/`RequisitosStatusDialog`/`KanbanAutomaticoBloco` passando o catálogo e as RPCs do PL por prop — sem duplicar esses componentes.

## Dados / fluxo

1. Config grava `etapas_pl_kanban`/`etapas_pl_requisitos` via `salvar_config_loja`; `etapas_pl_automatico` via `etapas_pl_definir_automatico`.
2. Com a chave ligada, o motor (Ondas 1/2 + ajuste A) deriva `status_etapa_pl` dos produtos no COMMIT de cada evento-fonte.
3. O board lê `status_etapa_pl` + embeds e renderiza; mover chama `etapas_pl_mover`.
4. O card abre o Sheet de Serviços; salvar no Sheet dispara os eventos-fonte que re-derivam a etapa.

## Erros / bordas

- Board vazio + chave: ligar recusado (Onda 2); a UI mostra o aviso.
- Carga falha: banner "Tentar de novo" (padrão P-57), board travado.
- Produto sem CAD/sem bloco: aparece se cumpre o requisito da 1ª coluna; senão não aparece.
- Chave indeterminada (carregando): mover desabilitado até resolver.

## Testes

- **Motor (A):** anti-drift da condição `tem_peca_teste` (TS↔SQL); teste de entrada via requisito da 1ª coluna (cumpre → entra; deixa de cumprir pré-Explosão → sai; pós-Explosão não sai). Na cópia local, txn revertida.
- **Libs (B):** anti-drift `etapas-pl-config.ts` × SQL (fixtures compartilhadas, como `kanban-auto.test.ts`). Unit de `etapas-pl-ui.ts`.
- **Config/Board (C/D):** `npm run build` + `tsc --noEmit` + unit das libs puras. QA Playwright (localhost:5173): ligar a chave numa loja de teste, prévia, arraste bloqueado/permitido, mover, abrir o Sheet de Serviços, mobile.
- Nenhum DDL em produção; prévia (localhost:5190) antes do deploy.

## Deploy

- **Banco ANTES do site** (a condição `tem_peca_teste` e o ajuste da entrada são banco). A migration de A vai acumulada com as Ondas 1+2 (ou separada, se as 1+2 já foram ao ar). Inerte com a chave off.
- Ordem: migration A → site. Volta LIFO.
- **Passo 0 (antes de ligar numa loja):** rodar o reavaliador de entrada em lote para pôr no board os produtos que já cumprem o requisito da 1ª coluna (backfill). Item operacional, não da migration.
- QA real só quando a tela liga a chave numa loja de teste.

## Pontos a validar na revisão da spec (decisões finas abertas)

1. **A2-i vs A2-ii** (como a entrada entra no board): recomendo A2-i (reusar o gatilho, trocar o predicado pela 1ª coluna). Confirmar.
2. **Seed da 1ª coluna com requisito `tem_peca_teste` por padrão** (A3): a loja que não configurar nada tem a 1ª coluna já com a porta de entrada? Recomendo **sim** (seed grava `etapas_pl_requisitos[1ª] = ["tem_peca_teste"]`), para a tela funcionar out-of-the-box como hoje. Confirmar.
3. **Saída do board** quando a 1ª coluna deixa de ser cumprida pré-Explosão: manter a regra atual (sai → NULL) — confirmar que é o desejado com a entrada configurável.
