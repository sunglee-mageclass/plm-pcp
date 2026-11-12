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

-- 2) _enviar_modelo_para_cad_core: tira o gate F6 (troca EXATA reversa sobre o texto vivo). Guard: so reverte se o vivo TEM o gate.
DO $troca_core$
DECLARE
  d text;
  a text;
  b text;
BEGIN
  d := pg_get_functiondef(to_regprocedure('public._enviar_modelo_para_cad_core(uuid,text,text)'));
  IF position('explosao_requisito_faltando' IN d) = 0 THEN
    RETURN;  -- ja sem o gate (reaplicar e inofensivo)
  END IF;
  -- do "depois" (com o gate) para o "antes": remove o bloco F6 inteiro, deixando so o gate de etapa.
  a := $x$  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;

  -- F6 Fluxo 2 (Bloco B) — requisitos CONFIGURAVEIS do Enviar a Explosao. OPT-IN: lista vazia pula tudo.
  -- Gate SO dos configurados (a lista fixa REF/nome/etc. segue so no front). Modulo desligado = satisfeita
  -- (o avaliador ja aplica _kanban_cond_na). Recusa ASCII P0001.
  DECLARE
    v_reqs jsonb;
    v_cond jsonb;
    v_faltando text;
  BEGIN
    SELECT explosao_requisitos INTO v_reqs FROM public.tenant_config WHERE tenant_id = v_tenant;
    IF v_reqs IS NOT NULL AND jsonb_typeof(v_reqs) = 'array' AND jsonb_array_length(v_reqs) > 0 THEN
      v_cond := COALESCE(public._avaliar_condicoes_kanban_core(v_tenant, ARRAY[_modelo_id]) -> _modelo_id::text, '{}'::jsonb);
      -- Lista (ASCII, separada por virgula) das keys exigidas e NAO satisfeitas (key ausente no mapa = nao satisfeita).
      SELECT string_agg(k.key, ',' ORDER BY k.key) INTO v_faltando
        FROM jsonb_array_elements_text(v_reqs) AS k(key)
        WHERE COALESCE((v_cond ->> k.key)::boolean, false) = false;
      IF v_faltando IS NOT NULL THEN
        RAISE EXCEPTION 'explosao_requisito_faltando: %', v_faltando USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END;
$x$;
  b := $x$  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;
$x$;
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'f6_explosao_down: bloco do gate F6 nao aparece exatamente 1x em _enviar_modelo_para_cad_core' USING ERRCODE = 'P0001';
  END IF;
  d := replace(d, a, b);
  EXECUTE d;
  IF md5(pg_get_functiondef(to_regprocedure('public._enviar_modelo_para_cad_core(uuid,text,text)'))) IS DISTINCT FROM '6c5fc00819b4211eb08d20a1d271c9b2' THEN
    RAISE EXCEPTION 'f6_explosao_down: _enviar_modelo_para_cad_core nao voltou ao md5 anterior' USING ERRCODE = 'P0001';
  END IF;
END
$troca_core$;

NOTIFY pgrst, 'reload schema';
COMMIT;
