-- Inverso de 20261211100000_preco_permissao_atacado_gate_backfill: devolve fn_modelo_preco_venda_gate SEM o ramo de atacado
-- (= corpo da S1, 20261031120000, md5 e89be53c25f421724994e78b756a027d, copiado do vivo ANTES da ida - byte a byte).
-- O backfill NAO reverte (conceder acesso nao quebra); as linhas das 3 chaves novas ficam (inocuas sem o ramo). Dado nao volta sozinho.
-- Guarda: aceita a funcao no texto desta frente (2da90981f4d754de3e0a2c5e2c85a994) ou ja no da S1 (idempotente); qualquer outro = outra frente mexeu.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';

DO $guarda$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));
  IF v NOT IN ('2da90981f4d754de3e0a2c5e2c85a994', 'e89be53c25f421724994e78b756a027d') THEN
    RAISE EXCEPTION 'preco_atacado_gate_down: fn_modelo_preco_venda_gate com texto inesperado (md5 %) - outra frente mexeu', coalesce(v,'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

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

DO $pos$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.fn_modelo_preco_venda_gate()'::regprocedure));
  IF v IS DISTINCT FROM 'e89be53c25f421724994e78b756a027d' THEN
    RAISE EXCEPTION 'preco_atacado_gate_down: pos-condicao falhou (md5 %, esperado e89be53c25f421724994e78b756a027d)', coalesce(v,'ausente') USING ERRCODE = 'P0001';
  END IF;
END $pos$;
COMMIT;
