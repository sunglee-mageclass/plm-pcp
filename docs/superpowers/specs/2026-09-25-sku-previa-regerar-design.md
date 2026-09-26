# SKU: Regerar em PRÉVIA — especificação

**Data:** 25/set/2026 · **Status:** desenho para o G-plano (decisões do dono P-46/P-47 TRAVADAS) · **Campanha:** Planejamento
unificado + Kanban automático (mini-frente depois da reorganização do Sheet, ANTES do deploy — P-47 A) · **Worktree:**
`.claude/worktrees/sku-previa`, branch `sku/previa-regerar`, base `06d40485` (ponta da `feature/plan-tecido-a1` com a
reorganização juntada; a migration `20261005100000` está em PRODUÇÃO e na cópia).

Piloto da regra "nada grava antes do Salvar" (memória `feedback_staging_nada_grava_antes_salvar`).

## 1. Objetivo

Na seção **"4. Códigos"** do Sheet do Planejamento, o botão **"Regerar SKUs"** e o **SKU editado à mão** deixam de gravar NA
HORA. Os dois passam a produzir uma **PRÉVIA** no rascunho do card, marcada **"a gravar"**, que o **Salvar** grava. **Voltar
/ Descartar** jogam a prévia fora e os SKUs gravados ficam como estavam.

A prévia é calculada pelo **SERVIDOR**, por uma função **SÓ LEITURA** que usa as MESMAS funções da geração real
(`_skus_modelo_calc` → `_sku_resolver`/`_sku_montar`, com o Formato normalizado por `_sku_config_normaliza`). Ela recebe o
que ainda não está salvo: a REF e o "Tamanho em" do rascunho e os SKUs digitados à mão. Não há espelho TS da geração.

## 2. Decisões do dono (25/set, TRAVADAS)

| # | Decisão (verbatim/resumo) |
|---|---|
| P-46 | *"o botão regerar deveria pelo menos mostrar como fica, e com isso, se usuário decidir cancelar, não perderia o dado antigo"*. O "Regerar SKUs" e o SKU editado à mão (seção "4. Códigos" do Sheet do Planejamento) deixam de gravar na hora (hoje são RPC imediata): viram PRÉVIA no rascunho, marcada "a gravar", e só gravam no SALVAR do card. Voltar/Descartar mantém os SKUs antigos. |
| "Backend intermediário" | A prévia é calculada pelo SERVIDOR, por uma função SÓ LEITURA que usa as MESMAS funções da geração real (`_skus_modelo_calc`/`_skus_modelo_core`/`_sku_config_normaliza`), recebendo o que ainda não está salvo (REF, "Tamanho em" do rascunho) e sem gravar nada. A prévia é idêntica à gravação. Nada de espelho TS da regra de geração. |
| — | Trocar o "Tamanho em" ou a REF e já poder "Regerar" (em prévia) SEM salvar antes. Hoje o botão trava com "Salve o card antes de regerar". |
| P-47 A | Entra ANTES do deploy. |
| — | É o piloto da regra "nada grava antes do Salvar". A frente própria "Camada intermediária / staging" (prioridade ALTA, logo depois do deploy) mapeia o resto. |

Continuam valendo as decisões do SKU (spec `2026-09-24-sku-automatico-design.md` §2): Q1 (gerado automático, mas editável),
Q2 (fixo depois de gerado; só muda pelo Regerar; o editado à mão nunca é sobrescrito), Q4/D4 (falta sigla / apelido), D5
(réplica com a mesma REF divide o SKU) e a F3.6/P-25 ("Tamanho em" sem padrão da loja; nasce em Letra).

## 3. Estado atual (levantado em 25/set, só leitura — worktree e cópia `127.0.0.1:54422`)

