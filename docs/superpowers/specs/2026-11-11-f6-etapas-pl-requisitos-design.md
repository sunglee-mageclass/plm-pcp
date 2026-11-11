# F6 — Etapas PL / Peça-teste / Serviços + Motor de requisitos configurável

> Desenho para aprovação do dono ANTES do plano. Frente ARQUITETURAL (risco alto no Bloco C).
> **Deploy ÚNICO no fim; trabalho EM PARTES (blocos A→B→C).** Spec única, blocos separados.

## Objetivo (pedido do dono, 11/nov)

Dar ao fluxo de Produção/Serviços a configurabilidade que o Desenvolvimento já tem, em torno de
dois eixos: (1) **a equipe de PCP trabalhar a Peça Teste sem entrar no Sheet do time de estilo**;
(2) **requisitos configuráveis por loja** — um motor único — para liberar o "Enviar à Explosão",
a entrada da aba Peça Teste e, por fim, as etapas do kanban de PL.

## Princípio central (travado com o dono)

**Um motor de requisitos só** — o do kanban do Desenvolvimento, ESTENDIDO, não um motor novo.
Reaproveita: o catálogo `src/lib/kanban-condicoes.ts` (type `Condicao`, ~40 keys), a RPC
`avaliar_condicoes_kanban(_ids uuid[])` (por modelo, já chamada em 5 pontos fora do board), o
helper puro `requisitosOk(requisitos, satisfeitas)`, o `RequisitosStatusDialog` (já
parametrizável), a condição `peca_teste_aprovada` (já existe, avaliável por modelo) e a RPC
própria `salvar_peca_teste`. O que é NOVO = só config por loja em `tenant_config` + fazer o gate
valer no banco + um Salvar próprio da aba.

## Estado atual (mapeado, read-only)

- **Parte 1 (M.O.→bloco de Serviço): JÁ FUNCIONA (R4).** `_servicos_da_mo_criar` cria o bloco com
  serviço (`categoria_terceirizado_id`) + fornecedor (`empresa_id`, se empresa `tipo='servico'` da
  loja) + preço (valor da M.O. aprovada; senão entra no aprovar via `_servico_mo_preencher_preco`).
  **Dono confirmou que já atende. FORA do escopo de código da F6.**
- **Peça Teste hoje:** seção `PecaTesteSecao.tsx` (componente CONTROLADO, props) no Sheet do
  Planejamento; hook `usePecaTeste.ts`; RPCs `peca_teste_modelo` (ler) / `salvar_peca_teste`
  (gravar, independente de `salvar_card_planejamento`, hoje acionada pelo Salvar do card);
  coluna no kanban de Etapas PL via `peca_teste_quadro`. NÃO existe na tela PCP › Serviços.
- **Enviar à Explosão hoje:** gate de ETAPA no banco (`_enviar_modelo_para_cad_core` recusa fora da
  etapa + reprovado); a LISTA de faltas (REF, nome, estilista, categoria, tecido, grade, datas) é
  **SÓ front** (`pendenciasEnvioExplosao`) — o banco NÃO verifica campos.
- **Kanban Etapas PL hoje:** quadro DERIVADO por campos do bloco (`etapaDoBloco` em `pcp-etapas.ts`),
  SEM arraste, SEM motor de requisitos. Config: `tenant_config.pcp_etapas` = renomear/ativar 5
  etapas FIXAS. Entrada da tela de Serviços: hardcoded `cad.enviado_corte=true` (saiu da Explosão).
- **Filtros do kanban Dev:** vários persistem por usuário (`useFilterState` + `useUiPrefs`); NÃO há
  filtro de "esconder colunas/etapas".

---

## BLOCO A — entregas rápidas, baixo risco

### A1. Aba "Peça Teste" em PCP › Serviços (mão dupla com o Sheet)

- **Toggle no topo de PCP › Serviços:** "Serviços | Peça Teste" (duas visões da mesma tela).
- A visão Peça Teste reaproveita `PecaTesteSecao` (componente de props) — a MESMA seção do Sheet.
- **Mão dupla (firme):** a aba e a seção do Sheet editam o MESMO dado (RPC `salvar_peca_teste` +
  trilha por modelo). Mexeu num, reflete no outro. NÃO são cópias. Edição simultânea = o padrão
  colaborativo que a peça teste JÁ tem (rev + P0409 + "outra pessoa salvou" + `mergePecaTeste`).
