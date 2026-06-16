# Prompt p/ Lovable — Múltiplas OCs por variante + OCs previstas + alerta de cobertura

> **Já aplicado direto no Supabase próprio em 16/06/2026** (migration
> `20260616120000_oc_multiplas_previstas.sql`). Este texto fica só para, **se/quando
> você quiser**, colar no Lovable e manter o ambiente dele alinhado. Não é
> obrigatório rodar.

Cole o texto abaixo no chat do Lovable. Ele só mexe no **banco** (tabela + 3 funções).

---

No Desenvolvimento, hoje cada variante de tecido só pode ser vinculada a **uma**
OC, e a função `ocs_disponiveis_variante` só lista OCs já recebidas e esconde as
que ficaram com saldo 0. Quero mudar para:

1. Uma variante pode ser coberta por **mais de uma OC** (ex.: usa a sobra de uma
   e completa com outra). A alocação é **automática por saldo** (consome o saldo
   de cada OC na ordem escolhida) e gravamos quantos metros saem de cada OC.
2. As **OCs previstas** (ainda não recebidas) também aparecem e podem ser usadas
   como **plano** — contam na cobertura, mas a baixa física só ocorre quando a OC
   for recebida.
3. Nunca esconder uma OC por saldo: mostrar todas (recebidas e previstas), com o
   saldo disponível, para o front avisar se a cobertura é suficiente ou não.

Faça as alterações de banco abaixo (numa migration nova):

### 1) Tabela `modelo_tecido_oc_links`
- Remover a constraint `UNIQUE (modelo_id, tipo, numero, ordem)`.
- Adicionar coluna `quantidade_m numeric NOT NULL DEFAULT 0` (metros alocados
  desta OC para esta variante).
- Adicionar coluna `prioridade int NOT NULL DEFAULT 1` (ordem de consumo das OCs
  dentro da mesma variante).
- Adicionar `UNIQUE (modelo_id, tipo, numero, ordem, oc_tecido_item_id)` (a mesma
  OC não se repete na mesma variante).
- Manter o preenchimento de `tenant_id` como já é hoje (trigger/contexto).

### 2) Função `ocs_disponiveis_variante(_variante_id uuid, _modelo_id uuid)`
Reescrever para retornar **todas** as OCs (recebidas e previstas) daquela
variante no tenant, **sem** filtrar por saldo > 0 e **sem** exigir
`status = 'recebido'`. Cada item do array deve ter:
- `oc_tecido_item_id`
- `numero_pedido`
- `data_entrega`
- `recebida` (boolean: `oc.status = 'recebido'`)
- `disponivel_m` (numeric), calculado assim:
  - base em metros = se kg: `quantidade * rendimento`, senão `quantidade`,
    onde **quantidade** = `quantidade_recebida` quando a OC é recebida, e
    `quantidade_pedida` quando é prevista;
  - menos as baixas físicas (`SUM(quantidade)` de `estoque_tecido_baixas` da OC)
    — só relevante para recebidas;
  - menos a soma de `quantidade_m` dos vínculos de **outros** modelos
    (`modelo_tecido_oc_links` com `oc_tecido_item_id` = este item e
    `modelo_id <> _modelo_id`), **exceto** modelos que já foram ao CAD e baixaram
    estoque (manter a condição `NOT EXISTS (cad + estoque_tecido_baixas)` que já
    existe hoje, para não contar reserva em dobro).
- Ordenar por `recebida DESC, data_entrega NULLS LAST, created_at`.
- Retornar inclusive itens com `disponivel_m <= 0` (o front decide o alerta).

### 3) Função `salvar_modelo_bom`
O array `oc_links` de cada tecido agora traz **vários** objetos por `ordem`, no
formato `{ ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade }`.
Atualizar o INSERT em `modelo_tecido_oc_links` para gravar também `quantidade_m`
e `prioridade`. Continuar apagando os vínculos do modelo antes de reinserir.

### 4) Função `baixar_estoque_tecido_corte(_cad_id)`
Na confirmação do CAD, em vez de procurar **um** `oc_tecido_item_id` vinculado por
(modelo, tipo, numero, ordem, variante), percorrer **todos** os vínculos daquela
variante **ordenados por `prioridade`** e, para cada um, dar baixa de
`LEAST(restante, quantidade_m, saldo físico via saldo_oc_item_m)` com
`origem = 'vinculo'`, abatendo do restante. Vínculos cuja OC ainda não foi
recebida terão saldo físico 0 e são naturalmente ignorados. O restante continua
sendo consumido por FIFO como já é hoje.

Não precisa migrar dados antigos (os vínculos atuais podem ficar com
`quantidade_m = 0` / `prioridade = 1`).
