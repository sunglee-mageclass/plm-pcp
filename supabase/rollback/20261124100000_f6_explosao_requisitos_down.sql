-- Volta do F6 Fluxo 2 (NEUTRALIZA, sem trava): devolve salvar_config_loja e _enviar_modelo_para_cad_core aos corpos ANTERIORES
-- (troca EXATA reversa sobre o texto vivo, guardada por md5). A COLUNA tenant_config.explosao_requisitos FICA (inerte).
-- O DROP da coluna e o ..._down_drop.sql separado.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

-- 1) salvar_config_loja: reverte (tira 'explosao_requisitos' da lista branca, da validacao e do UPDATE). Guard por md5 "depois".
DO $troca$
DECLARE
  d text;
  v text;
  a text[];
  b text[];
  i int;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)')));
  IF v = '6d35eb844c03afebccdc110e970f46d0' THEN
    RETURN;  -- ja no corpo anterior (reaplicar e inofensivo)
  END IF;
  IF v IS DISTINCT FROM '36e6821ce97b3f2542cd3633c065a7a1' THEN
    RAISE EXCEPTION 'f6_explosao_down: salvar_config_loja nao esta no texto "depois" (md5 %); desfaca antes quem o redefiniu', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  -- ancoras do "depois" -> "antes" (as mesmas b/a da ida, invertidas)
  a := ARRAY[
    $x$    'tab_labels', 'campos_editaveis', 'insumos_padrao', 'aprovar_custo_auto_por_versao',
    'plan_tecido_oc_bloqueia_lancado', 'explosao_requisitos'];$x$,
    $x$      WHEN 'explosao_requisitos' THEN
        IF v_t = 'null' THEN
          RAISE EXCEPTION 'O campo "%" não pode ficar vazio.', v_k USING ERRCODE = 'P0001';
        ELSIF v_t <> 'array' THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
      WHEN 'revenda_kanban_colunas' THEN$x$,
    $x$                                           ELSE plan_tecido_oc_bloqueia_lancado END,
    explosao_requisitos = CASE WHEN v_m ? 'explosao_requisitos' THEN v_m -> 'explosao_requisitos' ELSE explosao_requisitos END
  WHERE tenant_id = v_tenant$x$];
  b := ARRAY[
    $x$    'tab_labels', 'campos_editaveis', 'insumos_padrao', 'aprovar_custo_auto_por_versao',
    'plan_tecido_oc_bloqueia_lancado'];$x$,
    $x$      WHEN 'revenda_kanban_colunas' THEN$x$,
    $x$                                           ELSE plan_tecido_oc_bloqueia_lancado END
  WHERE tenant_id = v_tenant$x$];
  d := pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'));
  FOR i IN 1..3 LOOP
    IF (length(d) - length(replace(d, a[i], ''))) / length(a[i]) <> 1 THEN
      RAISE EXCEPTION 'f6_explosao_down: ancora % nao aparece exatamente 1x em salvar_config_loja', i USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR i IN 1..3 LOOP
    d := replace(d, a[i], b[i]);
  END LOOP;
  EXECUTE d;
  IF md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'))) IS DISTINCT FROM '6d35eb844c03afebccdc110e970f46d0' THEN
    RAISE EXCEPTION 'f6_explosao_down: salvar_config_loja nao voltou ao md5 anterior' USING ERRCODE = 'P0001';
  END IF;
END
$troca$;

-- 2) _enviar_modelo_para_cad_core: revertido pela Task 2 (bloco ACRESCENTADO abaixo).

NOTIFY pgrst, 'reload schema';
COMMIT;
