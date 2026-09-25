# Data da Nota de Entrada nas 5 OCs — especificação

**Status:** desenho APROVADO pelo dono em 24/set/2026 ("aprovo o desenho"). Autoridade:
`.superpowers/sdd/2026-09-24-nota-entrada/desenho-aprovado.md` (checkout principal, não versionado).
**Plano de implementação:** `docs/superpowers/plans/2026-09-24-data-nota-entrada.md`.
**Frente:** paralela e independente da campanha do Planejamento; worktree própria. **Produção:** ordem NOVA do dono (24/set ~22h — "Aviso Global deixaremos por último, não é tão importante no momento, preciso do kanban automático, e fusão prontos"): **F1 → Nota → SKU → Aviso Global** (supera o "depois da F1 e do Aviso Global" original; ver G-migration A-RA1/B-R2 e o diário do guardião, `guardiao.md` 25/set ~01h30).
**Revisão:** G-plano (guardião) APROVOU `05561ae` COM RESSALVAS R1–R8, aplicadas nesta versão (§4.6, §7, §8, §10); R9 =
ponto do coordenador (travas no arquivo e hook `supautils.policy_grants`, lição do Aviso Global — §4.6 e §7). Reconferência
de `57c01b6`: R1–R8 fechadas; **R9-a** (volta medida com OCs datadas; tempo próprio do inverso; ida conferida) aplicada em
§4.6, §7 e §8. Reconferência de `25b1ad3`: R9-a fechada; **R9-b** (medição numa transação DESFEITA, sem resíduo na cópia;
repasse do laço depois do DROP TRIGGER; teste do inverso com as 4 famílias e a ordem conferida) aplicada em §4.6, §7 e §8.
D6 e D7 (§10) foram **DECIDIDAS pelo dono em 24/set** ("D2 a D7 aprovados, guarde a resposta") — o plano implementa a recomendação.

---

## 1. Objetivo

Nas OCs de **Tecido, Aviamento, Insumo, Produto Acabado e Produto Importado** passa a existir o campo
**"Data da Nota de Entrada"** (uma por OC). Nas quatro primeiras o **prazo de pagamento conta a partir dela**; sem ela os
vencimentos continuam sendo gerados como hoje, mas ficam **provisórios** e o sistema **avisa** (na OC, nas listas e no
Financeiro) quando a OC já foi recebida sem a data. No Importado a data **só é registrada**.

## 2. Decisões do dono (verbatim)

Pedido original (24/set): "Em OCs (Tecido, Acabado, Importado, Aviamento e Insumo) é necessário um campo chamado Data da
Nota de Entrada; a partir desta data colocada é válido o prazo de pagamento."

Respostas às perguntas de desenho (24/set):
- Quantas datas: "Uma por OC".
- Sem a data: "cria uma mensagem alerta, que falta informação de data da nota, assim como na lista de encomendados/recebidos
  fica com bolinha amarela para alertar que existe alguma anomalidade".
- Mudar a data depois: "Recalcula as não pagas".
- Importado: "Só registra a data".
- Parcelas sem a data: "gera o provisório, porém em financeiro iria ficar em vermelho ou amarelo dizendo que há falta de
  informação" → o desenho fechou em AMARELO.
- Quando alertar: "Após o recebimento".

Desenho aprovado (texto apresentado ao dono, verbatim):

> **Campo**
> - **"Data da Nota de Entrada"**, uma por OC, no cabeçalho das 5 OCs (Tecido, Aviamento, Insumo, Produto Acabado e Importado),
>   com o mesmo seletor de data das outras.
>
> **Vencimentos**
> - **Tecido, Aviamento, Insumo e Produto Acabado:** com a data preenchida, **o prazo de pagamento conta a partir dela**. Sem a
>   data, as parcelas são geradas **provisoriamente**, contando da base de hoje: a entrega, ou o pedido no Acabado.
> - **Preencher ou mudar a data depois** recalcula sozinho os vencimentos das parcelas **não pagas**. **As pagas nunca mudam.**
> - **Importado:** a data fica só registrada. Os vencimentos continuam sendo os das etapas de câmbio, como hoje.
>
> **Alertas**, só quando a OC já foi **recebida** e está sem a data:
> - **na OC:** aviso "Falta a Data da Nota de Entrada — os vencimentos estão provisórios";
> - **nas listas de Encomendadas e Recebidas:** uma **bolinha amarela** na OC;
> - **no Financeiro:** as parcelas dessa OC ficam **destacadas em amarelo**, com a indicação "vencimento provisório — falta a
>   data da nota".
>
> **Por baixo**
> - A mudança fica no banco: uma coluna nova em cada OC e o ajuste das regras que geram as parcelas.
> - É testada na cópia, com testes específicos para dinheiro: parcela paga preservada e soma sempre igual ao total da OC.
> - Passa pelo guardião e **vai para produção com backup completo antes**, aplicada pelo dono.
>
> **Entrega:** frente paralela e independente, com worktree própria. Na fila de produção, entra **depois da F1 e do Aviso
> Global**.

---

## 3. Fatos verificados (24/set/2026, só leitura)

Fontes: código do checkout principal (`feature/plan-tecido-a1` @ `a044759`) e a **cópia local** do banco
(`127.0.0.1:54422`, `default_transaction_read_only=on`, só `SELECT`/`pg_get_functiondef`). Produção NÃO foi acessada.
Números de linha de função = linha do `pg_get_functiondef` na cópia. A cópia tem md5 de funções igual a produção
(conferido em 23/set, `reference_banco_local`); hoje está com a F1 e a coluna da F3.1 aplicadas: **458 funções | 263
gatilhos** em `public`.

### 3.1 Banco — quem gera e recalcula as parcelas a pagar

