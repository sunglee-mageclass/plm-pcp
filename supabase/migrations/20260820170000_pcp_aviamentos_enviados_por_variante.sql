-- FF#2 (ago/2026): PCP "aviamentos enviados" POR VARIANTE.
--
-- `producao_terceirizados.aviamentos_enviados` (jsonb) guardava um array de aviamento_id
-- (string) — não distinguia a VARIANTE (cor) do aviamento. Um aviamento com 2+ variantes no
-- BOM ficava indistinguível na seleção do PCP. O formato novo é um array de objetos
-- {aviamento_id, variante_aviamento_id} (variante null = aviamento inteiro / sem variante).
--
-- O valor é gravado OPACAMENTE por `salvar_terceirizados` (jsonb do cliente) e nenhuma outra
-- função no banco lê o conteúdo — então NÃO há mudança de função aqui, só a migração de dado.
--
-- Conversão idempotente do legado → novo: cada ELEMENTO string vira
-- {aviamento_id: <string>, variante_aviamento_id: null} (sem perda; entrada antiga = variante
-- única/NULL). Só toca linhas que ainda têm ao menos um elemento string (reaplicável à vontade).
BEGIN;

UPDATE public.producao_terceirizados pt
SET aviamentos_enviados = (
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(el.value) = 'string'
          THEN jsonb_build_object('aviamento_id', el.value, 'variante_aviamento_id', NULL)
        ELSE el.value
      END
      ORDER BY el.ord
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(pt.aviamentos_enviados) WITH ORDINALITY AS el(value, ord)
)
WHERE jsonb_typeof(pt.aviamentos_enviados) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(pt.aviamentos_enviados) AS e(value)
    WHERE jsonb_typeof(e.value) = 'string'
  );

COMMIT;
