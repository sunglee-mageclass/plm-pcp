-- Integração + API — 7 (delta): PERMISSAO SO PELO SUPER ADMIN (P-107 A, dono 28/set; plano
-- .superpowers/sdd/2026-09-26-tela-integracao-api/delta7-plan.md "D7-banco"). MONTADA por .superpowers/integracao/mig/
-- gera-sql-d7.sh a partir de antes-d7/ (pg_get_functiondef de PRODUÇÃO = cópia) — nunca editar à mão.
-- Regra: vê/edita a Integração o super admin, OU quem tem a linha `integracao` (ver/editar) gravada NO PRÓPRIO USUÁRIO
-- (user_permissions) pelo super admin. tenant_admin/admin NÃO passam sozinhos (reverte a P-81 A só p/ o admin da loja).
--   • _integracao_pode(_editar) = is_super_admin() OR a linha `integracao` em _perm_efetiva(auth.uid()) (sem bypass de admin).
--   • As 3 funções desta frente que usavam user_can_view/edit('integracao') (_integracao_exige, _integracao_gates,
--     integracao_listar) mudam SÓ essas expressões (o resto é o texto de antes byte a byte; o inverso devolve o antes).
--   • trg_integracao_perm_user (BEFORE INSERT/UPDATE/DELETE em user_permissions): linha `integracao%` escrita por quem NÃO é
--     super admin é IGNORADA em silêncio (RETURN NULL) — o DELETE+INSERT do set_user_permissions de um admin da loja não
--     apaga a permissão dada pelo super admin nem consegue concedê-la; o resto das permissões grava normal. Exceção no
--     DELETE: passa quando o usuário da linha já não existe em public.users (cascata de excluir usuário).
--   • trg_integracao_perm_papel (BEFORE INSERT/UPDATE em papel_permissoes): papel NUNCA carrega `integracao%` (nem pelo
--     super admin) — o papel é gerido pelo admin da loja e repassaria a permissão.
--   • reset_loja/_wipe_tenant_core rodam com session_replication_role = replica: estes gatilhos (ENABLE padrão, 'O') não
--     disparam lá — o wipe continua apagando tudo da loja.
--   • Limpeza: as linhas `integracao%` de papel_permissoes são APAGADAS (RAISE NOTICE com a contagem; o inverso NÃO as
--     devolve — só o pg_dump feito antes da ida).
-- Contagens: +3 funções | +2 gatilhos; 3 funções desta frente redefinidas. ACL (#9): as 3 novas com REVOKE ALL de
-- PUBLIC/anon/authenticated. Idempotente (guarda aceita o texto de antes OU o de depois; CREATE OR REPLACE).
-- Inverso: supabase/rollback/20261008100000_integracao_7_permissao_super_down.sql.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v text;
BEGIN
  IF to_regprocedure('public._integracao_ler(text,boolean,text,integer,text,text)') IS NULL THEN
    RAISE EXCEPTION 'integracao_7: aplique as migrations 1..6 da Integracao antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._perm_efetiva(uuid)') IS NULL OR to_regprocedure('public.is_super_admin()') IS NULL
     OR to_regclass('public.user_permissions') IS NULL OR to_regclass('public.papel_permissoes') IS NULL THEN
    RAISE EXCEPTION 'integracao_7: _perm_efetiva/is_super_admin/user_permissions/papel_permissoes ausente' USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public._integracao_exige(boolean)'::regprocedure));
  IF v NOT IN ('7ed9fb6de2ba2a615e11dacf1578bf78', '8b908a5cf45d86e636a31f6284c5193e') THEN
    RAISE EXCEPTION 'integracao_7: _integracao_exige com texto inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public._integracao_gates(uuid)'::regprocedure));
  IF v NOT IN ('30449c555718f76cdb2747267e54caf2', '0312dd0514f34acc097bc5e053a34e6a') THEN
    RAISE EXCEPTION 'integracao_7: _integracao_gates com texto inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.integracao_listar(text,jsonb,integer)'::regprocedure));
  IF v NOT IN ('f840c67870a924fc3983243c52102da6', '97954f033f3e70843818a1bc2ca92524') THEN
    RAISE EXCEPTION 'integracao_7: integracao_listar com texto inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- Quem pode ver (_editar = false) / editar (_editar = true) a Integração: SÓ o super admin ou a linha `integracao` do
-- PRÓPRIO usuário (o papel nunca a carrega — gatilho abaixo). Espelha user_can_view/user_can_edit SEM o atalho de
-- admin/tenant_admin.
CREATE OR REPLACE FUNCTION public._integracao_pode(_editar boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public._perm_efetiva(auth.uid()) e
         WHERE e.pagina = 'integracao'
           AND CASE WHEN coalesce(_editar, false) THEN e.pode_editar ELSE e.pode_ver END
      );
