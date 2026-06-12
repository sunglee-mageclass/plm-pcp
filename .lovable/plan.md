## Objetivo
Adicionar rastreabilidade de estoque **por OC** (lote) sobre o estoque geral atual, mantendo as fórmulas existentes intactas.

## Desenho de Banco

### 1. Vínculo OC ↔ Desenvolvimento (reserva manual)
Nova tabela ligando a variante escolhida no Modelo a uma OC específica:

```text
modelo_tecido_variante_ocs
  id                          uuid PK
  tenant_id                   uuid
  modelo_tecido_variante_id   uuid FK → modelo_tecido_variantes(id) ON DELETE CASCADE
  oc_tecido_item_id           uuid FK → ocs_tecido_itens(id)         -- lote (OC+variante)
  quantidade_reservada        numeric  -- opcional; default = consumo planejado da variante
  created_at, updated_at
  UNIQUE (modelo_tecido_variante_id)   -- 1 vínculo por variante do modelo
```

> Vínculo a nível de `ocs_tecido_itens` (não de `ocs_tecido`) porque o lote real é "OC + variante". A UI mostra "OC #123" mas grava o item.

### 2. Baixa real por OC (consumido no corte)
Nova tabela de movimentos de baixa, escrita quando o CAD envia ao corte. Substitui o cálculo "sobra = Σrecebido − Σenviado" por algo rastreável por OC:

```text
estoque_tecido_baixas
  id                          uuid PK
  tenant_id                   uuid
  cad_tecido_variante_id      uuid FK → cad_tecido_variantes(id) ON DELETE CASCADE
  oc_tecido_item_id           uuid FK → ocs_tecido_itens(id)        -- de qual lote saiu
  variante_tecido_id          uuid                                  -- denormalizado p/ query
  quantidade                  numeric                               -- em metros
  origem                      text   -- 'vinculo' | 'fifo'
  created_at
  INDEX (variante_tecido_id), INDEX (oc_tecido_item_id)
```

Uma única baixa do CAD pode gerar **N linhas** (consome do lote vinculado; se não chega, completa com FIFO de outras OCs da mesma variante).

### 3. Sem mudança em `ocs_tecido_itens`
Saldo por OC é **derivado**, nunca persistido:
```
recebido(item) = quantidade_recebida (m equivalentes)
baixado(item) = Σ estoque_tecido_baixas.quantidade WHERE oc_tecido_item_id = item.id
reservado(item) = Σ modelo_tecido_variante_ocs.quantidade_reservada
                  WHERE oc_tecido_item_id = item.id E o modelo ainda não foi cortado
sobra(item) = recebido − baixado − reservado
```

## Lógica de Baixa (no envio ao corte)
RPC `baixar_estoque_tecido_corte(cad_id)`:
1. Para cada `cad_tecido_variantes` com `metragem_enviada > 0`:
   a. Buscar vínculo manual via `modelo_tecido_variante_ocs` (join cad→modelo→modelo_tecido_variantes).
   b. Consumir do lote vinculado até a metragem ou até esgotar saldo do lote (`origem='vinculo'`).
   c. Restante: FIFO por `ocs_tecido.data_entrega ASC, created_at ASC` entre lotes da mesma variante com `sobra > 0` (`origem='fifo'`).
   d. Inserir uma ou mais linhas em `estoque_tecido_baixas`.
2. Idempotente: se já houver baixas para aquele `cad_tecido_variante_id`, não duplicar (deletar e recriar, ou checar existência).

Estoque geral da variante = soma sobre todos os itens — mantém o resultado já exibido.

## Mudanças de UI

### Desenvolvimento (`ModeloTecidosSection`)
Para cada variante selecionada:
- Novo `Select` "Vincular OC (opcional)" listando OCs recebidas com saldo > 0 daquela variante, formato: `OC #123 · entrega 12/06/2026 · 50m disponíveis`.
- Opção "Sem vínculo (FIFO no corte)".
- Salva/atualiza `modelo_tecido_variante_ocs`.

### Estoque (`entrada-saida.estoque.tsx`)
- Linha da variante vira expansível (chevron).
- Ao expandir, query de detalhamento por OC mostrando colunas:
  `OC #N | Recebido | Baixado | Reservado | Sobra`, ordenado por data de entrega.

## Pontos de atenção
- **Migração de dados existentes**: criar uma baixa retroativa por CAD já enviado ao corte aplicando o mesmo FIFO, para que a UI de detalhamento mostre histórico coerente desde o início. Sem isso, OCs antigas aparecem com "Baixado: 0".
- **Cancelar envio ao corte**: hoje a baixa é implícita; ao introduzir tabela explícita, "des-enviar" deve apagar as linhas de `estoque_tecido_baixas` correspondentes.
- **Unidade**: lotes em Kg precisam ser convertidos para metros equivalentes (`quantidade_recebida × rendimento`) tanto na exibição de saldo quanto na baixa, para casar com `metragem_enviada` que está em metros.
- **Aviamento**: mesmo padrão é aplicável, mas fora do escopo deste pedido (que falou só de tecido).

## Entregáveis da implementação (após aprovar este desenho)
1. Migration: 2 tabelas + GRANTs + RLS + índices + RPC `baixar_estoque_tecido_corte` + RPC `detalhe_estoque_variante(variante_id)` para a UI de estoque + backfill FIFO dos CADs já cortados.
2. UI Desenvolvimento: select de vínculo por variante.
3. UI Estoque: expansão por OC.
4. Integrar a chamada da RPC no fluxo de "enviar ao corte" do CAD (substituindo/complementando a baixa implícita).