| Família | Gera (gatilho) | Recalcula (quem chama) | Base do vencimento HOJE | Prazo |
|---|---|---|---|---|
| **Tecido** (`ocs_tecido`) | `gerar_parcelas_oc_tecido()` via `gerar_parcelas_oc_tecido_trg` (AFTER INSERT OR UPDATE): só na TRANSIÇÃO para `recebido`, só se a OC ainda não tem parcela; pula rolo (`is_rolo`); total = `valor_real_total` | `_recalcular_parcelas_core(id,'tecido')`: chamado no FIM de **todo** save de OC recebida (`_salvar_oc_tecido_core` l.158-160), pelo gatilho `trg_recalc_parcelas_valor` (`recalc_parcelas_on_valor`, UPDATE OF `valor_real_total`, OLD e NEW recebidos) e pelo botão "Recalcular Parcelas" do Financeiro (`recalcular_parcelas`, `financeiro.tsx:777`) | `COALESCE(NEW.data_entrega, CURRENT_DATE)` (gerador l.41; core l.114) | `prazo_pagamento` texto; nº = números achados pelo regex `[^0-9]+` (teto 24), senão `quantidade_prazos`; venc_i = base + dias[i], senão base + i×30 |
| **Aviamento** (`ocs_aviamento`) | `gerar_parcelas_oc_aviamento()` (idem; total = Σ coalesce(recebida,pedida) × `aviamentos.preco`, itens não cancelados) | `_recalcular_parcelas_core(id,'aviamento')`: fim de todo save recebido (`_salvar_oc_aviamento_core` 4 args, l.146-148); gatilho de item `trg_recalc_parcelas_aviamento` (`recalc_parcelas_aviamento_on_item`, só OC recebida); botão do Financeiro | `COALESCE(NEW.data_entrega, CURRENT_DATE)` (gerador l.46; core l.114) | igual ao Tecido |
| **Insumo** (`ocs_etiqueta`) | `gerar_parcelas_oc_etiqueta()` delega a `recalcular_parcelas_etiqueta(uuid)` | `recalcular_parcelas_etiqueta`: fim de todo save recebido (`salvar_oc_etiqueta` 4 args, l.122); gatilho de item `trg_recalc_parcelas_etiqueta`. O botão do Financeiro fica desabilitado para Insumo (`financeiro.tsx:881`) | `COALESCE(v_data_entrega, CURRENT_DATE)` (l.38); total = Σ coalesce(recebida,pedida) × `item.preco` | igual ao Tecido |
| **P. Acabado** (`ocs_p_acabado`) | `gerar_parcelas_oc_p_acabado()` via `trg_gerar_parcelas_ocpa` (AFTER INSERT OR **UPDATE OF valor_total_desconto, prazo_pagamento, data_pedido**): **SEM** filtro de status — as parcelas nascem no PEDIDO; como o save sempre põe essas 3 colunas no SET, **todo save regenera as não pagas** | o próprio gatilho; `_recalcular_parcelas_core(id,'p_acabado')` (botão do Financeiro) | `coalesce(NEW.data_pedido, current_date)` (gerador l.64); core usa `data_pedido` (l.65-67, nome da variável `v_data_entrega` mantido) | `string_to_array(coalesce(prazo,'30'),'/')` — só "/" (≠ regex do core; divergência PRÉ-EXISTENTE, fora de escopo) |
| **Importado** (`ocs_importado`) | `_gerar_parcelas_importado(uuid)` via `trg_parcelas_importado_oc` (UPDATE OF valor_unitario_m1, qtd_total, peso_kg, transporte_m2, desconto_pct, cotacao_final, data_pedido, empresa_id) e `trg_parcelas_importado_etapa` | `_recalcular_parcelas_core(id,'p_importado')` só re-roda o gerador | **1 parcela por ETAPA de câmbio** (nº = `ordem`), valor BRL de `_imp_etapas_brl_oc`, vencimento = `coalesce(etapa.data_vencimento, oc.data_pedido, current_date)` (l.34) | **não existe** `prazo_pagamento` em `ocs_importado` |

Regras comuns do recálculo (`_recalcular_parcelas_core`, `recalcular_parcelas_etiqueta`, gerador do P. Acabado):
`pg_advisory_xact_lock(hashtext(oc))` (core/etiqueta); parcela **paga** = `status='pago' OR data_pagamento IS NOT NULL` —
nunca é apagada nem alterada e ocupa o seu `numero_parcela`; as não pagas são APAGADAS e recriadas nos números livres com
`round(restante ÷ nº livres, 2)` e o ÚLTIMO número livre absorve o resto do arredondamento ⇒ **Σ(pagas) + Σ(novas) = total**
(quando `restante > 0` e há número livre). Consequências já vigentes hoje:
- as não pagas podem **trocar centavos entre si** num recálculo (ex.: total 1.000 em 30/60/90 com a 1ª paga: 333,33 · 333,34 ·
  333,33 em vez de 333,33 · 333,33 · 333,34) — a soma continua igual ao total;
