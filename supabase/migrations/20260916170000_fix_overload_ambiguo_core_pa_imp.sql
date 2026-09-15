-- FIX (regressão introduzida em 20260916150000/20260916160000): ambiguidade de overload.
--
-- Ao adicionar `_rev_base integer DEFAULT NULL` ao `_salvar_oc_p_acabado_core`/`_salvar_oc_importado_core`,
-- criei um SEGUNDO overload (o de N+1 args com default) SEM remover o de N args. Resultado: os
-- WRAPPERS VELHOS (salvar_oc_p_acabado 3-arg / salvar_oc_importado 4-arg) chamam o `_core` com N
-- args, que agora casa AMBOS os overloads (o de N args E o de N+1 com _rev_base no default) →
-- "function _salvar_..._core(...) is not unique". Isso quebrou o botão "Fazer pedido/OC" nos cards
-- de Produto Acabado (ProdutoCard.tsx) e Importado (ProdutoImportadoCard.tsx), que usam esses
-- wrappers velhos. (Achado por teste transacional antes de qualquer uso em prod do Importado; o
-- P.Acabado já foi deployado com o defeito, este fix corrige.)
--
-- Correção: DROPAR o `_core` de assinatura ANTIGA (menos args). O `_core` novo com
-- `_rev_base DEFAULT NULL` atende os DOIS wrappers — a chamada de N args cai no default NULL
-- (= bypass da trava, comportamento retrocompatível idêntico ao antigo) e a de N+1 args passa o
-- rev_base. Sem ambiguidade: sobra 1 único candidato.

BEGIN;

-- Produto Acabado: remove o _core de 3 args (o novo é o de 4 com _rev_base DEFAULT NULL).
DROP FUNCTION IF EXISTS public._salvar_oc_p_acabado_core(uuid, jsonb, jsonb);

-- Produto Importado: remove o _core de 4 args (o novo é o de 5 com _rev_base DEFAULT NULL).
DROP FUNCTION IF EXISTS public._salvar_oc_importado_core(uuid, jsonb, jsonb, jsonb);

COMMIT;