- **PCP EDITA** (fornecedor, datas saída/entrada, aprovar/reprovar) com a MESMA permissão de
  editar PCP › Serviços (`producao_terceirizados`). Não precisa de permissão nova.
- **Salvar próprio da aba:** a RPC `salvar_peca_teste` é independente; hoje é acionada pelo Salvar
  do card. A aba ganha um Salvar próprio que chama `salvar_peca_teste` direto (reusa
  `usePecaTeste`/`mergePecaTeste`), SEM salvar o card inteiro.
- **Gate de entrada SIMPLES por ora:** o mesmo de hoje da tela de Serviços (modelo que saiu da
  Explosão, `cad.enviado_corte`). O gate CONFIGURÁVEL chega no Bloco C (nasce com o motor PL).

### A2. Filtro de Etapas no kanban do Desenvolvimento

- Filtro NOVO "Etapas" na barra de filtros do Dev (`criacao.desenvolvimento.tsx`), MESMO padrão dos
  outros (`useFilterState` + `useUiPrefs`): individual, persiste como preferência do usuário.
- A pessoa marca quais etapas (colunas) quer ver. Etapa desmarcada = **some a coluna inteira** (com
  seus cards). Sem indicador de ocultas. Só-front + `user_ui_prefs` (já existe). Baixo risco.

### A3. Enter no Sheet de Explosão

- No Sheet de Explosão (`ExplosaoDetail.tsx` + `ExplosaoAviamentosSection`/`ExplosaoInsumosSection`):
  ao preencher um campo e apertar ENTER, o foco vai ao PRÓXIMO campo. Reusar o helper "Enter desce"
  que a F2 do Plan. Tecido já criou (procurar antes de escrever do zero). Só-front, pequeno.

---

## BLOCO B — requisitos configuráveis do "Enviar à Explosão" (risco médio)

- **Config por loja, ancorada num status do kanban do Dev, no editor que JÁ existe**
  (`RequisitosStatusDialog`). Nova chave em `tenant_config` (ex.: `explosao_requisitos` — lista de
  keys de condição, todas em E), seguindo o padrão de `kanban_requisitos` + a âncora de status
  (como `explosao_envio_status`/`ref_exibir_status` já fazem).
- **Vale NO BANCO (recusa de verdade) — decisão do dono.** `_enviar_modelo_para_cad_core` passa a
  chamar o avaliador (`_avaliar_condicoes_kanban_core`) e RECUSAR (RAISE ASCII) quando faltar
  requisito configurado. Hoje os campos mínimos são só front; isto os torna reais.
- **OPT-IN (config vazia = comportamento de hoje)** — mitiga o risco de travar cards em lojas que
  hoje enviam "no limite". Sem config nova, nada muda.
- **Peça teste obrigatória:** a condição `peca_teste_aprovada` (já existe no catálogo) entra como um
  requisito configurável do Explosão. Quando a loja usa peça teste (`categorias_terceirizado.
  exige_peca_teste`) e configura essa condição, o Enviar à Explosão exige a peça teste aprovada.
- **Front:** `pendenciasEnvioExplosao` passa a somar as condições configuradas (via o avaliador) à
  lista de hoje; o botão mostra "Para enviar, falta: …" incluindo as novas; a recusa do banco é
  traduzida em PT (`erro-mensagem.ts`, ASCII no RAISE).

---

## BLOCO C — kanban das Etapas PL configurável (risco ALTO, por último)

- **Objetivo:** dar ao kanban de Etapas PL a configurabilidade do Dev — requisitos de ENTRADA por
  etapa, configuráveis por loja, usando o MESMO motor (catálogo + avaliador + editor).
- **A entrada CONFIGURÁVEL da aba Peça Teste nasce aqui** (junto da config dos status do kanban PL):
  "a partir de qual etapa/status + quais campos mínimos" para abrir a aba Peça Teste em Serviços —
  substitui o gate simples do A1.
- **Mudança brusca aceita pelo dono:** o PL hoje é derivação pura; ganhar motor de requisitos é
  reescrita significativa (SQL + espelho TS + UI + anti-drift). Por isso é o último bloco, com spec
  detalhada própria quando chegar a vez (esta seção fixa o rumo; o detalhe fino do motor PL — se
  mantém auto-avanço, se ganha arraste, colunas reordenáveis — será decidido com o dono ANTES do
  código do Bloco C).