- as não pagas ganham **id novo** a cada recálculo (DELETE + INSERT);
- um vencimento de parcela não paga **editado à mão no Financeiro** (o cliente pode dar UPDATE em `data_vencimento`,
  invariante #1) é SOBRESCRITO no próximo save de OC recebida (Tecido/Aviamento/Insumo) ou em qualquer save (P. Acabado).

**Entregas parciais:** `parcelas_recebimento` (jsonb) é o cronograma de ENTREGA, não de pagamento. Tecido/Aviamento/Insumo
só geram parcela a pagar quando a OC vira `recebido`; nesse momento o front grava `data_entrega` = a ÚLTIMA data das
entregas (`entrada-saida.oc-tecido.tsx:499-504` `ultimaDataEntrega` e `:1200`; `oc-aviamento.tsx:861-864,872`;
`oc-insumo.tsx:797,801`). Marcar entregas parciais com a OC ainda "Encomendada" não gera nem altera parcela.
**Desmarcar recebimento** apaga as não pagas (`_desmarcar_recebimento_oc_core` tecido/aviamento;
`desmarcar_recebimento_oc_etiqueta`).

**Gravação das OCs (todas por RPC, com trava otimista `_rev_base`/P0409):**
`salvar_oc_tecido` → `_salvar_oc_tecido_core(uuid,jsonb,jsonb,int)`; `salvar_oc_aviamento` (4 args) →
`_salvar_oc_aviamento_core(uuid,jsonb,jsonb,int)` (existe também o overload de 3 args — débito conhecido, o front usa o de 4:
`oc-aviamento.tsx:894-899`); `salvar_oc_etiqueta(uuid,jsonb,jsonb,int)` (RPC sem `_core`; `oc-insumo.tsx:805-808`);
`salvar_oc_p_acabado` (3 e 4 args) → `_salvar_oc_p_acabado_core(uuid,jsonb,jsonb,int)`; `salvar_oc_importado` (4 e 5 args) →
`_salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,int)`. Os cores gravam o cabeçalho COLUNA A COLUNA a partir do jsonb (chave
desconhecida é ignorada). `authenticated` também tem UPDATE direto nas 5 tabelas (RLS `tenant_update` + `modgate_upd`) —
o front já usa isso para `nfs`.

**ACL e md5 hoje (cópia; base da guarda da migration):**

| Função | md5(`pg_get_functiondef`) | anon | authenticated |
|---|---|---|---|
| `gerar_parcelas_oc_tecido()` | `ac9fb224249f42133f5bf2750aba5d1c` | f | f |
| `gerar_parcelas_oc_aviamento()` | `345e55d865a0e4713e6ccbc62f50830d` | f | f |
| `gerar_parcelas_oc_p_acabado()` | `1d8286d877f32a437b344a0da1766ccb` | t (PUBLIC) | t |
| `_recalcular_parcelas_core(uuid,text)` | `b8af65bc500958202db25ddb5f3d3eed` | f | f |
| `recalcular_parcelas_etiqueta(uuid)` | `d60ab89c8c25a830aa7a7789ff97eef0` | f | f |
| `_salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)` | `b5255dc864f0e7f9f39236b4b9c531d6` | f | f |
| `_salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)` | `56af6c8a9ecb5619be2de1f2068553b3` | f | f |
| `salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)` | `d92d27b1d774ca4d867fc9151f774fda` | t (PUBLIC) | t |
| `_salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)` | `bd8139b1a1b1dee8b4b90e4327cb152c` | f | f |
| `_salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)` | `b74cd38a16fa08482551f1fb7e1487bb` | f | f |

(`gerar_parcelas_oc_p_acabado` é função de gatilho — não pode ser chamada por RPC; `salvar_oc_etiqueta` é a própria RPC e
checa `auth.uid()` e o módulo por dentro. As duas mantêm o ACL de hoje: esta frente não muda postura de segurança fora do
que toca.) `parcelas`: `authenticated` só tem UPDATE nas colunas `status, data_vencimento, data_pagamento, comprovante_url`.

**Colunas hoje:** nenhuma das 5 tabelas tem `data_nota_entrada`. `ocs_tecido/_aviamento/_etiqueta` têm `nfs jsonb`
`[{url, data}]`, mas esse `data` é a data do UPLOAD do anexo (`src/components/oc-tecido/NfList.tsx:29`), não a data da nota.
`ocs_p_acabado`/`ocs_importado` têm `nota_fiscal varchar` (número da NF) e `data_entrega`.

**Dados (cópia):** OCs recebidas hoje, todas sem a data (a coluna não existe) e TODAS com parcela não paga: Tecido 46 (Ave
Rara 38, Loja Teste 7, French 1), Aviamento 1, Insumo 1, P. Acabado 0 ⇒ **48 OCs acendem o alerta no dia em que isto entrar no
ar** (ver D1). 89 parcelas não pagas já estão com vencimento no passado. Loja Teste (âncora dos testes): Tecido 7 recebidas/12
encomendadas, Aviamento 1/1, Insumo 1/1, P. Acabado 0/2, Importado 0/1 (a OC `de8c5728…` tem 3 etapas e 3 parcelas).

**Frentes abertas:** nenhuma migration das branches `f2/kanban-telas`, `f31/…`, `f32/…`, `f33/…`, `f34/…` toca estas funções
ou tabelas (conferido por `git grep` em `supabase/migrations` de cada branch). O plano do Aviso Global ainda não está commitado
(a Task 0 do plano confere quando estiver).

### 3.2 Front

- **OC Tecido** — rota `src/routes/_authenticated/entrada-saida.oc-tecido.tsx`: lista `:89-105` (queryKey
  `["ocs_tecido", tab, …]`, `select("*")` + `.eq("status", tab)`); `Draft` em `src/components/oc-tecido/shared.ts:76-97`
  (`emptyDraft` `:130-153`, tipo `OC` `:46-72`); `draftFromOc` `:428-452`; `ROTULO_CONFLITO` `:459-476`; payload `:1182-1205` →
  RPC `:1253-1260`; `onSuccess` `:1330-1335` (já invalida `["parcelas"]`); prévia das parcelas `previewParcelas` `:513-555`
  (espelho do servidor, base = `ultimaDataEntrega`) e `ConfirmarRecebimentoDialog baseDataISO` `:1852`; cabeçalho/pagamento
  `src/components/oc-tecido/OcTecidoForm.tsx:186-208` (bloco "Par pagamento ao fornecedor"); lista
  `src/components/oc-tecido/OcTecidoList.tsx` (Recebidas: celular `:215-226`, tabela `:262-270`).
- **OC Aviamento** — `entrada-saida.oc-aviamento.tsx`: tipo `OC` `:111-123`; lista `:162-170`; Recebidas `:441` e `:473`;
  `Draft` `:540-554`; `draftFromOc` `:640-660`; `ROTULO_CONFLITO_AVI` `:796-801`; payload `:865-877`; `onSuccess` `:908-916`
  (já invalida `["parcelas"]`); cabeçalho `:1078-1135` (Prazo de Pagamento `:1110-1122`).
- **OC Insumo** — `entrada-saida.oc-insumo.tsx`: lista `:149-158` (linhas `:295`, `:328`); `DraftHead` `:82-93`; estados
  soltos `:411-421`; `draftHead`/`aplicarDraftHead` `:424-450`; `formState` `:531`; `headFromOc` `:568-580`; seed/merge
  `:632-693`; `ROTULO_CONFLITO_INS` `:696-701`; payload `:797-802`; `invalidate` `:239` (inclui `"parcelas"`); cabeçalho
  `:922-943`.
- **OC P. Acabado** — `entrada-saida.oc-p-acabado.tsx`: lista `:101-110` (select de colunas EXPLÍCITAS), `OcPaListaTable`
  `:339-420` (linhas `:367`, `:400`); `Draft`/`OcPaRow`/`emptyDraft` em `src/components/oc-p-acabado/shared.ts:33-110`;
  `draftFromOc` `:519-550`; `ROTULO_CONFLITO_PA` `:731-740`; `montarDados` `:845-876`; save `:894-935` e receber `:937-990`
  (**nenhum invalida `["parcelas"]`**, embora o save regenere as parcelas — lacuna pré-existente que esta frente fecha);
  bloco Pedido `src/components/oc-p-acabado/OcPaForm.tsx:264-290`.
- **OC P. Importado** — `entrada-saida.oc-p-importado.tsx`: lista `:88-97`; `draftFromOc` `:491`; `ROTULO_CONFLITO_IMP`
  `:781-791`; `montarDados` `:853-880`; bloco Pedido `src/components/oc-p-importado/OcImpForm.tsx:331-338`.
- **Financeiro** — `src/routes/_authenticated/financeiro.tsx`: UMA query `["parcelas"]` (`:221-332`) alimenta Calendário, OCs
  (lista) e Resumo; busca as OCs por família (`:243-261`) só para nº/representante; tipo `Parcela` `:64-91`; chips do calendário
  `:541-551`; agenda do celular `:628-645`; `DiaParcelasList` `:976-1018`; linhas da lista `:1245-1300` (`VencimentoCell`
  `:1023-1039`); `ParcelaDetailDialog` `:704-925`; `OcViewDialog` `["oc-view", tipo, id]` `:1748-1800`; Resumo "Próximas
  parcelas" `:2236-2253`. **O amarelo (tom `warning`) já significa "Vence em ≤ 3 dias" no calendário** (`:137`) — ver D5.
  Dashboard: `["dash-financeiro", ini, fim]` (`src/routes/_authenticated/dashboard.tsx:289`).
- **Realtime:** `src/lib/realtime-invalidation-map.ts` — `parcelas → ["parcelas","financeiro-pendencias-receb"]` (`:206`); as
  tabelas `ocs_*` não invalidam `"parcelas"`. Como a mudança da data numa OC recebida sempre regrava parcelas (DELETE+INSERT),
  o evento de `parcelas` já chega; o arquivo NÃO precisa mudar (e o teste dele está na F2).
- **Primitivos:** `DateField` (`src/components/shared/DateField.tsx`: `value/onChange/disabled/id/aria-label/data-colab-path/
  inputClassName`); tons `--tone-warning-bg/-fg` e `bg-warning` (`src/styles.css:30,79,152-153`); `mensagemErro` já usado nas 5
  OCs e no Financeiro.

---

## 4. Desenho de dados

### 4.1 Coluna

`data_nota_entrada date NULL` em `ocs_tecido`, `ocs_aviamento`, `ocs_etiqueta`, `ocs_p_acabado`, `ocs_importado`. Sem
default, sem backfill, sem índice (as listas filtram por `status`; o alerta é derivado no front). `COMMENT ON COLUMN` explica a
regra.

### 4.2 Nova base do vencimento (Tecido, Aviamento, Insumo, P. Acabado)

Em todos os pontos que calculam a base — `gerar_parcelas_oc_tecido`, `gerar_parcelas_oc_aviamento`,
`gerar_parcelas_oc_p_acabado`, `_recalcular_parcelas_core` (ramos tecido/aviamento/p_acabado) e `recalcular_parcelas_etiqueta`:

```
base = COALESCE(data_nota_entrada, <base de hoje>, CURRENT_DATE)
       <base de hoje> = data_entrega (Tecido/Aviamento/Insumo) | data_pedido (P. Acabado)
```

Nada mais muda nessas funções (nº de parcelas, valores, netting das pagas, `dias_offset`, lock). Sem a data, o resultado é o
de hoje byte a byte. **Importado fica fora**: `_gerar_parcelas_importado`, seus gatilhos e o ramo `p_importado` do core NÃO são
tocados.

### 4.3 Gravar a data

Os 5 cores de save passam a gravar a coluna a partir da chave `data_nota_entrada` do jsonb:
- INSERT: `NULLIF(<json>->>'data_nota_entrada','')::date`;
- UPDATE: `CASE WHEN <json> ? 'data_nota_entrada' THEN NULLIF(<json>->>'data_nota_entrada','')::date ELSE data_nota_entrada END`
  — **chave ausente mantém** o valor (aba/front antigo, overload de 3 args e o "Fazer pedido" dos cards não apagam a data);
  chave presente com `null`/`""` LIMPA.
A data é editável em qualquer status (inclusive recebida — é justamente quando o alerta pede) e NÃO entra nas travas "OC
recebida congela valores" do P. Acabado/Importado.

### 4.4 Recalcular as não pagas quando a data muda

- **Tecido/Aviamento/Insumo:** novo gatilho `trg_nota_entrada_recalc` AFTER UPDATE OF `data_nota_entrada` em cada tabela,
  `WHEN (OLD.status = 'recebido' AND NEW.status = 'recebido' AND OLD.data_nota_entrada IS DISTINCT FROM NEW.data_nota_entrada)`
  (+ `NOT is_rolo` no Tecido) → função `fn_oc_nota_entrada_recalc()` chama o recálculo DA FAMÍLIA
  (`_recalcular_parcelas_core(id,'tecido'|'aviamento')`, `recalcular_parcelas_etiqueta(id)`). Cobre qualquer caminho de escrita
  (RPC ou UPDATE direto). Na TRANSIÇÃO para recebido o gatilho não dispara (OLD não era recebido): o gerador já usa a data.
  No save pela RPC o core ainda chama o recálculo no fim — recálculo duplo na mesma transação quando a data muda, idempotente
  (mesmo padrão que já existe com `trg_recalc_parcelas_valor`).
- **P. Acabado:** `trg_gerar_parcelas_ocpa` é recriado com `data_nota_entrada` na lista `UPDATE OF` — o gerador existente
  (que já regenera as não pagas a cada save) passa a reagir também à data, inclusive por UPDATE direto. Como hoje, vale
  antes do recebimento (as parcelas do Acabado nascem no pedido).
- **Garantias (testadas):** parcela paga NUNCA muda (id, `valor`, `data_vencimento`, `status`, `data_pagamento`); não pagas =
  `base_nova + dias[i]` (ou `+ i×30`); **Σ parcelas = total da OC**; OC não recebida (Tecido/Aviamento/Insumo) não ganha
  parcela; Importado idêntico antes/depois de gravar a data.

### 4.4b Validar a data no servidor (D7 — DECIDIDA pelo dono 24/set; o plano implementa a recomendação)

Função `fn_oc_nota_entrada_valida()` (SECURITY DEFINER, EXECUTE revogado dos 3 — #9) e gatilho `trg_nota_entrada_valida`
BEFORE INSERT OR UPDATE OF `data_nota_entrada` nas **5** OCs. Só age quando a data é informada e mudou (re-salvar sem mudar
não revalida — OCs antigas não travam). Recusa com `P0001` em PT, textos iguais aos do front:
- data **futura** (> hoje no fuso da loja — `tenant_config.timezone`, padrão `America/Sao_Paulo`): "A Data da Nota de
  Entrada (dd/mm/aaaa) não pode ser no futuro.";
- data **anterior à data do pedido** da OC: "A Data da Nota de Entrada (dd/mm/aaaa) não pode ser anterior à data do pedido
  (dd/mm/aaaa)."
Vale para a RPC e para UPDATE direto. A recusa desfaz o comando inteiro (inclusive o que um gatilho de parcelas tenha feito
antes dela), então data recusada não move vencimento. Contagem da migration: **+2 funções | +8 gatilhos** (sem a D7 seria +1 | +3).

### 4.5 Sinal "provisório"

Não há coluna nova para isso: o Financeiro já lê as OCs das parcelas; passa a trazer `status, data_nota_entrada` e deriva, pela
regra única em `src/lib/nota-entrada.ts`:

```
faltaNotaEntrada(familia, oc) = familia ∈ {tecido, aviamento, etiqueta, p_acabado} ∧ oc.status = 'recebido' ∧ data vazia
parcelaProvisoria(p, oc)      = faltaNotaEntrada(p.tipo_oc, oc) ∧ p não paga (status ≠ 'pago' ∧ data_pagamento vazia)
```

A parcela PAGA nunca fica amarela (o vencimento dela não muda mais). O Importado nunca é provisório (D2).

### 4.6 Migration e inverso

UMA migration: `supabase/migrations/20261002100000_oc_data_nota_entrada.sql` (`BEGIN;`/`COMMIT;` em linha própria,
idempotente, GERADA a partir do texto vivo das funções — nunca editada à mão).

- **Travas no arquivo (R9):** logo depois do `BEGIN;`, `SET LOCAL lock_timeout = '500ms';` e `SET LOCAL transaction_timeout =
  '3s';` (no inverso, o tempo próprio dele — R9-a, abaixo) — valem mesmo no `psql -f`, que é o caminho padrão do CLAUDE.md.
  O harness de teste exige as 2 linhas (ida 3 s; inverso ≥ 30 s) e as tira da transação do teste (senão o relógio derrubaria
  a suíte).
- **Aplicação (R3):** fora do harness, SÓ pelo `aplica_v2` do runbook v2 da F1 (igual ao Aviso e à F3.1): arquivo inteiro numa
  mensagem, as mesmas 2 travas reinjetadas depois do `BEGIN;` (repetidas, inofensivas), nova tentativa só em 55P03/40P01/25P04
  com o ATIV antes; qualquer outro erro PARA. Nada de `psql -1 -f`. Horário calmo.
- **Sem DDL de policy (R9):** nenhum `CREATE`/`DROP`/`ALTER POLICY` (coluna nova não obriga a recriar policy). O hook
  `supautils.policy_grants` do Supabase — que, a cada DDL de policy feita como `postgres`, pega AccessExclusive em 24 tabelas
  de auth/storage/realtime até o COMMIT (`show supautils.policy_grants` na cópia, 24/set) — NÃO dispara. O harness e o
  pré-voo recusam o arquivo se entrar uma. Se um dia for preciso: DDL de policy no FIM do arquivo, e esta spec deixa de
  dizer que a migration não trava auth/storage.
- **Guarda de md5 EXATA (R2):** cada uma das 10 funções tem de estar com o md5 EXATO de 24/set (§3.1) ou com o md5 EXATO
  que esta migration instala (reaplicação); as 2 funções novas, ausentes ou com o md5 desta migration. Qualquer outro texto —
  inclusive um que ainda contenha `data_nota_entrada` — `RAISE` e nada é aplicado (protege contra reverter em silêncio uma
  mudança feita por outra frente depois de 24/set). Teste de recusa na integração.
- **Pós-condição** em `DO`: 5 colunas, 3 gatilhos de recálculo + 5 de validação (D7), gatilho do Acabado com a coluna, ACL #9,
  e as 12 funções com o md5 EXATO esperado. `pg_notify('pgrst','reload schema')`. Diff `pg_get_functiondef` antes/depois de
  TODA função redefinida registrado (§4.7).
- **Contagens:** +2 funções | +8 gatilhos. A cópia vai de 458 | 263 para **460 | 271** (sem a D7: 459 | 266).

- **A ida não cresce com os dados (R9-a):** não tem DML fora de corpo de função (o gerador recusa se entrar); `ADD COLUMN`
  sem `DEFAULT` só mexe no catálogo; o resto é guarda, `CREATE OR REPLACE`, gatilho e ACL. Os 3 s valem com qualquer volume
  de OCs; o ensaio mede a ida duas vezes (sem e com as OCs recebidas datadas) e para se passar de 0,6 s (folga de 5×).

Inverso: `supabase/rollback/20261002100000_oc_data_nota_entrada_down.sql` — **DESTRUTIVO: apaga as datas digitadas**; exige
`SET LOCAL app.confirmo_apagar_data_nota_entrada = 'sim'` (pelo `EXTRA_SQL`, na mesma transação); a mesma guarda de md5 exata
(as funções têm de estar no texto desta migration ou já no de 24/set). Ordem (R9-a/R9-b): captura as OCs datadas → restaura as 10
funções com o texto de 24/set → **recalcula as não pagas das OCs que tinham data** (voltam à base antiga) → derruba os
gatilhos novos e recria o do Acabado como era → **repassa** as OCs que ganharam data depois da captura → dropa as colunas →
confere o md5 no fim. O laço vem ANTES das travas exclusivas: enquanto ele roda só há trava de LINHA (parcelas e a OC do
Acabado); o AccessExclusive nas 5 OCs (DROP TRIGGER/DROP COLUMN) fica no fim, curto.

- **Repasse depois do DROP TRIGGER (R9-b):** como o laço agora roda antes das travas exclusivas, abriu-se uma janela: uma OC
  encomendada com data que é recebida DURANTE o laço (por outra sessão, com o gerador da Nota ainda vivo para ela) ganharia
  parcelas pela NF e ficaria fora da captura. Com o AccessExclusive das 5 OCs já pego pelos DROP TRIGGER, o passo 4b refaz,
  na base antiga, as OCs com data que atendem ao mesmo critério da captura e NÃO estão nela (normalmente 0; um NOTICE diz
  quantas). Depois disso nenhuma sessão consegue mudar as OCs até o COMMIT.

- **Tempo do inverso (R9-a):** o laço recalcula as não pagas de CADA OC datada, então o tempo cresce com o nº de OCs datadas
  em produção (o ensaio antigo voltava com 0 OC datada — nunca tinha sido medido). Por isso o inverso tem `lock_timeout =
  '500ms'` (igual à ida) e `transaction_timeout` PRÓPRIO, maior: `gerar_sql.py --tt-inverso N`, padrão e mínimo 30 s; o
  ensaio mede o laço com volume real e sobe o valor para ⌈5 × medido⌉ se passar de 30 s. **A medição (R9-b) é numa transação
  DESFEITA**, no harness de integração: migration (sem BEGIN/COMMIT, nunca `\i`) → data as OCs recebidas da cópia (o
  conjunto do dia 1) → a ida de novo → o inverso cronometrado por `clock_timestamp()`, com `transaction_timeout` alto só
  nessa transação → ROLLBACK. Nenhuma parcela, OC, `rev` ou linha de `audit_log` da cópia muda: um retrato só-leitura
  (linhas inteiras de parcelas e das 5 OCs — ids, vencimentos, `dias_offset`, `rev` — e o nº de linhas do `audit_log`)
  tirado antes e depois tem de sair igual. (A versão anterior datava as OCs de verdade e fazia a volta real: recriava 162
  parcelas de 48 OCs de 3 lojas com id novo e `dias_offset` preenchido, subia o `rev` das OCs e sujava o `audit_log` —
  descartada.) Um `SET LOCAL transaction_timeout` maior DEPOIS de um menor não estende o relógio (provado na cópia pelo
  guardião): o 1º SET da transação é o que vale. Por isso o inverso vai pelo `aplica_v2_inverso`, que injeta o tempo DO
  ARQUIVO antes dele (o `com_travas` literal do runbook injetaria 3 s); a ida segue no `aplica_v2` literal.
- **Por que um tempo maior é aceitável só no inverso:** a volta é EMERGÊNCIA, decidida pelo dono, em horário calmo. O que
  protege os outros usuários é o `lock_timeout` curto, que continua 500 ms: o arquivo nunca fica na fila de uma trava
  segurando quem chega depois (desiste em 0,5 s e tenta de novo). Com o laço antes das travas exclusivas, as telas de OC só
  ficam paradas no trecho final, curto.
- **Antes da confirmação em produção:** o `volta-producao.sh` mostra quantas OCs estão datadas (por família), estima o tempo
  pela medição do ensaio e PARA se o `transaction_timeout` não cobrir o laço com folga de 5×. O dono então regenera o inverso
  com `--tt-inverso` maior ou roda com `NOTA_TT_VOLTA=Ns` (vale só naquela volta). Só depois pede a confirmação digitada
  ("APAGAR AS DATAS").

### 4.7 Diff mínimo esperado das 10 funções (antes → depois)

Só estas linhas mudam (o resto é byte a byte o texto de 24/set):
- `gerar_parcelas_oc_tecido` l.41 e `gerar_parcelas_oc_aviamento` l.46: `COALESCE(NEW.data_entrega, CURRENT_DATE)` →
  `COALESCE(NEW.data_nota_entrada, NEW.data_entrega, CURRENT_DATE)` (+1 linha de comentário).
- `gerar_parcelas_oc_p_acabado` l.64: `coalesce(NEW.data_pedido, current_date)` → `coalesce(NEW.data_nota_entrada,
  NEW.data_pedido, current_date)` (+1 comentário).
- `_recalcular_parcelas_core`: +`v_data_nota date;`; os 3 SELECTs (tecido l.49-50, aviamento l.53-54, p_acabado l.65-66)
  ganham `, data_nota_entrada` / `, v_data_nota`; l.114 → `COALESCE(v_data_nota, v_data_entrega, CURRENT_DATE)` (+1 comentário).
- `recalcular_parcelas_etiqueta`: +`v_nota date`; SELECT l.13-14 ganha a coluna; l.38 → `COALESCE(v_nota, v_data_entrega,
  CURRENT_DATE)` (+1 comentário).
- `_salvar_oc_tecido_core`, `_salvar_oc_aviamento_core`, `salvar_oc_etiqueta`, `_salvar_oc_p_acabado_core`,
  `_salvar_oc_importado_core`: coluna no INSERT (lista + valor) e a linha do `CASE … ? 'data_nota_entrada' …` no UPDATE.

---

## 5. Desenho de telas

- **Campo** "Data da Nota de Entrada" com `<DateField>` (nunca `<input type="date">`), no cabeçalho de cada OC, junto do
  pagamento: Tecido — no bloco "Par pagamento ao fornecedor" (`OcTecidoForm`); Aviamento e Insumo — no grid do "1 · Pedido", ao
  lado do Prazo de Pagamento; P. Acabado — no "Pedido" (`OcPaForm`), ao lado de "Parcelas a pagar (derivado)"; Importado — no
  "Pedido" (`OcImpForm`), depois da data prevista. Dica abaixo: "O prazo de pagamento conta a partir desta data." (Importado:
  "Só registro — os vencimentos seguem as etapas de câmbio."). Editável em qualquer status (só `readOnly` de permissão
  bloqueia). Entra no merge colaborativo (Draft/`DraftHead`, rótulo de conflito "Data da Nota de Entrada", `data-colab-path`
  no Tecido).
- **Aviso na OC** (4 famílias, OC recebida e campo vazio no rascunho): faixa em tom warning no topo do formulário, com ícone,
  texto exato **"Falta a Data da Nota de Entrada — os vencimentos estão provisórios"**. Some assim que o campo é preenchido (o
  selo de "alterações não salvas" lembra de salvar). **D6 (DECIDIDA pelo dono 24/set — recomendação implementada):** OC recebida SEM
  parcela a pagar (toda paga ou valor 0) também acende a bolinha e o aviso, mas o aviso diz só **"Falta a Data da Nota de
  Entrada"** (sem "provisórios" — não há vencimento provisório). O aviso conta as parcelas não pagas da OC (mesma régua do
  banco: `status ≠ 'pago'` e `data_pagamento` vazia); enquanto carrega, mostra o texto curto (nunca afirma algo falso).
- **Validação da data (D7 — DECIDIDA pelo dono 24/set, recomendação implementada):** o calendário do `<DateField>` não oferece dia
  futuro (`max` = hoje no fuso da loja, `todayISOInStoreTZ(useStoreTimezone())`); no Salvar, `validarDataNota` recusa data
  futura ou anterior à data do pedido com o MESMO texto do banco (§4.4b), mostrado por `mensagemErro`. O banco valida de novo
  (a regra vale mesmo sem o front).
- **Bolinha amarela** nas listas (4 famílias): ponto `bg-warning` ao lado do nº da OC, com `title`/`aria-label` "Falta a Data
  da Nota de Entrada", no celular e na tabela, nas abas Encomendadas e Recebidas (a regra acende só OC recebida — ver D3).
- **Financeiro** (parcela provisória): Lista — linha com fundo `--tone-warning-bg` e, sob o vencimento, o texto **"vencimento
  provisório — falta a data da nota"** com ícone; Calendário — o chip mantém a cor do status e ganha contorno TRACEJADO amarelo +
  `title` com o texto (D5); agenda do celular, popover do dia, "Próximas parcelas" e Detalhes da Parcela — o texto em tom
  warning.
- **Prévia do "Marcar recebido"** (Tecido): a base passa a ser a data da nota, se preenchida (espelho do servidor).
- **Erros** sempre por `mensagemErro(e, "…")`. Única mensagem nova de banco para o usuário: as 2 da D7 (`P0001` em PT, que o
  `mensagemErro` já repassa). A guarda da migration só roda na aplicação.
- **Invalidação:** ao salvar/receber qualquer das 5 OCs, invalidar `["parcelas"]`, `["dash-financeiro"]`, `["oc-view"]` e
  `["nota-parcelas-a-pagar"]` (a contagem do aviso — D6) (helper único `invalidarVencimentos`).

## 6. Permissões

Sem permissão nova. Quem edita a OC (páginas `entrada_oc_*`, `canEdit`) edita a data — mesma régua do Prazo de Pagamento, que
também move vencimentos. Quem vê o Financeiro vê o destaque. No banco: as RPCs de save seguem com os gates de hoje
(`tenant_module_enabled`, tenant, `auth.uid()`); as 2 funções novas de gatilho (`fn_oc_nota_entrada_recalc`,
`fn_oc_nota_entrada_valida`) e os `_core` ficam com EXECUTE revogado de PUBLIC, anon e authenticated (invariante #9),
conferido com `has_function_privilege`. A validação da data (D7) é do SERVIDOR (gatilho nas 5 OCs), não só do front: um
UPDATE direto também é recusado.

## 7. Riscos

1. **Dinheiro / vencimento errado:** mitigado por testes de integração por família (data + prazo, só não pagas mudam, paga
   intacta, Σ = total, sem data = hoje byte a byte, Importado idêntico) e pela guarda de md5 da migration.
2. **Reverter em silêncio uma função mudada em produção depois de 24/set (R2):** a guarda aceita SÓ o md5 EXATO de 24/set ou
   o desta migration — qualquer outro texto, mesmo contendo `data_nota_entrada`, é recusado (teste de recusa); o pré-voo
   confere os md5 de novo antes do apply.
3. **Ordem de deploy:** o front novo pede `data_nota_entrada` nas listas/Financeiro; sem a coluna o PostgREST devolve erro e o
   Financeiro esvazia. Por isso o merge do front só acontece DEPOIS da migration em produção (o `:5173` do dono lê produção
   assim que o código chega à branch). O front antigo convive com o banco novo (chave ausente = mantém).
4. **Deploy leva fase sem banco (R7):** `npm run deploy` publica a branch inteira. Mesmo portão do Aviso: `git status
   --porcelain -- src` limpo (inclusive não rastreados); PARA se houver commit de front fora da lista aprovada; PARA se houver
   na branch fase com pré-requisito de banco não aplicado (ex.: a F3.1 grava `modelos.descricao_produto`).
5. **Cópia compartilhada (R4/R8):** a migration na cópia muda as contagens usadas por outras frentes. Antes de toda rodada com
   DDL na cópia: nenhum vitest/playwright rodando, nenhuma sessão ativa, e o dono avisado de que o `:5188` congela enquanto
   roda. O ensaio e o QA aplicam com backup e DESFAZEM; no fim, a ida na cópia é feita JUNTO com o merge (sem janela em que o
   `:5188` peça uma coluna que a cópia não tem) e fica PERMANENTE: a cópia passa a **460 | 271** (sem a D7: 459 | 266), e as
   contagens esperadas das outras frentes mudam (ex.: `n3-copia.sh` da F3.1) — o controlador avisa cada frente no chat.
6. **Regressão fora do desenho (R5):** os 7 arquivos de integração que já tocam parcelas/OCs (invariantes, oc-p-acabado,
   rpc-oc-tecido, rpc-oc-aviamento, rpc-negocio, rpc-alerta-guards, batch2-guardas) rodam na cópia ANTES e DEPOIS da ida,
   sempre com `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres`; o conjunto de falhas depois tem de
   ser igual ou menor (nenhuma falha nova).
7. **Volta de emergência da F1 deixa de fechar (R1):** o runbook v2 da F1 espera 427 | 219 e o retrato pré-F1; com a Nota
   no banco a volta da F1 dá **429 | 227** (sem a D7: 428 | 222), com 5 colunas a mais e 10 funções com md5 diferente. Como a
   F3.1 já está em produção (coluna `modelos.descricao_produto`, desde antes da Nota) e sozinha já mudava 2 linhas de
   fidelidade, o `ref-volta-f1.sh` da Nota encadeia na referência MAIS NOVA detectada por objeto (A-RA2/B-R1): usa
   `fidelidade_ref_volta_f1_com_f31_detalhe.txt` (gravada pelo `ref-volta-f1.sh` da F3.1) como base, não o retrato pré-F1
   puro. Grava a referência nova logo depois da Nota em produção; ela SUPERA a da F3.1 sozinha. Com a ordem nova do dono
   (F1 → Nota → SKU → Aviso), o Aviso ainda não chegou a produção nesse ponto — não há referência "do Aviso" a superar.
8. **Locks (R3/R9):** `ALTER TABLE … ADD COLUMN`/`DROP TRIGGER` pegam AccessExclusive nas 5 tabelas de OC até o COMMIT (não
   em `tenant_config`). As policies de OUTRAS tabelas que dependem delas ficam bloqueadas durante a transação — na cópia,
   5: `enderecamento_tecido` (endtec_ins, endtec_upd), `ocs_tecido_itens`, `ocs_aviamento_itens`, `ocs_etiqueta_itens`
   (Estoque, Plan. Tecido, OCs e Financeiro ficam na fila). Não há DDL de policy, então o hook `supautils.policy_grants` NÃO
   trava auth/storage/realtime (login, renovação de token, URL assinada e Realtime não esperam). Mitigação: travas no arquivo
   (500 ms / 3 s), `aplica_v2` com nova tentativa e ATIV antes, tempo medido no ensaio, horário calmo.
9. **Volta de emergência estoura o tempo (R9-a):** o laço do inverso cresce com as OCs datadas, e um `SET LOCAL` maior depois
   dos 3 s não estende o relógio → 25P04 ×5 e o `aplica_v2` para. Mitigação: `transaction_timeout` próprio do inverso (≥ 30 s,
   ⌈5 × medido⌉) aplicado pelo `aplica_v2_inverso`; laço antes das travas exclusivas; o ensaio mede a volta com as OCs
   recebidas da cópia datadas; o `volta-producao.sh` mostra as OCs datadas e PARA sem folga de 5× antes da confirmação; o
   repasse depois do DROP TRIGGER fecha a janela que a ordem nova abriu (R9-b). A medição é numa transação DESFEITA: nenhum
   dado da cópia muda (retrato só-leitura antes = depois).
10. **Ruído no dia 1:** 48 OCs antigas acendem (D1); com a D6, as recebidas sem parcela a pagar também.
11. **Vencimento editado à mão** numa parcela não paga é sobrescrito ao mudar a data (já é hoje a cada save — D4).
12. **Data digitada errada** (ex.: ano trocado) move todos os vencimentos não pagos. Com a D7: futura ou anterior ao pedido é
    recusada no banco e no front; um erro dentro da faixa plausível segue possível — a prévia/Financeiro mostram na hora.

## 8. Verificação

- Unit: `tests/unit/nota-entrada.test.ts` (regra do alerta, provisória, base, payload, texto do aviso — D6, validação — D7).
- Integração (SÓ na cópia, `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` sempre explícito):
  `tests/integration/nota-entrada.test.ts` — por família, ACL, D7 (RPC e UPDATE direto), recusa da guarda de md5 (R2),
  round-trip do inverso, idempotência, "sem data = hoje" (modo `NOTA_MIG_TXN=1`, migration aplicada dentro da transação
  revertida, nunca `\i`; o harness exige as 2 travas logo depois do `BEGIN;`, tira-as da transação do teste e recusa DDL de
  policy — R9).
- Pré-voo da cópia (R4) antes de TODA rodada com DDL nela (`NOTA_MIG_TXN=1`, `copia.sh`): nenhum vitest/playwright rodando,
  nenhuma sessão ativa, dono avisado de que o `:5188` congela.
- Ensaio na cópia pelo `aplica_v2` (R3): ida → conferências (5 colunas, +2 | +8, ACL #9, 12 md5) → os 7 arquivos de integração
  antes/depois comparados por conjunto de falhas (R5) → volta
  pelo `aplica_v2_inverso`, com confirmação (0 OC datada) → cópia sem a Nota → **medição do laço numa transação DESFEITA
  (R9-b)**, entre dois retratos só-leitura que têm de sair iguais; medições em `volta-medida.txt` (nº de OCs, tempo da ida
  sem/com datas, tempo da volta, s por OC, tempo mínimo do inverso). Se o mínimo passar de 30 s, o inverso é regenerado com
  `--tt-inverso` e recommitado. A integração cobre o inverso com as 4 famílias datadas (Tecido, Aviamento, Insumo e P.
  Acabado, todas com NF ≠ base antiga: voltar à base antiga prova que o laço usou as funções já restauradas), confere a ordem
  do arquivo e o NOTICE do repasse.
- Gates: `tsc --noEmit`, `npm run build`, unit (sem falha nova), anti-drift de UI, arquivos só da lista permitida.
- QA na cópia: variante do app de teste na porta **5181** (já reservada pelo controlador na linha `case "$PORTA"` do
  `criar-variante.sh` — esta frente só CONFERE, nunca edita essa linha), guarda de rede invertida (qualquer `*.supabase.co`
  reprova), escritas simuladas + 1 fluxo real opcional com OK do dono.
- Produção: snapshot só-leitura antes; backup `pg_dump -n public` + `-n auth` pelo dono (receita provada — R2/B-R5); migration
  aplicada pelo dono no Terminal pelo `aplica_v2` (pré-voo: arquivos com as travas e sem policy, PG ≥ 17, F1 no banco — o
  Aviso NÃO é mais exigido aqui, ordem nova F1 → Nota → SKU → Aviso —, a Nota ausente, md5 de 24/set das funções E dos 2
  SQL revisados (R4), ATIV vazio); conferência só-leitura depois; referência nova da volta da F1 encadeada na mais nova por
  objeto (R1); ida na cópia junto com o merge (R8); portão do deploy (R7).

## 9. Fora de escopo

- Mudar o gerador/etapas do Importado; qualquer efeito da data no Importado além de registrar.
- Exigir a data para receber. (Validar a data futura/anterior ao pedido saiu daqui: é a D7, DECIDIDA pelo dono 24/set, e o plano
  implementa a recomendação.)
- Backfill de datas das OCs antigas (D1).
- Unificar o parser de prazo do P. Acabado (`/`) com o do core (regex) — divergência pré-existente.
- Recalcular para Insumo pelo botão do Financeiro (segue desabilitado, como hoje).
- `parcelas_servico` (Serviços) — não é OC; não é tocado.
- Regenerar `src/integrations/supabase/types.ts`.
- Mudar `realtime-invalidation-map.ts` e `erro-mensagem.ts`.

## 10. Decisões para o dono (fatos que o desenho não fechou — recomendação do planejador)

- **D1 — OCs antigas no dia 1.** Ao entrar no ar, as OCs já recebidas ficam sem data: na cópia (espelho de produção de
  23/set) são **48** (Tecido 46 — Ave Rara 38 —, Aviamento 1, Insumo 1), todas com parcela não paga ⇒ 48 bolinhas e as
  parcelas delas amarelas no Financeiro. **Recomendo (A): manter a regra como aprovada** (a equipe preenche aos poucos;
  preencher recalcula as não pagas). Alternativas: (B) data de corte — só alerta OC recebida a partir do dia da entrada no ar;
  (C) preencher as antigas com a data de entrega (não muda vencimento, mas inventa uma data de nota — não recomendo).
- **D2 — Importado sem alerta.** Como o Importado "só registra", os vencimentos dele não são provisórios. **Recomendo: sem
  bolinha, sem aviso e sem amarelo no Importado** (só o campo). Alternativa: bolinha + aviso "Falta a Data da Nota de
  Entrada" (sem "provisórios"), sem amarelo no Financeiro. O plano implementa a recomendação; trocar = 1 linha
  (`FAMILIAS_COM_ALERTA`).
- **D3 — Bolinha em "Encomendadas".** Com "alertar após o recebimento", a OC com bolinha está sempre em "Recebidas" (ao ser
  recebida ela sai de "Encomendadas"). Entrega parcial com a OC ainda Encomendada não acende. **Recomendo manter.**
- **D4 — Vencimento ajustado à mão.** Se alguém mudou à mão o vencimento de uma parcela NÃO paga no Financeiro, preencher ou
  mudar a data da nota recalcula e sobrescreve esse ajuste (hoje isso já acontece a cada Salvar da OC recebida). **Recomendo
  aceitar** (é o "recalcula as não pagas").
- **D5 — Amarelo no calendário.** No calendário do Financeiro o amarelo já quer dizer "vence em ≤ 3 dias". **Recomendo:** na
  lista, fundo amarelo + texto; no calendário, contorno tracejado amarelo + texto no toque/tooltip, sem trocar a cor do chip.
- **D6 — OC recebida toda paga ou de valor 0 acende a bolinha e o aviso? (decidido pelo dono 24/set)** Uma OC dessas não tem vencimento
  provisório, mas continua sem a data da nota. **Recomendo: acende**, com o texto **"Falta a Data da Nota de Entrada"** SEM
  "provisórios" (o aviso completo fica para a OC com parcela a pagar). O plano implementa isso (`textoAvisoFaltaNota` +
  `AvisoFaltaNota`, que conta as parcelas não pagas da OC). Alternativa: não acender — mas a lista não tem o dado de parcelas,
  então exigiria uma consulta por OC na lista ou um campo derivado no banco (task nova).
- **D7 — Data implausível (futura ou antes do pedido): validar? (decidido pelo dono 24/set)** Um ano trocado move todos os vencimentos
  não pagos. **Recomendo: validar** — não pode ser futura (> hoje no fuso da loja) nem anterior à data do pedido da OC; erro em
  PT; validada no SERVIDOR (gatilho `trg_nota_entrada_valida` nas 5 OCs, vale para RPC e UPDATE direto) E no front (calendário
  sem dia futuro + checagem no Salvar), com os mesmos textos (§4.4b). O plano implementa isso. Alternativa: não validar — sai a
  função/os 5 gatilhos (a migration volta a +1 | +3, a cópia a 459 | 266 e a volta da F1 a 428 | 222), o teste da D7 e as
  checagens do front.
