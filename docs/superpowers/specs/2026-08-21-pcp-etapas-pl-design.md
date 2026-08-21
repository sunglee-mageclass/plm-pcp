# Etapas PL — design (Feature A / S1)

**Data:** 2026-08-21 · **Branch:** `feature/plan-tecido-a1` · **Mockup aprovado:** artifact `c23f3674` (Navy Trust v3)

Kanban de produção **PL** que se move sozinho pelo preenchimento de campos, + um bloco
adicional de "Etapas PL" dentro do sheet do PCP Serviços que já existe. Duas superfícies,
uma fonte de dado, sempre em sync.

---

## 1. Contexto & objetivo

Produção **PL** (private label = a peça é feita inteira por um fornecedor externo) passa por
um ciclo — peça teste → separação de materiais → retorno da grade de corte → oficina →
finalização. Hoje isso não é rastreado como etapas; o serviço PL é só um bloco em
`producao_terceirizados`. A feature dá **visibilidade de pipeline** (kanban) e **edição no
lugar onde já se trabalha** (o sheet do PCP), sem obrigar o usuário a trocar de tela.

## 2. Definições

- **Serviço PL** = bloco `producao_terceirizados` cuja **categoria é "PL"** (nome, via
  `isServicoPL`/`categorias_terceirizado.nome` token `pl`) **E** `interno = false` (externo).
  As duas condições juntas (decisão do dono). Não confundir com o toggle "Interno/PL" isolado.
- **Card do kanban / linha de etapa** = **um bloco de serviço PL** (`producao_terceirizados.id`,
  `interno=false`, categoria PL, `ativo=true`), do modelo que já foi enviado ao corte
  (`cad.enviado_corte=true`). Um modelo pode ter mais de um bloco PL (tentativas/ fornecedores);
  cada bloco é um card.

## 3. As 2 superfícies (uma fonte de dado)

1. **Tela nova — Etapas (kanban PL)** (`/pcp/etapas`): panorama das PLs ativas nas 5 etapas.
   Card permite **edição rápida** do campo que faz avançar; `↗` abre o **mesmo sheet do PCP
   Serviços como overlay**. É opt-in (nem toda loja usa PL).
2. **Bloco PL no sheet do PCP Serviços** (`/pcp/servicos/$modeloId`, existente): quando o modelo
   tem um bloco PL, o bloco ganha os campos adicionais das etapas + as reprovadas colapsadas.
   **É a superfície de edição completa.**

Ambas gravam via a MESMA RPC (`salvar_terceirizados`) no MESMO bloco → sempre em sync. Quick-edit
no kanban = gravar no bloco = refletir no sheet, e vice-versa.

## 4. Modelo de etapas — DERIVADO (não arrastável)

A etapa de um card é **calculada** do preenchimento dos campos do bloco (padrão `computeStatus`),
não é uma coluna guardada/arrastável. Sem drift, sem override manual. Helper puro
`src/lib/pcp-etapas.ts` (`etapaDoBloco(bloco, etapasAtivas)`) espelhado por um helper SQL para
os consumidores servidor.

**5 etapas (rótulos renomeáveis por loja; gatilho FIXO):**