- **Tela** `src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx`:
  - `draftSujoParaRegerar` (:104) trava o Regerar quando a REF/o "Tamanho em" do rascunho ≠ o salvo (título "Salve o card
    antes de regerar", :151);
  - o Regerar abre um `AlertDialog` (:254-267) e chama `gerar_skus_modelo(_, true)` NA HORA (`useSkusModelo.ts:33-46`);
  - o SKU digitado grava no blur pela RPC imediata `salvar_sku_manual` com `_rev_base` (`SkuCampo`, :36-70;
    `useSkusModelo.ts:47-59`);
  - hint do rodapé (:250): "… 'Regerar SKUs' pede confirmação e nunca muda os editados à mão.".
- **1ª geração**: `aoSalvar` (`PlanejamentoDetail.tsx:838`) chama `skus.gerarSeFaltar()` depois de TODO Salvar de card
  existente; gera (`_regerar=false`) só se a matriz fresca tem `status ok`, `tamanho_tipo_card` e NENHUM SKU gravado
  (`deveGerarPrimeiraVez`, `sku-card.ts:167-170` — Ruling R12 da reorganização).
- **Salvar do card** (`usePlanejamentoSave.ts`): UPDATE direto em `modelos` com `.eq("rev")` (P0409 → retry com merge
  3-vias) + BOM/CAD/MO; no fim, `onSuccess` chama `onSaved()` SEM esperar (`:809`). O payload nasce de `{...d}` (o Draft
  inteiro): campo novo no `Draft` iria para o UPDATE de `modelos`.
- **"Não salvo"**: `dirty = draftDirty || MO ≠ base || gradeRevendaDirty || ficha.dirty` (`PlanejamentoDetail.tsx:644`).
- **Colaboração**: o canal `colab:modelo:<id>` escuta UPDATE em `modelos` e invalida `["plan-skus", id]` (:907-918).
  `modelo_skus` NÃO está na publicação do Realtime (conferido: `pg_publication_tables` vazio) — mudança de SKU de outra
  pessoa não chega sozinha à tela.
- **Banco (texto VIVO da cópia = produção, pós-`20261005100000`)**:
  - `_skus_modelo_calc(uuid)` (STABLE DEFINER, md5 `56c3c480…`) — CÁLCULO PURO, mas lê `mo.ref` e `mo.tamanho_tipo` do
    próprio card salvo;
  - `_skus_modelo_core(uuid)` (STABLE DEFINER, md5 `f77fddb7…`) — a matriz com estado por linha (`ok|manual|falta|
    pendente|divergente|conflito|vazio|orfa`), também lendo REF/"Tamanho em" salvos;
  - `_gerar_skus_modelo_core(uuid,boolean)` (VOLATILE DEFINER, md5 `5f523d3d…`) — MISTURA decisão e escrita: trava
    `sku_modelo:<id>`, DELETE das automáticas órfãs, laço INSERT/UPDATE que descobre os conflitos pelo `unique_violation`
    do gatilho `fn_modelo_skus_unico` (estado do banco EM EVOLUÇÃO: a ordem do laço decide trocas A↔B e cadeias);
  - `_salvar_sku_manual_core` (VOLATILE) — SKU à mão com `_rev_base`; `_sku_guarda(tenant, editar)` — login, módulo
    `criacao`, loja, `criacao_planejamento` ver/editar;
  - `modelo_skus`: RLS `tenant_select` (PERMISSIVE) + 3 modgate RESTRICTIVE de escrita; cliente só SELECT; 0 linhas na
    cópia; `sku_config` NULL em todas as lojas da cópia;
  - contagem funções|gatilhos da cópia: **484|277**.
- **Corrida pré-existente B-M8** (backlog do G-migration da reorganização): o `_gerar_skus_modelo_core` lê o "Tamanho em"
  depois da trava, mas `_skus_modelo_calc` o relê a cada chamada.

## 4. Desenho

### 4.1 Banco (migration `20261005110000_sku_previa_regerar`, só FUNÇÕES — nenhuma DDL de tabela/policy)

#### 4.1.1 Separar a DECISÃO da ESCRITA: o plano puro

A geração de hoje decide e escreve no mesmo laço. Para a prévia usar "as MESMAS funções", a decisão sai para uma função
**pura** e a escrita vira um **executor** que só aplica o plano. A prévia roda o plano; a gravação roda **o mesmo plano** e
o executa.

| Função | Tipo | Papel |
|---|---|---|
| `_skus_calc_ref_tipo(_modelo_id uuid, _ref text, _tipo text)` | NOVA · STABLE DEFINER · `RETURNS TABLE` igual à de `_skus_modelo_calc` | O corpo VIVO de `_skus_modelo_calc` com 3 trocas exatas: o nome/assinatura, `mo.ref AS mref` → `_ref AS mref` e `mo.tamanho_tipo AS mtipo` → `_tipo AS mtipo`. Variantes, grade, siglas, Formato: tudo do SALVO, como hoje. |
| `_skus_matriz_ref_tipo(_modelo_id uuid, _ref text, _tipo text)` | NOVA · STABLE DEFINER · `jsonb` | O corpo VIVO de `_skus_modelo_core` com 3 trocas exatas: o nome/assinatura, a leitura de `_sku_norm_ref(mo.ref)`/`mo.tamanho_tipo` → `_sku_norm_ref(_ref)`/`_tipo`, e a chamada do cálculo → `_skus_calc_ref_tipo(_modelo_id, _ref, _tipo)`. |
| `_skus_plano(_modelo_id, _ref, _tipo, _manuais jsonb, _modo text)` | NOVA · STABLE DEFINER · `jsonb` | **A decisão, fonte ÚNICA.** Reproduz o laço da F3.5a/F3.6 em memória (estado do card em evolução + checagem estática contra os outros cards, com a regra da réplica D5) e devolve as ops, o estado final e a assinatura (§4.1.3). |
| `_skus_executar_plano(_modelo_id, _tenant, _plano jsonb, _estrito boolean)` | NOVA · VOLATILE DEFINER | **A escrita, única.** Aplica as ops na ordem. `unique_violation` (outra transação gravou no meio): `_estrito` ⇒ P0409 e tudo desfeito; senão vira conflito (comportamento de hoje da geração). |
| `_skus_assinatura(_linhas jsonb)` | NOVA · IMMUTABLE sql · `text` | md5 do estado final `[[variante_key, tamanho_key, sku, manual], …]` em ordem canônica (`COLLATE "C"`). Assina a prévia e confere a gravação. |
| `_skus_previa_core(_modelo_id, _ref, _tipo, _manuais, _modo)` | NOVA · STABLE DEFINER | Matriz (`_skus_matriz_ref_tipo`) + o plano por linha (`previa`) + a assinatura. |
| `skus_previa(_modelo_id uuid, _ref text, _tamanho_tipo text, _manuais jsonb, _modo text)` | NOVA · RPC · STABLE DEFINER | Wrapper da prévia (§4.1.3). |
| `_aplicar_skus_modelo_core(_modelo_id, _manuais, _modo, _assinatura)` | NOVA · VOLATILE DEFINER | Grava a prévia vista (§4.1.4). |
| `aplicar_skus_modelo(_modelo_id uuid, _manuais jsonb, _modo text, _assinatura text)` | NOVA · RPC · VOLATILE DEFINER | Wrapper do Salvar. |
| `_skus_modelo_calc(uuid)` | REDEFINIDA (delegadora) | `SELECT c.* FROM modelos mo CROSS JOIN LATERAL _skus_calc_ref_tipo(mo.id, mo.ref, mo.tamanho_tipo) c WHERE mo.id = _modelo_id` — mesmo resultado de antes (provado na suíte). |
| `_skus_modelo_core(uuid)` | REDEFINIDA (delegadora) | `RETURN _skus_matriz_ref_tipo(_modelo_id, <ref salva>, <tamanho_tipo salvo>)` — mesmo resultado; modelo inexistente segue "Modelo não encontrado.". |
| `_gerar_skus_modelo_core(uuid, boolean)` | REDEFINIDA | Trava `sku_modelo:<id>` → lê REF/"Tamanho em" UMA vez, sob a trava → `_skus_plano(…, '[]', 'regerar'|'criar')` → `_skus_executar_plano(…, false)` → matriz + `{criados, atualizados, removidos, conflitos}`. Mesmo contrato e mesmo resultado da F3.6 (provado cenário a cenário, §6); fecha a corrida B-M8 (o cálculo não relê o card). |

**Nomes** fora dos prefixos `_sku_` e `_skus_modelo_` de propósito: o teste de volta da F3.5a
(`sku-automatico.test.ts`, regex `^(_sku_|_skus_modelo_|…)`) segue contando 23 funções.

**Diff nas funções vivas** (3 redefinidas, geradas do texto VIVO com guarda md5 — molde da reorganização):
- `_skus_calc_ref_tipo`/`_skus_matriz_ref_tipo` = o texto vivo com SÓ as âncoras trocadas (cada âncora 1×; o gerador PARA
  se não achar);
- as 2 delegadoras: o corpo inteiro vira uma chamada (assinatura, `RETURNS`, volatilidade e `proacl` iguais — `CREATE OR
  REPLACE` preserva o ACL);
- `_gerar_skus_modelo_core`: corpo novo (plano + executor), mesma assinatura/retorno/volatilidade/ACL.

`skus_modelo`, `gerar_skus_modelo`, `salvar_sku_manual`, `_salvar_sku_manual_core`, `_sku_guarda`, `_sku_resolver`,
`_sku_montar`, `_sku_config_normaliza` e o gatilho `fn_modelo_skus_unico` NÃO mudam. O front antigo (antes do merge)
segue funcionando com o banco novo (mesmas RPCs, mesmo resultado).

#### 4.1.2 O plano (`_skus_plano`) — regras

Entrada: REF e "Tamanho em" DADOS (rascunho na prévia; os SALVOS, lidos sob a trava, na gravação), `_manuais`
(`[{variante_key, tamanho_key, sku, rev}]`, cru do rascunho) e `_modo`:
- `'manuais'` — só os SKUs à mão (o usuário não pediu Regerar);
- `'regerar'` — os SKUs à mão + o Regerar;
- `'criar'` — a 1ª geração (`gerar_skus_modelo(_, false)`).

Passos (o mesmo laço de hoje, em memória):
1. **SKUs à mão primeiro**, na ordem das chaves (`COLLATE "C"`), com as MESMAS regras e mensagens de
   `_salvar_sku_manual_core`:
   - normaliza por `_sku_norm_manual` (inválido/vazio = erro P0001 com a mensagem dele);
   - sem linha gravada e fora da grade = "Esta variante/tamanho não está na grade do produto.";
   - `rev` enviado ≠ `rev` gravado = P0409 `conflito_versao: o SKU foi alterado por outra pessoa`;
   - já é esse SKU e já à mão = nada;
   - SKU de outra linha deste card (estado EM EVOLUÇÃO) = "O SKU X já está em outra linha deste produto.";
   - SKU de outro card que não é réplica = "O SKU X já existe em N (REF R). Escolha outro.";
   - ok ⇒ op `manual` (vira `manual=true` no Salvar).
2. **`'regerar'`**: as automáticas FORA da grade saem ANTES (op `remover`); manual nunca sai.
3. **`'criar'`/`'regerar'`** (só com Formato, REF e "Tamanho em" — senão não gera nada, como hoje): cada linha da grade
   na ordem `(variante_ordem, tamanho_ordem, tamanho_key, variante_key)`:
   - manual nunca muda;
   - sem SKU (falta sigla/vazio) fica como está;
   - `'criar'` só cria o que falta; `'regerar'` recalcula as automáticas;
   - SKU que já é de OUTRA linha deste card (estado em evolução) ou de outro card que não é réplica = conflito, não grava
     (mensagens da F3.5a, inclusive "… colide com outra deste produto que também muda de SKU neste Regerar …");
   - ok ⇒ op `inserir`/`atualizar`.

Saída:

```json
{ "status": "ok|sem_formato|aguardando_ref|sem_tamanho", "modo": "…",
  "ops": [ {"op": "manual|remover|inserir|atualizar|conflito", "id", "vkey", "tkey", "sku", "rev_base", "mensagem"} ],
  "linhas": { "<vkey>|<tkey>": {"acao": "manual_novo|sai|novo|muda|conflito|erro", "sku_de", "sku_para", "mensagem", "code"} },
  "erros": [ {"variante_key", "tamanho_key", "code": "P0001|P0409", "mensagem", "sku_atual", "rev_atual"} ],
  "conflitos": [ {"variante_key", "tamanho_key", "sku", "com_modelo_id", "com_nome", "com_ref", "mensagem"} ],
  "final": [ ["<vkey>", "<tkey>", "<sku>", true|false] ], "assinatura": "<md5>",
  "criados": 0, "atualizados": 0, "removidos": 0, "manuais": 0 }
```

#### 4.1.3 A prévia (`skus_previa`) — contrato

- `skus_previa(_modelo_id, _ref, _tamanho_tipo, _manuais, _modo)`:
  - guarda `_sku_guarda(tenant, true)` — login, módulo `criacao`, loja e **editar** o Planejamento (a prévia só existe para
    quem pode gravar);
  - valida `_tamanho_tipo ∈ {letra, numero, NULL}`, `_modo ∈ {manuais, regerar, criar}`, `_ref` ≤ 200 caracteres e ≤ 1000
    SKUs à mão (bem formados, sem chave repetida);
  - **STABLE**: o PL/pgSQL recusa INSERT/UPDATE/DELETE dentro dela, e o PostgREST executa função STABLE em transação READ
    ONLY. Só leitura por construção.
- Retorno = a matriz de `skus_modelo` calculada com a REF/"Tamanho em" DADOS (mesmos campos, mesmos estados) + por linha
  `previa: {acao, sku_de, sku_para, mensagem, code} | null` (`null` = a linha não muda no Salvar) + `modo`, `assinatura`,
  `erros`, `conflitos`, `criados`, `atualizados`, `removidos`, `manuais`.
- **Estado de cada linha na tela** (o que o dono pediu: novo, igual, divergente, manual mantido, sai):

  | Situação | De onde vem | Texto |
  |---|---|---|
  | **novo** | `previa.acao = novo` | "novo · a gravar" |
  | **muda** (divergente regerado) | `previa.acao = muda` | "muda de X · a gravar" |
  | **sai** (automática fora da grade) | `previa.acao = sai` | "sai no Salvar" (SKU riscado) |
  | **à mão, a gravar** | `previa.acao = manual_novo` | "editado à mão · a gravar" |
  | **não grava (conflito)** | `previa.acao = conflito` | "não será gravado — <mensagem do servidor>" |
  | **erro no digitado** | `previa.acao = erro` | a mensagem do servidor; P0409 = "Outra pessoa mudou este SKU para X — o seu (Y) ainda não foi gravado." + "manter o meu" · "usar o novo" |
  | **igual** | estado `ok` | "igual" |
  | **manual mantido** | estado `manual` | "editado à mão — mantido" |
  | **divergente sem Regerar** | estado `divergente` | "Regerar muda para X" (como hoje) |
  | **falta sigla** | estado `falta` | "Falta sigla: …" + "cadastrar" (+ " (mantém X)" se já há SKU gravado) |
  | **a gerar** / **fora da grade** / **vazio** | estados `pendente`/`orfa`/`vazio` | como hoje |

#### 4.1.4 A gravação EXATA da prévia (`aplicar_skus_modelo`)

Roda no Salvar do card, DEPOIS do UPDATE do modelo (a REF e o "Tamanho em" do rascunho já estão salvos). Sob a trava
`sku_modelo:<id>` (a mesma de gerar/editar; ordem `sku_modelo → linha → sku_unico`, sem deadlock):

1. relê REF/"Tamanho em" SALVOS e refaz **o mesmo** `_skus_plano(…, _manuais, _modo)`;
2. erro num SKU à mão ⇒ RAISE com a MESMA mensagem da prévia (P0001; `rev` velho = P0409) — nada grava;
3. `_assinatura` (a da prévia vista) ≠ a do plano de agora ⇒ **P0409** `previa_desatualizada` — nada grava. Pega: outra
   pessoa gerou/editou SKU, mudou sigla/Formato/grade, a REF salva não é a da prévia (ex.: o gatilho da REF automática), ou
   a grade/tecidos do rascunho mudaram no mesmo Salvar;
4. executa as ops em modo ESTRITO (SKU gravado por outra transação no meio ⇒ P0409, tudo desfeito);
5. **pós-conferência**: a assinatura do que ficou gravado = a da prévia, senão P0409 e tudo desfeito.

Ou seja: o que vai para o banco é, por construção, o que o usuário viu. Qualquer diferença vira P0409, a tela mostra a
prévia nova e pede outro Salvar. Os conflitos com outros cards que a prévia mostrou ("não será gravado") seguem não
gravando, como no Regerar de hoje: não bloqueiam o resto.

#### 4.1.5 Segurança (invariante #9)

- Os 7 internos novos + as 3 redefinidas: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (dos TRÊS). As
  redefinidas mantêm o `proacl` `{postgres=X/postgres,service_role=X/postgres}`.
- As 2 RPCs: `REVOKE … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated` (molde da F3.5a).
- Loja/módulo/permissão: `_sku_guarda` no wrapper; os `_core` filtram pelo `_modelo_id` e pela loja do modelo (a
  checagem entre cards usa `o.tenant_id = <loja do modelo>`).
- A prévia aceita uma REF arbitrária, mas só para CALCULAR o próprio card, e revela só o que `skus_modelo` já revela
  (conflitos da própria loja). A gravação NUNCA usa REF/"Tamanho em" vindos do cliente: usa os salvos.

#### 4.1.6 Migration e volta

- `supabase/migrations/20261005110000_sku_previa_regerar.sql` + `supabase/rollback/20261005110000_sku_previa_regerar_down.sql`,
  GERADOS por `.superpowers/sku-previa/mig/gerar_sql.py` a partir do dump SÓ LEITURA do texto vivo, no molde da
  reorganização:
  - `SET client_encoding = 'UTF8'` como 1ª instrução, antes do `BEGIN`;
  - `BEGIN` + `SET LOCAL lock_timeout = '500ms'` + `SET LOCAL transaction_timeout = '3s'`;
  - `$guarda$`: md5 EXATO das 3 redefinidas ∈ {texto vivo de 25/set, texto desta migration}; as 9 novas ausentes ou no
    texto desta migration;
  - funções; REVOKE/GRANT; `$acl$` com `has_function_privilege`;
  - `$pos$`: md5 das 12 = o esperado, antes do COMMIT — qualquer divergência (ex.: `client_encoding`) desfaz tudo;
  - `NOTIFY pgrst, 'reload schema'` antes do `COMMIT`.
- **Sem DDL de tabela nem de policy** (o hook `supautils.policy_grants` não dispara; nada de ACCESS EXCLUSIVE em
  `modelos`/`tenant_config`). Contagem: **+9 funções, +0 gatilhos** (484|277 → 493|277).
- Inverso: guarda → as 3 voltam ao texto vivo byte a byte → `DROP FUNCTION IF EXISTS` das 9 → `$acl$` → `$pos$` → NOTIFY →
  COMMIT. Não mexe em dado (os SKUs gravados ficam). LIFO: voltar a reorganização ou a F3.5a DEPOIS desta frente exige
  voltar esta antes (a guarda da reorganização recusa as 3 com outro texto).

### 4.2 Front

#### 4.2.1 "A gravar" fica FORA do `Draft`

Estado próprio `SkusAGravar = { regerar: boolean; manuais: Record<"vkey|tkey", {varianteKey, tamanhoKey, sku, id, rev}> }`,
num hook `useSkusAGravar()` do orquestrador. É o mesmo padrão das linhas de MO: rascunho paralelo ao `Draft`, com baseline
próprio.

Por que fora do `Draft`:
- o payload do Salvar espalha o `Draft` inteiro no UPDATE de `modelos` (§3), e campo novo lá cairia com PGRST204;
- o `resetDraftBaseline` do Salvar do modelo não pode apagar a prévia se a gravação dos SKUs falhar.

Consequências:
- **"não salvo"**: `dirty` do Sheet ganha `|| !nadaAGravar(aGravar)` — o selo âmbar "alterações não salvas" e a guarda de
  saída valem para a prévia;
- **Voltar/Descartar**: o `useUnsavedGuard` pede "Descartar alterações?"; ao descartar, o Sheet desmonta, a prévia some e
  os SKUs gravados ficam;
- **"Desfazer prévia"**: botão no aviso da seção, esvazia o "a gravar" sem mexer no resto do card;
- **↺ por linha**: desfaz um SKU digitado.

#### 4.2.2 A prévia na tela

- Hook `useSkusModelo` ganha a query `["plan-skus-previa", modeloId, <entrada>]` → RPC `skus_previa`, habilitada só com
  algo "a gravar" e com permissão de editar. `<entrada>` = JSON estável de `[REF, "Tamanho em", modo, manuais ordenados]`.
  O cliente não refaz a regra de geração: só guarda a entrada e mostra o que o servidor devolveu.
  - `placeholderData` mantém a última prévia enquanto a nova chega ("Calculando a prévia…");
  - a entrada é atrasada 300 ms (digitação da REF).
- **REF da prévia**: a do rascunho (aparada) quando ela vai no Salvar (`refEditavel`); senão a salva — a mesma regra de
  `aplicarRegrasCamposDev`. **"Tamanho em"**: o do rascunho (vai sempre no payload).
- **Fail-closed**: `status`/`acao` desconhecidos ou assinatura inválida = "situação desconhecida" e o Salvar NÃO grava os
  SKUs.
- A tabela mostra a matriz da PRÉVIA quando há algo "a gravar"; senão, a gravada (`skus_modelo`), como hoje.
- Linha "a gravar" com fundo `bg-[var(--tone-warning-bg)]` + `StatusBadge tone="warning"`.
- Aviso no topo da tabela (`role="status"`): *"Prévia — nada foi gravado ainda. Os SKUs só mudam quando você clicar em
  Salvar; Voltar ou Descartar mantém os atuais."* + botão **"Desfazer prévia"**.
- Com a grade/tecidos do rascunho ainda não salvos (`ficha.dirty || gradeRevendaDirty`): *"A grade ou os tecidos têm
  alterações não salvas: a prévia usa a grade salva e é conferida de novo no Salvar."* (Ruling R4).

#### 4.2.3 Regerar em prévia

- Clique ⇒ `aGravar.regerar = true` ⇒ a prévia aparece. **Sem AlertDialog**: a prévia é a confirmação e nada grava sem o
  Salvar (Ruling R3).
- Fica habilitado com REF/"Tamanho em" digitados e não salvos. Desabilitado, com o motivo no `title`, quando:
  - não pode editar;
  - a matriz não carregou;
  - o status é desconhecido;
  - a loja não tem o Formato do SKU;
  - a REF da prévia está vazia;
  - o Regerar já está na prévia.
- `title` padrão: "Mostra como ficam os SKUs — só o Salvar grava."

#### 4.2.4 SKU à mão em rascunho

- No blur/Enter, o texto é normalizado pelo espelho JÁ existente `normalizarSkuManual` (anti-drift com `_sku_norm_manual`
  desde a F3.5a — é validação de campo, não regra de geração):
  - inválido ⇒ toast com a mensagem e o campo volta ao que mostrava;
  - igual ao que a linha MOSTRA (o digitado, o que o plano grava ou o gravado) ⇒ nada;
  - senão ⇒ entra "a gravar" com o `id`/`rev` da linha.
- O servidor confere tudo de novo na prévia (unicidade, grade, rev) e no Salvar.
- `data-colab-path={`sku:${variante}:${tamanho}`}` continua (presença).

#### 4.2.5 Salvar: modelo PRIMEIRO, depois os SKUs

`usePlanejamentoSave` passa a ESPERAR o `onSaved` (`onSuccess` async, `await onSaved()`). O botão Salvar fica "salvando"
até os SKUs terminarem, e um 2º clique não dispara 2 gravações.

`aoSalvar`:

```ts
const aoSalvar = async () => {
  setEditandoDev(false);
  onSaved();
  if (!isEdit) return;
  const r = await skus.aplicarAGravar();          // "nada" | "ok" | "falhou" — nunca lança
  if (r !== "falhou") await skus.gerarSeFaltar();  // 1ª geração automática (D1)
};
```

`aplicarAGravar`:
- sem nada "a gravar" = "nada";
- prévia ausente, calculando, com entrada ≠ a atual ou sem assinatura ⇒ toast *"A prévia dos SKUs ainda estava sendo
  calculada — o card foi salvo, os SKUs não. Confira a prévia e clique em Salvar de novo."*, fica "a gravar";
- erro na prévia ⇒ toast com a mensagem, fica "a gravar";
- senão `aplicar_skus_modelo(_modelo_id, manuais, modo, assinatura)`:
  - **ok** ⇒ esvazia o "a gravar" (só se ele não mudou durante o voo) + toast *"SKUs gravados: N novo(s), M
    atualizado(s), K removido(s), J à mão."* (conflitos ⇒ toast de erro com a 1ª mensagem do servidor);
  - **P0409** ⇒ toast *"Os SKUs mudaram desde a prévia (outra pessoa gerou ou editou, ou mudou sigla, Formato ou grade). A
    prévia foi atualizada — confira e clique em Salvar de novo. O card já foi salvo."*, fica "a gravar";
  - **outro erro** ⇒ *"O card foi salvo, mas os SKUs não foram gravados: <mensagem>"*, fica "a gravar";
  - sempre invalida `["plan-skus", id]` e `["plan-skus-previa", id]`.

Erro no modelo (P0409 do card, BOM…): o `onSuccess` não roda, os SKUs não são tentados, a prévia fica. O retry do P0409
do card, quando dá certo, chega ao `onSuccess` e aí os SKUs gravam (com a conferência da assinatura).

**Enviar à Explosão** (`salvarAntes`): o mesmo Salvar, então grava a prévia também.

#### 4.2.6 Colaboração

- Outra pessoa **salva o card** (UPDATE em `modelos`): o canal invalida `plan-skus` e agora também `plan-skus-previa`; o
  merge 3-vias do `Draft` pode trazer a REF/"Tamanho em" dela (se eu não mexi), a entrada muda e a prévia se recalcula.
- Outra pessoa **gera ou edita SKU** (só `modelo_skus`, sem Realtime):
  - a prévia se refaz no foco da janela (padrão do TanStack);
  - no Salvar, a assinatura pega a diferença ⇒ P0409 + prévia nova;
  - o SKU que eu digitei numa linha que ela mudou aparece em erro P0409 com "manter o meu" (o meu passa a valer contra a
    versão dela — `rev` novo) ou "usar o novo" (tira o meu).
- Presença: os inputs mantêm `data-colab-path` `sku:<variante>:<tamanho>`.
- Realtime de `modelo_skus` (publicação) fica FORA (DDL em publicação de produção sem necessidade — a garantia é no Salvar).

#### 4.2.7 Só leitura

Sem `canEdit("criacao_planejamento")`:
- o Regerar fica desabilitado ("Sem permissão para editar os SKUs.") e os inputs ficam travados;
- nada entra "a gravar" e a prévia nunca é chamada (o servidor recusa `skus_previa` sem editar);
- quem só vê continua vendo a matriz gravada.

A trava pós-Explosão do Dev NÃO se aplica ao SKU (spec do SKU §4.2; R29 da reorganização).

#### 4.2.8 Selo e textos

- Selo da seção "Códigos" com prévia: `{ tone: "warn", texto: "prévia a gravar" }` (vence os outros).
- Hint do rodapé (troca): *"As variantes vêm do Tecido 1 (seção Tecidos) e os tamanhos, da Grade. Formato: REF - cor base
  + apelido + tamanho (Config da Loja › Formato do SKU). 'Regerar SKUs' mostra a prévia e só o Salvar grava; os editados à
  mão nunca mudam."*
- Demais textos da seção (REF, "Tamanho em", estados legados) ficam como na reorganização.

### 4.3 1ª geração automática pós-Salvar

**Proposta (D1, recomendação A): continua AUTOMÁTICA no Salvar**, pelo mesmo `gerar_skus_modelo(_, false)` — agora
executado pelo plano (`'criar'`).
- Ela só CRIA linhas num card sem nenhum SKU: não há dado antigo a perder, que é o motivo da P-46.
- Acontece DENTRO do Salvar que o usuário pediu, o que respeita "nada grava antes do Salvar".
- Cobre o caso em que a REF nasce DURANTE o Salvar (REF automática revelada pela etapa ou pelo kanban automático), que
  nenhuma prévia anterior veria.
- Quem quiser ver antes clica em "Regerar SKUs": num card sem SKU, a prévia mostra tudo "novo · a gravar".

Alternativa B (se o dono preferir): a tabela de um card sem SKU mostra sempre a prévia `'criar'` e o Salvar grava pela
assinatura. O banco já aceita `'criar'` nas 2 RPCs. Custo: ~1 task pequena de front.

## 5. Rulings (custo se errado)

| # | Ruling | Por quê | Custo se errado |
|---|---|---|---|
| R1 | Plano PURO + executor único; a geração vira plano+executor (redefine `_gerar_skus_modelo_core`) | Só assim a prévia usa, literalmente, as mesmas funções da gravação. Um "simulador" separado derivaria do laço, e a pós-conferência viraria "prévia mudou" em loop em trocas A↔B/cadeias/órfãs | Redefinir 1 função viva a mais: coberta pela equivalência cenário a cenário (§6) e pela suíte inteira da F3.5a rodando contra ela |
| R2 | REF/"Tamanho em" por PARÂMETRO (2 funções novas com o corpo vivo + trocas) e as 1-arg viram delegadoras | Um corpo só; "diff mínimo" auditável; fecha a B-M8 | Se o dono não quiser tocar as 1-arg: cópias com as trocas + teste de igualdade (2 corpos para manter) |
| R3 | Regerar SEM AlertDialog | A prévia É a confirmação; nada grava sem o Salvar | Recolocar o diálogo: ~10 linhas |
| R4 | A prévia usa variantes/grade SALVAS; com grade/tecidos sujos, aviso + conferência no Salvar (P0409 → prévia nova → 2º Salvar) | Aceitar a grade do rascunho exigiria mandar o BOM (ids, grade por variante, comprado) à função: escopo grande | Um Salvar a mais quando a grade E o Regerar mudam juntos. Evoluir depois = parâmetros novos com default |
| R5 | "A gravar" FORA do `Draft` (hook próprio, como as linhas de MO) | O payload espalha o `Draft`; e o `resetDraftBaseline` do Salvar do modelo não pode apagar a prévia se os SKUs falharem | Nenhum |
| R6 | Salvar: modelo primeiro; SKUs no `onSaved` AGUARDADO (`onSuccess` async); falha nos SKUs não desfaz o modelo, a prévia fica "a gravar" com o "não salvo" aceso | A REF/"Tamanho em" precisam estar salvos para a gravação exata; tudo numa transação só exigiria mexer no Salvar inteiro (UPDATE direto + BOM + MO) | Estado intermediário "card salvo, SKUs não" — visível e resolvível com outro Salvar |
| R7 | Assinatura = md5 do ESTADO FINAL (não das ops); conferida antes E depois de executar | Mudança irrelevante (ex.: outro gerou o mesmo valor) não barra; qualquer diferença do que foi visto barra | Nenhum |
| R8 | `skus_previa` exige EDITAR (não só ver) | A prévia só existe para quem grava; menor privilégio | Nenhum (quem só vê não tem o que pré-visualizar) |
| R9 | `salvar_sku_manual` (imediata) FICA no banco, sem chamador no front novo | Remover é DROP em produção sem ganho agora; a frente "Camada intermediária" decide | Uma RPC de gravação imediata ainda exposta (mesma guarda de sempre) |
| R10 | Conflito com OUTRO card na prévia não bloqueia o Salvar (a linha "não será gravado", como o Regerar de hoje); erro no SKU DIGITADO bloqueia os SKUs (o card salva) | Mesma semântica da F3.5a; o digitado é uma escolha explícita do usuário | Nenhum |
| R11 | Sem Realtime de `modelo_skus` | Garantia no Salvar (assinatura) + refazer no foco | A prévia fica velha até o foco/Salvar — nunca grava errado |
| R12 | Mensagens P0409 do servidor com prefixos `previa_desatualizada:`/`conflito_versao:`; o front troca pelo texto do SKU (não o genérico do `erro-mensagem.ts`) | O genérico fala de "registro" e "tela atualizada" | Nenhum |
| R13 | Migration só de FUNÇÕES: N3 da cópia com AVISO no painel (P-30 B); o `n3.sh` segue recusando com sessão ativa/vitest | Sem ACCESS EXCLUSIVE em tabela, o :5188 não congela | Nenhum |

## 6. Testes

- **Unit** (`tests/unit/sku-previa.test.ts`, novo): as regras puras do "a gravar" (`digitarSku`, `skuExibido`,
  `comRegerar`, `semManual`, `manterMeu`, `manuaisParaRpc` ordenado, `chaveEntradaPrevia` estável, `refParaPrevia`,
  `lerPrevia` fail-closed, `situacaoPrevia` por ação, `resumoAplicacao`, `mensagemAplicarSkus` P0409, `podeRegerar`).
  `tests/unit/planejamento-codigos.test.ts` atualizado: sem AlertDialog, sem "Salve o card antes de regerar", sem
  `salvar_sku_manual` no front, `aoSalvar` async com `aplicarAGravar` antes de `gerarSeFaltar`, `dirty` com o "a gravar",
  invalidação de `plan-skus-previa`, hint novo, selo "prévia a gravar".
- **Integração SÓ na cópia** (`tests/integration/sku-previa.test.ts`, novo; modo `SKU_PREVIA_MIG_TXN=1` aplica a migration
  dentro da txn; sem a variável exige a migration viva). Cobre:
  - **estático**: arquivos gerados, travas, encoding, NOTIFY, sem DDL de tabela/policy, guardas md5 = os textos, âncoras 1×;
  - **equivalência VELHO × NOVO** (só com a variável): o mesmo cenário roda na função viva, SAVEPOINT/ROLLBACK, aplica a
    migration e roda na nova, e resultado + estado gravado são iguais. Cenários:
    - 1ª geração com falta/aviso;
    - Regerar divergente;
    - manual preservado;
    - órfã removida;
    - órfã que LIBERA o SKU para outra linha;
    - falta que mantém o gravado;
    - conflito com outro card;
    - réplica;
    - troca A↔B;
    - cadeia em ordem direta e em ordem inversa;
    - `sem_formato`/`aguardando_ref`/`sem_tamanho`;
    - `skus_modelo` idêntico antes/depois;
  - **anti-drift PRÉVIA ≡ GRAVAÇÃO**: em cada cenário, a prévia com o rascunho ≠ salvo; o UPDATE do modelo simula o
    Salvar; `aplicar_skus_modelo` com a assinatura da prévia grava EXATAMENTE o `final` da prévia;
  - **só leitura**: `skus_previa` roda com `SET LOCAL transaction_read_only = on`; volatilidades `s`/`i`; estado gravado
    igual antes/depois;
  - **P0409**:
    - outra pessoa edita/gera depois da prévia;
    - `rev` velho num SKU digitado;
    - assinatura nula/lixo;
  - **erros PT** (duplicado em outro card / na mesma linha / fora da grade);
  - **permissões e ACL** (login → módulo → loja → editar; `_core` fechados dos 3; RPCs só `authenticated`);
  - **inverso**: round-trip e idempotência; as 3 voltam byte a byte; os SKUs gravados ficam.
- **Vizinhas**:
  - `sku-automatico.test.ts`: a suíte inteira da F3.5a roda contra a geração nova (prova de regressão, sem mudar o
    arquivo);
  - `sheet-reorg-campos.test.ts` aprende a prévia viva:
    - o texto esperado das 3 passa a ser o desta migration;
    - no modo `SHEET_MIG_TXN=1`, o inverso da prévia roda dentro da txn antes da migration da reorganização (LIFO).
- **QA** no `:5173` (DEPOIS do merge; o `:5173` grava em PRODUÇÃO — D2):
  - trocar "Tamanho em" e Regerar sem salvar ⇒ prévia; Descartar ⇒ nada mudou (leitura `begin transaction read only`);
  - SKU à mão + ↺; Regerar + Salvar ⇒ gravado = prévia;
  - 2 abas: B edita e salva no meio ⇒ A recebe P0409 e a prévia nova;
  - mobile 360/390 sem estouro.

## 7. Produção

- Ordem:
  1. a migration em PRODUÇÃO, pelo DONO, pelo `ida-producao.sh`: pré-voo só leitura + backup `public`+`auth` + `aplica_v2`
     + conferências;
  2. `ref-volta-f1.sh` (referência nova `pos_sku_previa` da volta de emergência da F1);
  3. merge do front na `feature/plan-tecido-a1` JUNTO com `copia.sh ida`;
  4. QA no `:5173`;
  5. deploy (P-47 A: antes do deploy geral).
- O front antigo convive com o banco novo; o front novo NÃO roda sem o banco novo (RPCs novas). Por isso o banco vai
  antes do merge.
- Volta de emergência: SÓ com OK do dono, DEPOIS de tirar do ar o front que chama `skus_previa`/`aplicar_skus_modelo`.
  Não apaga dado.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| O plano em memória diverge do laço antigo | Equivalência cenário a cenário na mesma txn + a suíte inteira da F3.5a contra a geração nova; pós-conferência na gravação |
| Texto canônico das funções novas ≠ o `pg_get_functiondef` (espaço/linha) | `$pos$` confere md5 e desfaz; a suíte em txn pega antes do ensaio; correção mínima registrada em `desvios.md` |
| Prévia velha (outro usuário) | Assinatura no Salvar + refazer no foco; nunca grava o que não foi visto |
| 2 Salvar seguidos (grade e prévia mudando juntas) | Aviso na seção (R4); comportamento determinístico |
| Card salvo e SKUs não (erro no meio) | Toast explícito + "não salvo" aceso + prévia mantida |
| LIFO das voltas (prévia → reorganização → F3.5a) | Guardas md5 recusam fora de ordem; RODAR e memória dizem a ordem |

## 9. Fora de escopo

- Grade/variantes do rascunho na prévia (R4).
- Realtime de `modelo_skus` (R11).
- Remover `salvar_sku_manual` (R9).
- As outras gravações imediatas (Observações do bloco, comentários da Prova, aprovar MO, "Mover para…"): frente
  "Camada intermediária / staging".
- "Tamanho em" nos cards do Plan. Tecido/Produto Acabado/Importado (frente D2).

## 10. Dúvidas que só o dono responde

| # | Pergunta | Recomendação |
|---|---|---|
| D1 | A 1ª geração (card sem nenhum SKU) continua automática no Salvar, ou também vira prévia? | **A — continua automática** (só cria, nada se perde; acontece no próprio Salvar; "Regerar" mostra antes para quem quiser) |
| D2 | QA no `:5173` = PRODUÇÃO: pode gravar SKU (Regerar confirmado e 1 SKU à mão) no card de teste combinado ("Blusa Teste", P-44), deixando resíduo listado antes? E, se a Loja Teste não tiver o Formato do SKU em produção, pode configurá-lo para a QA? | **Sim ao resíduo listado**; Formato só se já não existir, com o texto combinado no painel |
| D3 | Precisa de mockup da prévia (aviso + "a gravar" + ↺) antes da tela? | **Não** — mudança pequena dentro do layout aprovado; textos travados aqui; a QA mostra no `:5173` |