- **Config:** nova família em `tenant_config` para o kanban PL (ex.: `pcp_etapas_requisitos` por
  etapa), espelhando `kanban_requisitos`. Editor reusa `RequisitosStatusDialog`.
- ⚠️ **Decisões em aberto do Bloco C (a fechar com o dono antes do código):** (1) o PL mantém
  auto-avanço (derivado) com requisitos como "trava de entrada", ou ganha arraste como o Dev? (2)
  colunas do PL passam a ser reordenáveis/adicionáveis ou seguem as 5 fixas? (3) há "chave
  automático" por loja como no Dev? Esta spec NÃO decide isso — marca como pendência do Bloco C.

---

## Arquitetura técnica (comum aos blocos)

- **Motor reusado:** catálogo `kanban-condicoes.ts` (type `Condicao`); avaliador
  `avaliar_condicoes_kanban`/`_avaliar_condicoes_kanban_core` (por modelo, mapa `{key:bool}`); gate
  puro `requisitosOk`. Condição nova = key no catálogo + branch na RPC + anti-drift
  (`tests/integration/kanban-condicoes.test.ts` TRAVA se divergir) — fluxo já estabelecido.
- **Config nova por loja:** chaves em `tenant_config` (jsonb), lista de keys em E, + âncora de
  status onde fizer sentido. Editor = `RequisitosStatusDialog` (já parametrizável).
- **Gates no banco:** Explosão (Bloco B) e entrada da aba Peça Teste (Bloco C) chamam o avaliador no
  servidor e recusam com RAISE ASCII. Opt-in (config vazia = como hoje).
- **Peça Teste:** `salvar_peca_teste` (existe) + `usePecaTeste`/`mergePecaTeste` (existe) — a aba
  reusa, com Salvar próprio.

## O que NÃO entra

- Parte 1 (M.O.→bloco) — já no ar, nada a fazer.
- Motor novo paralelo — reusa o do Dev.
- O detalhe fino do motor do kanban PL (arraste/colunas/chave automático) — fica para o desenho
  próprio do Bloco C, antes do código dele.

## Riscos / cuidados

- **Anti-drift catálogo-TS ↔ RPC-SQL:** toda condição nova exige código nos dois lados; o teste
  trava. Mitigação: reusar condições existentes onde possível.
- **Gate do Explosão virar real no banco:** muda comportamento; pode travar cards que hoje passam.
  Mitigação: OPT-IN por loja (config vazia = como hoje); prévia na 5190 mede quantos cards travariam.
- **Bloco C é grande:** isolado por último, com desenho próprio antes do código.
- **RAISE 5xx só ASCII** nos gates do banco; **banco antes do site** (há RPC/coluna nova).

## Ordem de implementação — 3 fluxos, deploy único no fim (dono 11/nov)

O dono dividiu o trabalho em 3 FLUXOS independentes, que juntam num kit só ao final:
- **Fluxo 1 = Bloco A** (itens 2+3+4): aba Peça Teste + filtro de etapas do Dev + Enter no Explosão.
- **Fluxo 2 = Bloco B** (item 5): requisitos configuráveis do "Enviar à Explosão".
- **Fluxo 3 = Bloco C** (item 6): kanban das Etapas PL configurável — ISOLADO do restante.

Cada fluxo é implementado e revisado em separado (podem andar em paralelo onde não há arquivo em
comum). Juntam num kit único; **UM deploy** (banco antes do site), com prévia na 5190 antes.
O Fluxo 3 (Bloco C) tem seu próprio mini-desenho (arraste/colunas/chave automático) a fechar com o
dono ANTES do seu código, por ser o de maior risco.

## Verificação

- **Integração (cópia, txn revertida):** aba Peça Teste salva via `salvar_peca_teste` sem tocar o
  card; mão dupla reflete nos dois lados; gate do Explosão recusa no banco quando falta requisito
  configurado e PASSA com config vazia; peça teste obrigatória barra o envio.
- **Unit (TS):** filtro de etapas persiste/esconde coluna; Enter navega; `requisitosOk` com as novas
  keys; anti-drift catálogo↔RPC verde.
- **QA na prévia (5190):** toggle Serviços|Peça Teste; PCP edita e reflete no Sheet; filtro de
  etapas; Enter no Explosão; configurar requisito do Explosão e ver o botão travar; medir cards que
  travariam numa loja real.
- `npm run build` + `tsc --noEmit`; code-reviewer; guardião nos gates do banco.
