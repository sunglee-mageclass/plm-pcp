-- Permissao propria do preco de venda (varejo) e do preco de atacado, independente de custos.
-- (1) fn_modelo_preco_venda_gate ganha o ramo preco_atacado (simetrico ao varejo; GUC primeiro - nao morde o recompute derivado).
--     EXTENSAO CIRURGICA do gatilho existente (S1 / 20261031120000): o corpo e o vivo, byte a byte, com UM bloco inserido antes do
--     ramo "S5 preco anterior"; nenhuma outra regra mudou. O arquivo da S1 NAO e alterado.
-- (2) Backfill das 4 chaves (user_permissions + papel_permissoes, ON CONFLICT DO NOTHING) - ninguem perde acesso:
--       criacao_planejamento:preco_venda        (EDITAR varejo - ja existe; nada a conceder)
--       criacao_planejamento:ver_preco_venda    (VER varejo)   <- quem hoje ve preco (qualquer das 5 chaves de _pode_ver_custos)
--       criacao_planejamento:ver_preco_atacado  (VER atacado)  <- idem
--       criacao_planejamento:preco_atacado      (EDITAR atacado) <- quem hoje edita preco_venda OU criacao_produto_acabado
-- VER (varejo/atacado) NAO e trancado no banco (D1 A): so a exibicao na tela respeita as chaves novas.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_modelo_preco_venda_gate()
--     ANTES  e89be53c25f421724994e78b756a027d   (= DEPOIS da S1, 20261031120000)
--     DEPOIS 2da90981f4d754de3e0a2c5e2c85a994
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION) + INSERTs em user_permissions/papel_permissoes (RowExclusive). Sem DDL de tabela,
-- sem DROP, sem CREATE TRIGGER/POLICY (nada em auth/storage). Idempotente (guarda aceita antes OU depois; ON CONFLICT DO NOTHING).
-- Volta: supabase/rollback/20261211100000_preco_permissao_atacado_gate_backfill_down.sql (devolve o corpo da S1; o backfill FICA).
-- Reaplicar a S1 (20261031120000) depois desta: a guarda da S1 so aceita antes 4eeb8baa... ou e89be53c... - rode o _down desta antes.
-- Aplicar fora de transacao de teste: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

-- Pre-condicao: a funcao e o "depois" da S1 (ou ja o desta frente, idempotencia)
DO $guarda$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));
  IF v NOT IN ('e89be53c25f421724994e78b756a027d', '2da90981f4d754de3e0a2c5e2c85a994') THEN
    RAISE EXCEPTION 'preco_atacado_gate: fn_modelo_preco_venda_gate com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v,'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- (1) Gatilho: ramo NOVO de preco_atacado, simetrico ao varejo
CREATE OR REPLACE FUNCTION public.fn_modelo_preco_venda_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- [seg s1] sem JWT (migration/psql) e service_role = manutencao do sistema: as regras NOVAS abaixo nao mordem.
  v_sistema boolean := auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('authenticated', 'anon');