$function$;
REVOKE ALL ON FUNCTION public._integracao_pode(boolean) FROM PUBLIC, anon, authenticated;

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
  IF _editar AND NOT public._integracao_pode(true) THEN
    RAISE EXCEPTION 'Sem permissão para editar a Integração.' USING ERRCODE = '42501';
  END IF;
  IF NOT _editar AND NOT public._integracao_pode(false) THEN
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
  v_int boolean := public._integracao_pode(true);
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
    'pode', jsonb_build_object('editar', public._integracao_pode(true), 'ver_custos', v_ver,
                               'super', public.is_super_admin(), 'keywords', public.is_tenant_admin() OR public.is_super_admin()),
    'keywords', v_kw,
    'produtos', v_prod);
END
$function$
;

-- user_permissions: SÓ o super admin grava/altera/apaga linha `integracao%`; para qualquer outro chamador a escrita
-- dessa linha é IGNORADA (RETURN NULL), sem erro — o resto do comando segue. DELETE de linha cujo usuário já não existe
-- em public.users (cascata users → user_permissions ao excluir o usuário) passa sempre.
CREATE OR REPLACE FUNCTION public.fn_integracao_perm_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.pagina LIKE 'integracao%' AND NOT public.is_super_admin()
       AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.user_id) THEN
      RETURN NULL;
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.pagina LIKE 'integracao%' OR (TG_OP = 'UPDATE' AND OLD.pagina LIKE 'integracao%'))
     AND NOT public.is_super_admin() THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$function$;

-- papel_permissoes: o papel NUNCA carrega `integracao%` (nem gravado pelo super admin).
CREATE OR REPLACE FUNCTION public.fn_integracao_perm_papel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.pagina LIKE 'integracao%' OR (TG_OP = 'UPDATE' AND OLD.pagina LIKE 'integracao%') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_integracao_perm_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_integracao_perm_papel() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_integracao_perm_user
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_perm_user();
CREATE OR REPLACE TRIGGER trg_integracao_perm_papel
  BEFORE INSERT OR UPDATE ON public.papel_permissoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_perm_papel();

-- Limpeza DEPOIS do gatilho (com a trava do CREATE TRIGGER, nenhuma linha nova entra no meio). Na cópia: 0.
DO $limpeza$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.papel_permissoes WHERE pagina LIKE 'integracao%';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'integracao_7: % linha(s) integracao%% apagada(s) de papel_permissoes', n;
END
$limpeza$;

DO $pos$
DECLARE
  f text;
  n integer;
BEGIN
  IF md5(pg_get_functiondef('public._integracao_exige(boolean)'::regprocedure)) <> '8b908a5cf45d86e636a31f6284c5193e'
     OR md5(pg_get_functiondef('public._integracao_gates(uuid)'::regprocedure)) <> '0312dd0514f34acc097bc5e053a34e6a'
     OR md5(pg_get_functiondef('public.integracao_listar(text,jsonb,integer)'::regprocedure)) <> '97954f033f3e70843818a1bc2ca92524' THEN
    RAISE EXCEPTION 'integracao_7: as 3 funcoes redefinidas nao ficaram no texto esperado' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE '%integracao%'
     AND pg_get_functiondef(p.oid) ~ 'user_can_(view|edit)\(''integracao';
  IF n <> 0 THEN
    RAISE EXCEPTION 'integracao_7: % funcao(oes) da Integracao ainda usam user_can_view/edit(integracao)', n USING ERRCODE = 'P0001';
  END IF;
  FOREACH f IN ARRAY ARRAY['public._integracao_pode(boolean)', 'public.fn_integracao_perm_user()',
    'public.fn_integracao_perm_papel()', 'public._integracao_exige(boolean)', 'public._integracao_gates(uuid)'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_7: % executavel por PUBLIC/anon/authenticated (inv. 9)', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.integracao_listar(text,jsonb,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.integracao_listar(text,jsonb,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'integracao_7: ACL errada em integracao_listar' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
     AND ((t.tgrelid = 'public.user_permissions'::regclass AND t.tgname = 'trg_integracao_perm_user')
       OR (t.tgrelid = 'public.papel_permissoes'::regclass AND t.tgname = 'trg_integracao_perm_papel'));
  IF n <> 2 THEN
    RAISE EXCEPTION 'integracao_7: esperado 2 gatilhos de permissao (ENABLE padrao), achei %', n USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.papel_permissoes WHERE pagina LIKE 'integracao%') THEN
    RAISE EXCEPTION 'integracao_7: sobrou linha integracao em papel_permissoes' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
