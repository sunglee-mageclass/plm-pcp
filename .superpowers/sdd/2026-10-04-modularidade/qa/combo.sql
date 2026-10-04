BEGIN;
-- ============================================================================================================================
-- T0 Modularidade: troca os modulos da loja de QA para uma combinacao nomeada. Chama public.salvar_loja como o super admin
-- teste@teste.com (claims so dentro desta transacao; nao altera users.tenant_id de ninguem), para que o que o salvar_loja fizer
-- (a T3 passa a re-enfileirar o kanban) rode como em producao. So atua na loja de QA. Uso: combo.sh <nome>.
-- ============================================================================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $g$
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7688706257618321447
     OR current_setting('shared_preload_libraries') LIKE '%supautils%' THEN
    RAISE EXCEPTION 'loja_qa: banco nao e a copia local';
  END IF;
END
$g$;

SELECT set_config('loja_qa.combo', :'combo', true);

DO $c$
DECLARE
  v_loja  constant uuid := '0a0d1000-0000-4000-8000-00000000a001';
  v_combo text := current_setting('loja_qa.combo');
  v_todos constant text[] := ARRAY['cadastro','entrada_saida','criacao','producao','financeiro','dashboard',
                                   'otb','distribuicao','produto_acabado','produto_importado','etapas_pl'];
  v_on    text[];
  v_mod   jsonb;
  v_sa    uuid;
  v_t     record;
  v_k     text;
BEGIN
  v_on := CASE v_combo
    WHEN 'so-estoque'        THEN ARRAY['cadastro','entrada_saida']
    WHEN 'estoque-fin'       THEN ARRAY['cadastro','entrada_saida','financeiro','dashboard']
    WHEN 'cria-sem-producao' THEN ARRAY['cadastro','criacao','entrada_saida','otb','financeiro','dashboard']
    WHEN 'cria-sem-es'       THEN ARRAY['cadastro','criacao','otb','dashboard']
    WHEN 'sem-otb'           THEN ARRAY['cadastro','entrada_saida','criacao','producao','financeiro','dashboard']
    WHEN 'sem-dashboard'     THEN ARRAY['cadastro','entrada_saida','criacao','producao','financeiro']
    WHEN 'pa-sem-producao'   THEN ARRAY['cadastro','criacao','entrada_saida','otb','produto_acabado']
    WHEN 'completo'          THEN v_todos
    ELSE NULL END;
  -- combo ad hoc: modulos:chave1,chave2 (so as chaves listadas ficam ligadas; as outras, desligadas)
  IF v_on IS NULL AND v_combo LIKE 'modulos:%' THEN
    v_on := string_to_array(substr(v_combo, 9), ',');
    FOREACH v_k IN ARRAY v_on LOOP
      IF NOT (v_k = ANY (v_todos)) THEN
        RAISE EXCEPTION 'loja_qa: modulo desconhecido: %', v_k;
      END IF;
    END LOOP;
  END IF;
  IF v_on IS NULL THEN
    RAISE EXCEPTION 'loja_qa: combo desconhecido: %', v_combo;
  END IF;

  -- Todas as 11 chaves explicitas (chave ausente = padrao: os classicos ligam sozinhos, os opt-in nao).
  SELECT jsonb_object_agg(k, k = ANY (v_on)) INTO v_mod FROM unnest(v_todos) AS k;

  SELECT u.id INTO v_sa FROM auth.users u
    JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'super_admin'
   WHERE u.email = 'teste@teste.com';
  IF v_sa IS NULL THEN RAISE EXCEPTION 'loja_qa: super admin teste@teste.com nao encontrado'; END IF;

  SELECT t.nome, t.cnpj, t.contato INTO v_t FROM public.tenants t WHERE t.id = v_loja;
  IF NOT FOUND THEN RAISE EXCEPTION 'loja_qa: loja de QA nao existe (rode loja-qa.sh)'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
  PERFORM public.salvar_loja(v_loja, v_t.nome, v_t.cnpj, v_t.contato, NULL, v_mod);
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE 'loja_qa: combo % aplicado', v_combo;
END
$c$;

SELECT t.nome, c.modules::text AS modulos FROM public.tenants t
  JOIN public.tenant_config c ON c.tenant_id = t.id WHERE t.id = '0a0d1000-0000-4000-8000-00000000a001';
COMMIT;
