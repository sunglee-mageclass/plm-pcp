-- Inverso de 20261008100000_integracao_7_permissao_super.sql — MONTADO por .superpowers/integracao/mig/gera-sql-d7.sh (as 3
-- funções voltam ao texto de antes, antes-d7/ — nunca editar à mão). Tira os 2 gatilhos de permissão e as 3 funções novas.
-- NÃO devolve as linhas `integracao%` que a ida apagou de papel_permissoes (só o pg_dump feito antes da ida). Linhas
-- `integracao` de user_permissions ficam como estão (voltam a valer pela regra antiga: admin da loja passa sozinho).
-- DROP TRIGGER pede AccessExclusive em user_permissions/papel_permissoes por um instante.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef('public._integracao_exige(boolean)'::regprocedure));
  IF v NOT IN ('8b908a5cf45d86e636a31f6284c5193e', '7ed9fb6de2ba2a615e11dacf1578bf78') THEN
    RAISE EXCEPTION 'integracao_7_down: _integracao_exige mudou depois do delta 7 (md5 %) - refazer o inverso', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public._integracao_gates(uuid)'::regprocedure));
  IF v NOT IN ('0312dd0514f34acc097bc5e053a34e6a', '30449c555718f76cdb2747267e54caf2') THEN
    RAISE EXCEPTION 'integracao_7_down: _integracao_gates mudou depois do delta 7 (md5 %) - refazer o inverso', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.integracao_listar(text,jsonb,integer)'::regprocedure));
  IF v NOT IN ('97954f033f3e70843818a1bc2ca92524', 'f840c67870a924fc3983243c52102da6') THEN
    RAISE EXCEPTION 'integracao_7_down: integracao_listar mudou depois do delta 7 (md5 %) - refazer o inverso', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_exige(_editar boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF _editar AND NOT public.user_can_edit('integracao') THEN
    RAISE EXCEPTION 'Sem permissão para editar a Integração.' USING ERRCODE = '42501';
  END IF;
  IF NOT _editar AND NOT public.user_can_view('integracao') THEN
    RAISE EXCEPTION 'Sem permissão para ver a Integração.' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END
$function$
;

CREATE OR REPLACE FUNCTION public._integracao_gates(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m public.modelos%ROWTYPE;
  v_int boolean := public.user_can_edit('integracao');
  v_plan boolean := public.user_can_edit('criacao_planejamento');
  v_dev boolean := public.user_can_edit('criacao_desenvolvimento');
  v_preco boolean;
  v_criacao boolean := public.tenant_module_enabled('criacao');
  v_mod_origem boolean;
  v_kw boolean := public.is_tenant_admin() OR public.is_super_admin();
  v_estado text;
  v_base_motivo text;
  v_base_ok boolean;
  v_enviado boolean;
  v_revelada boolean;
  v_etapa text;
BEGIN
  SELECT * INTO m FROM public.modelos WHERE id = _modelo_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_preco := v_plan AND public.user_can_edit('criacao_planejamento:preco_venda');
  v_mod_origem := CASE coalesce(m.origem, 'interno')
                    WHEN 'revenda' THEN public.tenant_module_enabled('produto_acabado')
                    WHEN 'importado' THEN public.tenant_module_enabled('produto_importado')
                    ELSE true END;
  SELECT ip.estado INTO v_estado FROM public.integracao_produtos ip WHERE ip.modelo_id = m.id;
  v_estado := coalesce(v_estado, 'nao_integravel');
  v_base_motivo := CASE
    WHEN v_estado <> 'nao_integravel' THEN 'Travado pela integração.'
    WHEN NOT v_int THEN 'Precisa da permissão de editar a Integração.'
    WHEN NOT v_criacao THEN 'O módulo Estilo & Engenharia está desligado nesta loja.'
    WHEN NOT v_mod_origem THEN 'O módulo da origem deste produto (Produto Acabado/Importado) está desligado nesta loja.'
  END;
  v_base_ok := v_base_motivo IS NULL;
  -- ruling do controlador, G-migration fix 2 #H3 (A + B-DM-3): sinal ESTRUTURADO e estável (chave ASCII, não
  -- texto em PT) pra quem precisa decidir "é módulo desligado?" sem comparar mensagem — usado por
  -- integracao_marcar (G6) pra reconferir o mesmo predicado de integracao_salvar sem depender do TEXTO do
  -- motivo (que poderia mudar por qualquer edição de UI/copy e destravar tudo em silêncio, B-DM-3).
  v_enviado := coalesce(m.enviado_cad, false);
  v_revelada := coalesce(m.ordem_criacao_enviada, false)
    AND coalesce(public._ref_exibir_gate(m.tenant_id, public._kanban_status_gate(m.tenant_id, m.id, m.status_desenvolvimento)), false);
  SELECT r.lbl INTO v_etapa
    FROM public._kanban_status_rows(m.tenant_id) r
   WHERE r.key = coalesce(nullif(btrim((SELECT tc.ref_exibir_status FROM public.tenant_config tc WHERE tc.tenant_id = m.tenant_id)), ''), 'aprovado')
   ORDER BY r.ord
   LIMIT 1;
  RETURN jsonb_build_object(
    'estado', v_estado,
    'origem', coalesce(m.origem, 'interno'),
    -- #H3: chave ASCII estável — true só quando o motivo de base é de MÓDULO (criacao ou origem desligados),
    -- nunca por permissão de seção ou estado travado. Consumidores decidem por isto, não pelo texto do motivo.
    'modulo_bloqueado', v_base_ok = false AND (NOT v_criacao OR NOT v_mod_origem) AND v_estado = 'nao_integravel',
    'compartilhado', public._integracao_gate(v_base_ok, v_base_motivo, v_plan OR (v_dev AND NOT v_enviado),
      'Precisa da permissão de editar o Planejamento (ou o Desenvolvimento antes do envio à Explosão).'),
    'planejamento', public._integracao_gate(v_base_ok, v_base_motivo, v_plan, 'Precisa da permissão de editar o Planejamento.'),
    'preco', public._integracao_gate(v_base_ok, v_base_motivo, v_preco, 'Precisa da permissão de preço de venda.'),
    'ref', public._integracao_gate(v_base_ok, v_base_motivo, v_dev AND v_revelada AND NOT v_enviado,
      CASE WHEN NOT v_dev THEN 'Precisa da permissão de editar o Desenvolvimento.'
           WHEN NOT v_revelada THEN format('A REF aparece a partir da etapa "%s" do kanban.', coalesce(v_etapa, 'Aprovado'))
           ELSE 'REF travada pelo envio à Explosão — não pode mudar depois desse ponto.' END),
    'sku', public._integracao_gate(v_base_ok, v_base_motivo, v_plan, 'Precisa da permissão de editar o Planejamento.'),
    'keywords', public._integracao_gate(v_int, 'Precisa da permissão de editar a Integração.', v_kw,
      'Só o admin da loja muda as Keywords.'));
END
$function$
;

CREATE OR REPLACE FUNCTION public.integracao_listar(_situacao text, _filtros jsonb, _pagina integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_cfg public.integracao_config;
  v_ver boolean := public._pode_ver_custos();
  v_sit text := coalesce(nullif(btrim(coalesce(_situacao, '')), ''), 'nao_integrados');
  v_f jsonb := coalesce(_filtros, '{}'::jsonb);
  v_busca text := nullif(btrim(coalesce(_filtros ->> 'busca', '')), '');
  v_pag integer := greatest(coalesce(_pagina, 1), 1);
  v_total integer;
  v_cont jsonb;
  v_pagina jsonb;
  v_colecoes jsonb;
  v_ids uuid[];
  v_custos jsonb := '{}'::jsonb;
  v_prod jsonb := '[]'::jsonb;
  v_ret jsonb;
  v_gravado jsonb;
  v_difere jsonb;
  v_kw text;
  v_etapas jsonb;
  r record;
BEGIN
  IF v_sit NOT IN ('nao_integrados', 'integrados', 'todos') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'P0001';
  END IF;
  v_cfg := public._integracao_cfg(v_tenant);

  WITH b AS (SELECT * FROM public._integracao_base(v_tenant)),
       f AS (
         SELECT b.* FROM b
          WHERE (v_sit = 'todos' OR (v_sit = 'integrados' AND b.estado = 'integrado')
                 OR (v_sit = 'nao_integrados' AND b.estado <> 'integrado'))
            AND (v_f ->> 'colecao' IS NULL OR b.colecao = v_f ->> 'colecao')
            AND (v_f ->> 'etapa' IS NULL OR b.etapa = v_f ->> 'etapa')
            AND (v_f ->> 'origem' IS NULL OR b.origem = v_f ->> 'origem')
            AND (v_f ->> 'estado' IS NULL OR b.estado = v_f ->> 'estado')
            AND (v_busca IS NULL OR b.nome ILIKE '%' || v_busca || '%' OR coalesce(b.ref, '') ILIKE '%' || v_busca || '%'))
  SELECT jsonb_build_object(
           'nao_integrados', (SELECT count(*) FROM b WHERE b.estado <> 'integrado'),
           'integrados', (SELECT count(*) FROM b WHERE b.estado = 'integrado'),
           'todos', (SELECT count(*) FROM b)),
         (SELECT count(*) FROM f),
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'colecao', p.colecao, 'etapa', p.etapa, 'estado', p.estado,
                                                        'marcado_em', p.marcado_em, 'integrado_em', p.integrado_em)
                                    ORDER BY p.nome, p.id)
                     FROM (SELECT f.* FROM f ORDER BY f.nome, f.id OFFSET (v_pag - 1) * 50 LIMIT 50) p), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(DISTINCT b.colecao ORDER BY b.colecao) FROM b WHERE b.colecao IS NOT NULL), '[]'::jsonb)
    INTO v_cont, v_total, v_pagina, v_colecoes;

  v_ids := ARRAY(SELECT (x.p ->> 'id')::uuid FROM jsonb_array_elements(v_pagina) AS x(p));
  IF cardinality(v_ids) > 0 THEN
    v_custos := coalesce(public._custo_unitario_modelos_core(v_ids), '{}'::jsonb);
  END IF;
  FOR r IN
    SELECT m.*, e.p ->> 'colecao' AS b_colecao, e.p ->> 'etapa' AS b_etapa, e.p ->> 'estado' AS b_estado,
           e.p -> 'marcado_em' AS b_marcado, e.p -> 'integrado_em' AS b_integrado, ip.retrato AS ip_retrato, e.n AS b_n
      FROM jsonb_array_elements(v_pagina) WITH ORDINALITY AS e(p, n)
      JOIN public.modelos m ON m.id = (e.p ->> 'id')::uuid
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id
     ORDER BY e.n
  LOOP
    v_ret := public._integracao_retrato_core(r.id, v_cfg.campos, v_custos -> r.id::text);
    v_gravado := CASE WHEN r.ip_retrato IS NULL THEN NULL WHEN v_ver THEN r.ip_retrato
                      ELSE public._integracao_mascarar(r.ip_retrato) END;
    -- N10: linha integrável/integrada mostra o RETRATO; o "i" avisa quais campos do produto mudaram depois dele
    v_difere := CASE WHEN r.ip_retrato IS NULL THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(k.k ORDER BY k.k)
        FROM jsonb_object_keys(r.ip_retrato -> 'linhas' -> 0 -> 'valores') AS k(k)
       WHERE (v_ver OR k.k <> 'preco_custo')
         AND (r.ip_retrato -> 'linhas' -> 0 -> 'valores' -> k.k)
             IS DISTINCT FROM (v_ret -> 'retrato' -> 'linhas' -> 0 -> 'valores' -> k.k)), '[]'::jsonb) END;
    v_prod := v_prod || jsonb_build_array(jsonb_build_object(
      'modelo_id', r.id, 'origem', coalesce(r.origem, 'interno'), 'colecao', r.b_colecao, 'etapa', r.b_etapa,
      'estado', r.b_estado, 'marcado_em', r.b_marcado, 'integrado_em', r.b_integrado, 'rev', r.rev,
      'raw', jsonb_build_object(
        'nome', r.nome, 'ref', r.ref, 'preco_anterior', r.preco_anterior, 'preco_venda', r.preco_venda,
        'peso_kg', r.peso_kg, 'ncm', r.ncm, 'titulo_pagina', r.titulo_pagina, 'descricao_produto', r.descricao_produto,
        'comprimento_cm', r.comprimento_cm, 'largura_cm', r.largura_cm, 'altura_cm', r.altura_cm,
        'fotos_modelo', to_jsonb(coalesce(r.fotos_modelo, '{}'::text[])), 'tamanho_tipo', r.tamanho_tipo),
      'vivo', CASE WHEN v_ver THEN v_ret -> 'retrato' ELSE public._integracao_mascarar(v_ret -> 'retrato') END,
      'faltas', v_ret -> 'faltas', 'completo', (v_ret ->> 'completo')::boolean, 'sublinhas', v_ret -> 'meta',
      'retrato', v_gravado, 'retrato_difere', v_difere, 'gates', public._integracao_gates(r.id),
      -- ruling do controlador, G-migration fix 3 #J4: selo "Reprovado — não vai para a API" (T12a) precisa do
      -- boolean por produto na LISTA (integracao_listar), não só na prévia (integracao_previa já mandava). MESMA
      -- definição do D9 (_integracao_base): status_planejamento='reprovado' OU status_desenvolvimento='reprovado'.
      'reprovado', (coalesce(r.status_planejamento, '') = 'reprovado'
                    OR lower(btrim(coalesce(r.status_desenvolvimento, ''))) = 'reprovado')));
  END LOOP;

  SELECT tc.keywords INTO v_kw FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant;
  v_etapas := jsonb_build_array(jsonb_build_object('key', 'planejamento', 'label', 'Planejamento'))
    || coalesce((SELECT jsonb_agg(jsonb_build_object('key', s.key, 'label', s.lbl) ORDER BY s.ord)
                   FROM public._kanban_status_rows(v_tenant) s), '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('key', 'lancado', 'label', 'Lançado'));
  RETURN jsonb_build_object(
    'pagina', v_pag, 'por_pagina', 50, 'total', v_total, 'contagens', v_cont,
    'campos', to_jsonb(v_cfg.campos), 'rotulos', public._integracao_rotulos(),
    'opcoes', jsonb_build_object('colecoes', v_colecoes, 'etapas', v_etapas),
    'pode', jsonb_build_object('editar', public.user_can_edit('integracao'), 'ver_custos', v_ver,
                               'super', public.is_super_admin(), 'keywords', public.is_tenant_admin() OR public.is_super_admin()),
    'keywords', v_kw,
    'produtos', v_prod);
END
$function$
;

DROP TRIGGER IF EXISTS trg_integracao_perm_user ON public.user_permissions;
DROP TRIGGER IF EXISTS trg_integracao_perm_papel ON public.papel_permissoes;
DROP FUNCTION IF EXISTS public.fn_integracao_perm_user();
DROP FUNCTION IF EXISTS public.fn_integracao_perm_papel();
DROP FUNCTION IF EXISTS public._integracao_pode(boolean);

DO $pos$
DECLARE
  n integer;
BEGIN
  IF md5(pg_get_functiondef('public._integracao_exige(boolean)'::regprocedure)) <> '7ed9fb6de2ba2a615e11dacf1578bf78'
     OR md5(pg_get_functiondef('public._integracao_gates(uuid)'::regprocedure)) <> '30449c555718f76cdb2747267e54caf2'
     OR md5(pg_get_functiondef('public.integracao_listar(text,jsonb,integer)'::regprocedure)) <> 'f840c67870a924fc3983243c52102da6' THEN
    RAISE EXCEPTION 'integracao_7_down: as 3 funcoes nao voltaram ao texto de antes' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('_integracao_pode', 'fn_integracao_perm_user', 'fn_integracao_perm_papel');
  IF n <> 0 THEN
    RAISE EXCEPTION 'integracao_7_down: funcoes do delta 7 ainda existem (%)', n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class k ON k.oid = t.tgrelid
   WHERE k.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
     AND t.tgname IN ('trg_integracao_perm_user', 'trg_integracao_perm_papel');
  IF n <> 0 THEN
    RAISE EXCEPTION 'integracao_7_down: gatilhos do delta 7 ainda existem (%)', n USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