BEGIN
  -- Só morde para origem INTERNA (o preço de revenda/importado é derivado no servidor — o recompute
  -- definer muda `preco_venda` mas roda com o JWT de quem RECEBE a OC / salva markups, que não tem
  -- esta section). Origem comprada nunca é editável por cliente no card/Sheet (front já bloqueia).
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND COALESCE(NEW.origem, 'interno') NOT IN ('revenda', 'importado')
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'Sem permissão para editar o preço de venda'
      USING ERRCODE = '42501';
  END IF;
  -- [seg s1 B1b] comprado (revenda/importado): o preco de venda e DERIVADO (markup x custo, ou o preco fixo do produto) - so
  -- muda pelo recalculo do servidor (_pa_/_imp_recomputar_precos_modelo ligam app.preco_comprado_sistema). PATCH direto = 42501.
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND COALESCE(NEW.origem, 'interno') IN ('revenda', 'importado')
     AND coalesce(current_setting('app.preco_comprado_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'preco_comprado_derivado: o preco de venda do comprado vem do markup ou do preco fixo do produto'
      USING ERRCODE = '42501';
  END IF;
  -- [preco permissao] EDITAR atacado: a GUC do recompute derivado vem PRIMEIRO (nao morde _pa_/_imp_recomputar_precos_modelo, que
  -- mudam preco_atacado com o JWT de quem recebe a OC / salva markups); v_sistema (migration/psql/service_role) passa; so o PATCH
  -- direto do cliente exige a chave criacao_planejamento:preco_atacado. ASCII (a tela traduz por codigo).
  IF NEW.preco_atacado IS DISTINCT FROM OLD.preco_atacado
     AND coalesce(current_setting('app.preco_comprado_sistema', true), '') <> 'on'
     AND NOT v_sistema
     AND NOT public.user_can_edit('criacao_planejamento:preco_atacado') THEN
    RAISE EXCEPTION 'Sem permissao para editar o preco de atacado'
      USING ERRCODE = '42501';
  END IF;
  -- [seg s1 S5] Preco anterior (vai ao ERP) = a MESMA secao do preco de venda (criacao_planejamento:preco_venda), qualquer
  -- origem (a tela ja omite o campo sem a secao). Escrita feita DENTRO de outro gatilho (pg_trigger_depth > 1 - ex.: o
  -- congelamento ao excluir uma versao, fn_modelo_versao_congelar_aplicar) e do sistema; nao e do cliente.
  IF NEW.preco_anterior IS DISTINCT FROM OLD.preco_anterior
     AND pg_trigger_depth() <= 1
     AND NOT v_sistema
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'preco_anterior_sem_permissao: sem permissao para editar o preco anterior' USING ERRCODE = '42501';
  END IF;
  -- [seg s1 M2] Enviado a Explosao (enviado_cad) so muda pelas RPCs do sistema (Enviar a Explosao, Voltar ao
  -- Desenvolvimento, excluir CAD), que ligam app.explosao_sistema='on'. PATCH direto pulava o gate de etapa (ou desfazia a
  -- Explosao). ASCII (tela: erro-mensagem.ts).
  IF NEW.enviado_cad IS DISTINCT FROM OLD.enviado_cad
     AND coalesce(current_setting('app.explosao_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'explosao_protegida: o envio a Explosao so muda pelos botoes Enviar a Explosao / Voltar ao Desenvolvimento'
      USING ERRCODE = '42501';
  END IF;
  -- [seg s1 M2] Ordem de Criacao nao e cancelada (true -> false) com o card ja na Explosao (a tela ja recusa: Fix m1).
  IF OLD.ordem_criacao_enviada IS TRUE AND NEW.ordem_criacao_enviada IS NOT TRUE
     AND (coalesce(OLD.enviado_cad, false) OR coalesce(NEW.enviado_cad, false))
     AND coalesce(current_setting('app.explosao_sistema', true), '') <> 'on'
     AND NOT v_sistema THEN
    RAISE EXCEPTION 'ordem_com_explosao: o card ja foi enviado a Explosao - a Ordem de Criacao nao pode ser cancelada'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;

-- (2) BACKFILL (ON CONFLICT DO NOTHING; espelho de 20260908280000 / 20261103195000)
-- VER varejo + VER atacado -> a quem HOJE ve preco (QUALQUER das 5 chaves de _pode_ver_custos com pode_ver=true).
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT up.user_id, up.tenant_id, nova.k, true, false
FROM public.user_permissions up
CROSS JOIN (VALUES ('criacao_planejamento:ver_preco_venda'), ('criacao_planejamento:ver_preco_atacado')) AS nova(k)
WHERE up.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos',
                    'producao_terceirizados:precos','dashboard_custos','dashboard_comercial')
  AND up.pode_ver = true
ON CONFLICT (user_id, pagina) DO NOTHING;

INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT pp.papel_id, pp.tenant_id, nova.k, true, false
FROM public.papel_permissoes pp
CROSS JOIN (VALUES ('criacao_planejamento:ver_preco_venda'), ('criacao_planejamento:ver_preco_atacado')) AS nova(k)
WHERE pp.pagina IN ('criacao_planejamento:custos','criacao_desenvolvimento:custos',
                    'producao_terceirizados:precos','dashboard_custos','dashboard_comercial')
  AND pp.pode_ver = true
ON CONFLICT (papel_id, pagina) DO NOTHING;

-- EDITAR atacado -> a quem HOJE edita atacado (criacao_planejamento:preco_venda OU criacao_produto_acabado, pode_editar=true).
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT up.user_id, up.tenant_id, 'criacao_planejamento:preco_atacado', true, true
FROM public.user_permissions up
WHERE up.pagina IN ('criacao_planejamento:preco_venda','criacao_produto_acabado')
  AND up.pode_editar = true
ON CONFLICT (user_id, pagina) DO NOTHING;

INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT DISTINCT pp.papel_id, pp.tenant_id, 'criacao_planejamento:preco_atacado', true, true
FROM public.papel_permissoes pp
WHERE pp.pagina IN ('criacao_planejamento:preco_venda','criacao_produto_acabado')
  AND pp.pode_editar = true
ON CONFLICT (papel_id, pagina) DO NOTHING;

-- Pos-condicao: a funcao ficou no texto desta frente
DO $pos$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));
  IF v IS DISTINCT FROM '2da90981f4d754de3e0a2c5e2c85a994' THEN
    RAISE EXCEPTION 'preco_atacado_gate: pos-condicao falhou (md5 %, esperado 2da90981f4d754de3e0a2c5e2c85a994)', coalesce(v,'ausente') USING ERRCODE = 'P0001';
  END IF;
END $pos$;
COMMIT;
