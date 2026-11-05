-- Inverso de 20261110100000_explosao_rpc_unica: remove a RPC unica e os 3 _core.
-- As 3 RPCs estreitas (salvar_explosao_metragem / _aviamento_separar / _etiqueta_enviar) e baixar_estoque_tecido_corte NUNCA foram
-- tocadas pela ida, entao a tela velha volta a funcionar sozinha. Volta: SITE primeiro (o site novo chama salvar_explosao), depois este arquivo.
-- Ordem: a RPC (que chama os _core) antes dos _core. So objetos criados pela ida; nenhum dado e tocado.
BEGIN;
SET LOCAL lock_timeout = '1500ms';
DROP FUNCTION IF EXISTS public.salvar_explosao(uuid,jsonb,jsonb,jsonb,integer,boolean);
DROP FUNCTION IF EXISTS public._salvar_explosao_etiqueta_enviar_core(uuid,jsonb);
DROP FUNCTION IF EXISTS public._salvar_explosao_aviamento_separar_core(uuid,jsonb);
DROP FUNCTION IF EXISTS public._salvar_explosao_metragem_core(uuid,jsonb);
COMMIT;