| # | Etapa (default) | Completa / avança quando | Fonte do dado |
|---|---|---|---|
| 1 | Peça Teste | Data Saída **+** Data Entrada **+** Aprovação = **Aprovado** | 3 campos NOVOS no bloco |
| 2 | Separação de Materiais | **Data Enviado** preenchida | `data_enviado` (JÁ existe — decisão a) |
| 3 | Retorno de Grade de Corte | Grade Cortada retornada (`grade_detalhe.cortada > 0`) | Grade Cortada (invariante #6) |
| 4 | Oficina | **Data Entregue** + `qtd_recebida > 0` | `data_entregue`/recebida (JÁ existem) |
| 5 | Finalização | terminal — só visual, sem trava | — |

**Campos NOVOS no bloco** = só os da Peça Teste (`pt_data_saida`, `pt_data_entrada`,
`pt_aprovacao`), + NF (S4) e Peça de Foto (S5). Etapas 2/3/4 **reusam** campos existentes.

**Reprovadas:** peça teste com `pt_aprovacao='reprovado'` → o bloco **fica parado na etapa 1** e
**NÃO aparece no kanban**. Vive só no colapsável "PLs reprovadas na peça teste" no rodapé do
bloco PL, dentro do sheet (por data de saída). Nova data de saída reabre o fluxo.

**Etapas ligáveis por loja:** cada etapa tem um flag `ativa` na config. Etapa desativada some do
quadro e o avanço a **pula** (ex.: corte interno → etapa 3 off → card vai de 2 direto p/ 4).

## 5. Config da Loja

- **Toggle de módulo próprio** `etapas_pl` (opt-in, default OFF), padrão dos toggles de módulo
  (super_admin, por loja) — liga a tela `/pcp/etapas` E o bloco de etapas no sheet.
- **Etapas do kanban PL** (`tenant_config.pcp_etapas` jsonb): lista ordenada FIXA de 5 itens
  `{key, label, ativa}` — `label` renomeável, `ativa` liga/desliga, `key`/ordem/gatilho fixos.
  Reusa o padrão `SortableListCard` só p/ renomear + o toggle `ativa` por linha. Sem reordenar/
  adicionar (gatilho é amarrado ao dado).

## 6. Superfície A — bloco PL no sheet (fidelidade + adicional)

O sheet existente (`pcp.servicos.$modeloId.tsx`) é preservado inteiro (ver check de fidelidade no
mockup: ColabBanner, resumo com MO por serviço, Interno/PL toggle, SLA/Status/Remover por bloco,
destrinchar, grade de 4 métricas, Obs. do Molde, Obs. do modelo, rodapé Voltar/Voltar-uma-etapa/
Salvar, imprimíveis no topo). **Adições no bloco PL:**

- **Toggle "Peça de foto"** ao lado do toggle Interno/PL (S5) + campo **Data de entrega da peça de
  foto** (quando ligado).
- **"Prazo de Pagamento"** (vindo do fornecedor, S2) **substitui** o campo "Nº de parcelas".
- Painel **"Etapas PL"** (adicional, destacado): Peça Teste (Data saída, Data entrada, Aprovação
  dropdown Aprovado/Reprovado); nota de que etapa 2 = Data Enviado (acima), 3 = Grade Cortada,
  4 = Data Entregue+Recebida; **NF de Saída/Entrada** (S4, anexo img/PDF com lupa).
- **Colapsável "PLs reprovadas na peça teste"** no rodapé do bloco.

**Somas travadas (read-only, decisão do dono):** `Qtd Enviada`, `Qtd Cortada`, `Qtd Recebida`,
`Qtd Defeito`, `Saldo a receber`, `Custo Total` = derivados da grade destrinchada (célula é a
fonte editável). Hoje já são Σ quando `detalhado`; travar a exibição/edição quando destrinchado.

## 7. Superfície B — tela Etapas (kanban)

Padrão de layout do Planejamento (real): **header** (ícone + título "Etapas — Produção PL" +
busca com lupa + `FilterButton` + botões **Recolher colunas/cards** na MESMA linha) + **linha de
resumo** embaixo (stats à esq., "Ordenar por" à dir.).

- **Colapso lateral das colunas** igual ao Desenvolvimento (`w-80` ↔ rail `w-9` com título
  vertical `[writing-mode:vertical-rl] rotate-180` + dot + contador; header-bar e rail são
  toggles; "Recolher/expandir colunas" global).
- **Cards colapsáveis/minimizáveis** (botão por card + "Recolher cards" global).
- **Foto do produto** no card (fontes `fotos_modelo[0]`→`desenho_tecnico_url`→`croqui_url`),
  **clique = zoom** (lightbox `ImagePreview`).
- **Edição rápida** no card do campo que faz avançar (datas, Aprovar/Reprovar) — grava no bloco
  via `salvar_terceirizados` (sync com o sheet).
- **`↗`** abre o sheet do PCP Serviços **como overlay** (Sheet) na própria tela, sem navegar.
- Só entram cards das PLs **ativas** (reprovadas ficam só no sheet).

## 8. Nav + hub PCP + correção do título

`/pcp` hoje **redireciona direto** p/ `/pcp/servicos` → por isso o título aparece "Serviços". Com
a 2ª página (Etapas), PCP vira **hub** de verdade:

- `pcp.index.tsx`: em vez de `redirect` p/ servicos, renderiza o **SectionHub "PCP"** (título
  "PCP") com cards Serviços + Etapas (CAD/Oficina seguem como sub-rotas). Resolve o título.
- `nav.ts PAGE_URLS`: **adicionar** `producao_terceirizados: "/pcp/servicos"` (hoje fica FORA de
  propósito, o que o mantinha como base) + `producao_etapas: "/pcp/etapas"`. Ícones/badges idem.
- `permissions-catalog.ts`: novo `PageDef { key:"producao_etapas", label:"Etapas", gate:"etapas_pl" }`
  dentro do módulo `pcp` (gate `producao`). A key entra em `ALL_PAGE_KEYS`.
- Rota nova `pcp.etapas.*` sob `pcp.tsx` (`ModuleGuard producao`), gated por `etapas_pl`.

## 9. Modelo de dados (migrations)

Colunas NOVAS em `producao_terceirizados` (todas nullable, não quebram o legado):
- `pt_data_saida date`, `pt_data_entrada date`, `pt_aprovacao text CHECK in ('aprovado','reprovado')`.
- `nf_saida_url text`, `nf_entrada_url text` (S4).
- `peca_foto boolean default false`, `peca_foto_data date` (S5).

`tenant_config`:
- `modules.etapas_pl` (toggle de módulo, default OFF — override em `useTenantModules.DEFAULTS` E
  `admin/lojas.tsx MODULE_DEFAULTS`, padrão `otb`).
- `pcp_etapas jsonb` (5 itens `{key,label,ativa}`; default = os 5 rótulos, todas ativas).

`empresas` (S2): `prazo_pagamento text` (máscara "30/60/90" das OCs). Reflete na lista de
fornecedores e no bloco PL (substitui Nº de parcelas).

`parcelas_servico` (S3): geradas por prazo a partir da **Data Entregue** (`data_entregue +
dias[i]`), netando as pagas — espelhar `_recalcular_parcelas_core`/`gerar_parcelas_oc_p_acabado`
(invariante #13), NÃO o `recalcular_parcelas` antigo.

`salvar_terceirizados`: estender p/ gravar os campos novos (a RPC já é o único writer do bloco;
grava jsonb/escalares opacos). Guarda de concorrência `rev` por bloco inalterada.

## 10. Sync, concorrência e segurança

- **Sync** kanban ↔ sheet: mesma RPC `salvar_terceirizados`, mesmo bloco. Quick-edit no kanban
  monta o payload do bloco e chama a RPC (respeitando `_rev_base` por bloco).
- **Colab** (invariante #6): `producao_terceirizados.rev` já é por bloco; os campos novos entram
  no merge escalar do bloco (`mergeDraft`). Sem estrutura nova de concorrência.
- **Segurança** (invariante #9): nenhum `_core` novo com EXECUTE aberto; helpers de etapa são
  puros (front) + SQL `stable` gated. Gate de módulo `etapas_pl` na tela e nos writers.

## 11. Sub-projetos (fases)

- **S2 — Prazo no fornecedor:** campo no form de editar do Fornecedor + coluna na lista + no bloco
  PL substitui Nº de parcelas.
- **S3 — Parcelas PL:** `parcelas_servico` por prazo a partir da Data Entregue; UI Financeiro
  (Serviços) já tem Marcar pago (PagarDialog: data + comprovante) + coluna Pagamento. **NOVO:**
  exibir "+30/+60/+90" por parcela — aplicar TAMBÉM na aba OCs (consistência).
- **S4 — NF Saída/Entrada:** campos no bloco PL (`SingleFileField`, storage `tenantPrefix`,
  `useSignedUrl`, lupa/zoom).
- **S5 — Peça de foto:** toggle + data no bloco PL; **ícone de câmera na lista de produtos do
  PCP** (na célula da REF, junto do MoDot) quando a data está preenchida. Sem tela nova.

## 12. Ordem de build (decisão do dono: PCP primeiro)

1. **Fase 1 — Fundação + sheet do PCP:** migrations (colunas do bloco + `pcp_etapas` +
   `modules.etapas_pl`); `salvar_terceirizados` estendida; helper `pcp-etapas.ts` (derivação);
   **bloco PL no sheet** (Peça Teste, peça-foto toggle+data, prazo no lugar de nº parcelas, NF,
   reprovadas colapsadas, somas travadas); **hub PCP + correção do título** + rota/gate de Etapas.
2. **Fase 2 — Tela Etapas (kanban):** layout (header/resumo/colapso lateral/cards/fotos/overlay),
   quick-edit em sync, config de etapas (renomear + ativa/inativa).
3. **Fase 3+ — S2 · S3 · S4 · S5** (cada um seu ciclo).

## 13. Testes

- Unit: `pcp-etapas.test.ts` (derivação da etapa por preenchimento; etapa desativada pulada;
  reprovada = fora do kanban).
- Integração txn (BEGIN/ROLLBACK): `salvar_terceirizados` grava os campos novos; parcelas por
  prazo a partir da Data Entregue netam as pagas; gate `etapas_pl`.
- Anti-drift: helper SQL de etapa ≡ TS (paridade), como `cq-status`/`servico-confeccao`.
- Fidelidade: nada do sheet atual regride (check do mockup §6).

## 14. Decisões travadas

- PL = categoria PL **E** `interno=false`.
- Etapa é **derivada** do preenchimento (sem drag).
- Etapa 1 reprovada → parado na etapa 1, só no sheet (fora do kanban).
- Etapa 2 = **Data Enviado** (campo existente, sem campo novo).
- Etapa 5 = só visual.
- Somas (Enviada/Cortada/Recebida/Defeito/Saldo/Custo) = **travadas** (Σ da grade).
- Vencimento das parcelas PL = **Data Entregue + prazo** (30/60/90).
- Etapas ligáveis/desligáveis **por loja**.
- Kanban ↔ sheet **sempre em sync** (mesma RPC/bloco).
- Rótulos das etapas **renomeáveis**; ordem/gatilho **fixos**.
- **Build começa pelo sheet do PCP**; Etapas abaixo de PCP no sidebar; título PCP corrigido.

## 15. Riscos / questões abertas

- "Data Enviado" hoje dispara o status `em_andamento` do bloco (trigger `auto_status_terceirizado`).
  Reusá-la como gatilho da etapa 2 é coerente, mas confirmar que não há efeito colateral no status
  geral exibido no resumo.
- Um modelo com **múltiplos blocos PL** gera múltiplos cards no kanban — confirmar a rotulagem
  (REF + fornecedor) p/ não confundir (raro, mas possível).
- `types.ts` não regenerado (front `as any` nas colunas novas) — débito conhecido.
