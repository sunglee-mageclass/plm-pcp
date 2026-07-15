# TAG/Etiquetas como material completo — Design

Status: aprovado (jul/2026). Expande a etiqueta (hoje só nome+tamanho, consumida só no CAD)
para material completo, no padrão **Aviamento**, com a novidade de **variantes tamanho × cor**.
Objetivo principal: **explosão de materiais** (BOM) + compra/estoque/financeiro.

## Modelo de dados

- **`etiquetas`** (estende): `unidade` (`unidade|metro|rolo|milheiro`, configurável),
  `empresa_id`+`representante_id` (fornecedor, `FornecedorSelect`), `preco` base, `observacoes`,
  `foto_url`. A coluna `tamanho` vira LEGADA (variantes substituem).
- **`variantes_etiqueta`** (nova): matriz `(etiqueta_id, tamanho, cor_id)` + `preco` por variante.
  `tamanho` da grade da loja (`tenant_config.tamanhos_grade`); `cor_id` → `cores`.
  Preço: base replica → variante editável → **base = MAX(variantes)** (trigger, igual artigo/tecido).
- **`modelo_etiquetas`** (nova, espelha `modelo_aviamentos`): `modelo_id, etiqueta_id, cor_id,
  numero, consumo, loss_percent, custo_previsto`. **Cor escolhida no modelo**; **tamanho vem da grade**.
- **`cad_etiquetas`** (já existe): consumo + qtd a enviar, agora por (tamanho × cor).
- **`ocs_etiqueta` + `ocs_etiqueta_itens`** (novas, espelham `ocs_aviamento`): item = variante
  (tamanho×cor) + quantidade + preço + `quantidade_recebida`; fornecedor na OC.
- **Estoque**: fonte única por RPC (recebido − baixa), padrão `estoque_aviamento`.
- **Financeiro**: OC de etiqueta gera `parcelas` (a pagar), igual `ocs_aviamento`.

## Regras / decisões travadas

- Variante = **tamanho × cor** no cadastro; o **modelo escolhe a cor**, o **tamanho vem da grade**
  (não se escolhe tamanho no modelo). Explosão = Σ(grade por tamanho × consumo) → qtd por (tamanho, cor).
- Custo do modelo usa o preço da variante da cor escolhida, regra **maior** (igual tecido).
- Unidades: `unidade | metro | rolo | milheiro`.

## Seleção (Desenvolvimento → CAD) — decisão travada

- **Desenvolvimento (Fase 1c):** escolhe **etiqueta + cor + consumo/peça** (modelo_etiquetas).
- **CAD (Fase 1d):** as etiquetas vêm do Desenvolvimento; o **tamanho explode AUTOMÁTICO pela
  grade** — 1 linha por tamanho da grade, `qtd = grade(tamanho) × consumo`, usando a variante
  (aquele tamanho, cor escolhida). NÃO se seleciona variante por variante (é a explosão de
  materiais). Formato "Nenhum" (sem tamanho) = 1 linha só: `qtd = grade total × consumo`.
- Formato do tamanho da etiqueta (`etiquetas.formato_tamanho`: ambos|numero|letra|nenhum) só
  muda a EXIBIÇÃO; a variante guarda o tamanho completo da grade ("34|PPP").
- Edge: se a etiqueta (na cor escolhida) não tiver variante p/ algum tamanho da grade, avisar
  e cair no preço/base (a definir na Fase 1d).

## Faseamento

- **Fase 1** — cadastro rico + `variantes_etiqueta` + `modelo_etiquetas` (BOM/explosão) + CAD por
  tamanho×cor. (schema → cadastro UI → Desenvolvimento → CAD)
- **Fase 2** — OC de etiqueta (`ocs_etiqueta`) + estoque.
- **Fase 3** — financeiro (parcelas da OC de etiqueta).

Cada fase: migration aplicada+testada (txn) + tsc/build + suíte + push.
