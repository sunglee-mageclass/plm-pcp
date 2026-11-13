-- Reforma da Peca Teste por TIPO - migration 4 de 5 (LEITURAS): secao do card, quadro de Etapas e selo/filtro da lista passam a ler por TIPO.
-- Spec A4. So catalogo (CREATE OR REPLACE FUNCTION + REVOKE); nenhum dado. Os 3 wrappers (peca_teste_modelo / peca_teste_quadro /
-- peca_teste_status_lote) NAO mudam: so os cores.
--   1) helper NOVO _peca_teste_fornecedores_tipo(_tenant, _categoria_id) -> jsonb [{id, nome_fantasia}]: os fornecedores de SERVICO da loja
--      VINCULADOS ao tipo (empresa_categorias_servico). Alimenta o Select da tentativa e o aviso "vincule em Cadastro".
--   2) _peca_teste_trilhas_core: trilhas = tipos que exigem peca teste e aparecem no card (tipos das linhas de M.O. do card + tipos que ja
--      tem tentativa gravada); por trilha: tem_mo, mo_aprovado (agregado das linhas do tipo), aprovada (predicado novo), fornecedores,
--      tentativas (com o PROPRIO fornecedor). Novo: tipos_adicionar (tipos ativos que exigem e nao estao na lista: "Adicionar peca teste").
--   3) _peca_teste_quadro_core: 1 item por card nao lancado com >= 1 trilha (tipo exigente PRESENTE NA M.O. do card) em_teste/aprovada; a
--      trilha mostra o fornecedor da tentativa atual.
--   4) _peca_teste_status_lote_core: mesma regra do TS statusPecaTesteModelo, lendo por tipo.
-- Regra de participacao (rulings R2): o requisito do kanban, o quadro e o selo contam so tipos exigentes que tem LINHA de M.O. no card
-- (como a condicao peca_teste_aprovada e tem_peca_teste); trilha de tipo sem M.O. (adicionada a mao) aparece na secao mas nao trava o kanban.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._peca_teste_trilhas_core(uuid,uuid)     ANTES ef860a61e25750d2d12131062a23202d
--   public._peca_teste_quadro_core(uuid)           ANTES 6e191644f2fb4acfea04e4ff76a6f5de
--   public._peca_teste_status_lote_core(uuid,uuid[]) ANTES fff007ebb8ce0dbffe39e8f09fd53643
--   public._peca_teste_fornecedores_tipo(uuid,uuid) ANTES ausente
-- ====================================================================================
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261129130000_peca_teste_tipo_leitura.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK. Banco ANTES do site. Volta: supabase/rollback/20261129130000_peca_teste_tipo_leitura_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $pre$
DECLARE
  v_tr text := md5(pg_get_functiondef('public._peca_teste_trilhas_core(uuid,uuid)'::regprocedure));
  v_qd text := md5(pg_get_functiondef('public._peca_teste_quadro_core(uuid)'::regprocedure));
  v_sl text := md5(pg_get_functiondef('public._peca_teste_status_lote_core(uuid,uuid[])'::regprocedure));
BEGIN
  IF v_tr <> 'ef860a61e25750d2d12131062a23202d'
     AND position('[reforma pt]' in pg_get_functiondef('public._peca_teste_trilhas_core(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'reforma_pt_leitura: _peca_teste_trilhas_core divergente (md5 %)', v_tr USING ERRCODE = 'P0001';
  END IF;
  IF v_qd <> '6e191644f2fb4acfea04e4ff76a6f5de'
     AND position('[reforma pt]' in pg_get_functiondef('public._peca_teste_quadro_core(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'reforma_pt_leitura: _peca_teste_quadro_core divergente (md5 %)', v_qd USING ERRCODE = 'P0001';
  END IF;
  IF v_sl <> 'fff007ebb8ce0dbffe39e8f09fd53643'
     AND position('[reforma pt]' in pg_get_functiondef('public._peca_teste_status_lote_core(uuid,uuid[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'reforma_pt_leitura: _peca_teste_status_lote_core divergente (md5 %)', v_sl USING ERRCODE = 'P0001';
  END IF;
END
$pre$;

-- 1) fornecedores do tipo
CREATE OR REPLACE FUNCTION public._peca_teste_fornecedores_tipo(_tenant uuid, _categoria_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [reforma pt] fornecedores de SERVICO da loja vinculados ao tipo, por nome. Lista vazia = a tela avisa "vincule em Cadastro".
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nome_fantasia', e.nome_fantasia) ORDER BY e.nome_fantasia, e.id), '[]'::jsonb)
    FROM public.empresa_categorias_servico k
    JOIN public.empresas e ON e.id = k.empresa_id AND e.tenant_id = _tenant AND e.tipo = 'servico'
   WHERE k.categoria_terceirizado_id = _categoria_id
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_fornecedores_tipo(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 2) secao do card
CREATE OR REPLACE FUNCTION public._peca_teste_trilhas_core(_tenant uuid, _modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [reforma pt] secao Peca Teste do card POR TIPO. Card de outra loja / inexistente = NULL. NUNCA devolve valor da M.O.
  IF _tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = _tenant) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'trilhas', coalesce((
      WITH tipos AS (
        SELECT ct.id, ct.nome, ct.ordem
          FROM public.categorias_terceirizado ct
         WHERE ct.tenant_id = _tenant AND ct.exige_peca_teste
           AND (EXISTS (SELECT 1 FROM public.modelo_servico_mo s WHERE s.modelo_id = _modelo_id AND s.categoria_terceirizado_id = ct.id)
                OR EXISTS (SELECT 1 FROM public.modelo_peca_teste_tentativas t WHERE t.modelo_id = _modelo_id AND t.categoria_terceirizado_id = ct.id))
      )
      SELECT jsonb_agg(jsonb_build_object(
               'categoria_id', tp.id,
               'categoria_nome', tp.nome,
               'tem_mo', EXISTS (SELECT 1 FROM public.modelo_servico_mo s WHERE s.modelo_id = _modelo_id AND s.categoria_terceirizado_id = tp.id),
               'mo_aprovado', (SELECT CASE WHEN count(*) = 0 THEN NULL
                                           WHEN bool_and(s.aprovado IS TRUE) THEN true
                                           WHEN bool_or(s.aprovado IS FALSE) THEN false
                                           ELSE NULL END
                                 FROM public.modelo_servico_mo s WHERE s.modelo_id = _modelo_id AND s.categoria_terceirizado_id = tp.id),
               'aprovada', public._peca_teste_aprovada_tipo(_modelo_id, tp.id),
               'fornecedores', public._peca_teste_fornecedores_tipo(_tenant, tp.id),
               'tentativas', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', t.id, 'numero', t.numero, 'empresa_id', t.empresa_id, 'empresa_nome', te.nome_fantasia,
                          'data_saida', t.data_saida, 'data_entrada', t.data_entrada, 'aprovacao', t.aprovacao,
                          'decidido_em', t.decidido_em, 'rev', t.rev,
                          'mini', public._peca_teste_trilha_mini(t.id)) ORDER BY t.numero)
                   FROM public.modelo_peca_teste_tentativas t
                   LEFT JOIN public.empresas te ON te.id = t.empresa_id AND te.tenant_id = _tenant
                  WHERE t.modelo_id = _modelo_id AND t.categoria_terceirizado_id = tp.id AND t.tenant_id = _tenant
               ), '[]'::jsonb)
             ) ORDER BY tp.ordem, tp.nome, tp.id)
        FROM tipos tp
    ), '[]'::jsonb),
    'outros', coalesce((
      SELECT jsonb_agg(jsonb_build_object('categoria_nome', ct.nome, 'empresa_nome', e.nome_fantasia)
             ORDER BY ct.ordem, ct.nome, s.created_at, s.id)
        FROM public.modelo_servico_mo s
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND NOT ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
       WHERE s.modelo_id = _modelo_id
    ), '[]'::jsonb),
    'tipos_adicionar', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'categoria_id', ct.id, 'categoria_nome', ct.nome,
               'fornecedores', public._peca_teste_fornecedores_tipo(_tenant, ct.id)) ORDER BY ct.ordem, ct.nome, ct.id)
        FROM public.categorias_terceirizado ct
       WHERE ct.tenant_id = _tenant AND ct.exige_peca_teste AND coalesce(ct.ativo, true)
         AND NOT EXISTS (SELECT 1 FROM public.modelo_servico_mo s WHERE s.modelo_id = _modelo_id AND s.categoria_terceirizado_id = ct.id)
         AND NOT EXISTS (SELECT 1 FROM public.modelo_peca_teste_tentativas t WHERE t.modelo_id = _modelo_id AND t.categoria_terceirizado_id = ct.id)
    ), '[]'::jsonb));
END
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_trilhas_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 3) quadro de Etapas
CREATE OR REPLACE FUNCTION public._peca_teste_quadro_core(_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [reforma pt] coluna Peca Teste do quadro PCP > Etapas, POR TIPO: 1 item por card NAO lancado da loja com >= 1 trilha (tipo exigente
  -- que tem linha de M.O. no card) "em_teste" (tem data de saida, sem decisao) ou "aprovada" (predicado por tipo); card Reprovado fica
  -- fora. O item traz TODAS as trilhas do card (as demais "pendente") para o front decidir "aprovada so se todas". O filtro "e PL"
  -- fica no front (isServicoPL). O fornecedor mostrado e o da tentativa ATUAL do tipo.
  RETURN coalesce((
    WITH tr AS (
      SELECT m.id AS modelo_id, ct.id AS cat_id, ct.ordem, ct.nome AS cat_nome, e.nome_fantasia AS emp_nome,
             a.aprovacao, a.data_saida,
             public._peca_teste_aprovada_tipo(m.id, ct.id) AS ok
        FROM public.modelos m
        JOIN public.categorias_terceirizado ct ON ct.tenant_id = _tenant AND ct.exige_peca_teste
         AND EXISTS (SELECT 1 FROM public.modelo_servico_mo s WHERE s.modelo_id = m.id AND s.categoria_terceirizado_id = ct.id)
        LEFT JOIN LATERAL (SELECT t.aprovacao, t.data_saida, t.empresa_id FROM public.modelo_peca_teste_tentativas t
                            WHERE t.modelo_id = m.id AND t.categoria_terceirizado_id = ct.id
                            ORDER BY t.numero DESC LIMIT 1) a ON true
        LEFT JOIN public.empresas e ON e.id = a.empresa_id AND e.tenant_id = _tenant
       WHERE m.tenant_id = _tenant AND NOT m.lancado
    ), st AS (
      SELECT tr.*, CASE WHEN tr.ok THEN 'aprovada'
                        WHEN tr.aprovacao IS NULL AND tr.data_saida IS NOT NULL THEN 'em_teste'
                        ELSE 'pendente' END AS status
        FROM tr
    )
    SELECT jsonb_agg(jsonb_build_object(
             'modelo_id', m.id,
             'ref', m.ref,
             'nome', m.nome,
             'origem', m.origem,
             'colecao', public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao),
             'fotos_fontes', jsonb_build_array(m.fotos_modelo[1], m.desenho_tecnico_url, m.croqui_url),
             'explodido', EXISTS (SELECT 1 FROM public.cad k WHERE k.modelo_id = m.id AND k.enviado_corte),
             'trilhas', (SELECT jsonb_agg(jsonb_build_object('categoria_nome', x.cat_nome, 'empresa_nome', x.emp_nome,
                                                             'status', x.status,
                                                             'data_saida', CASE WHEN x.status = 'pendente' THEN NULL ELSE x.data_saida END)
                                          ORDER BY x.ordem, x.cat_nome, x.cat_id)
                           FROM st x WHERE x.modelo_id = m.id)
           ) ORDER BY m.ref NULLS LAST, m.nome, m.id)
      FROM public.modelos m
     WHERE m.tenant_id = _tenant AND NOT m.lancado
       AND NOT (lower(coalesce(m.status_desenvolvimento, '')) = 'reprovado' OR lower(coalesce(m.status_planejamento, '')) = 'reprovado')
       AND EXISTS (SELECT 1 FROM st x WHERE x.modelo_id = m.id AND x.status <> 'pendente')
  ), '[]'::jsonb);
END
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_quadro_core(uuid) FROM PUBLIC, anon, authenticated;

-- 4) selo/filtro da lista de Servicos
CREATE OR REPLACE FUNCTION public._peca_teste_status_lote_core(_tenant uuid, _modelo_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  -- [reforma pt] status da Peca Teste por modelo, em LOTE, POR TIPO: 'nao_exige'/'falta'/'em_teste'/'aprovada' (mesma regra do TS
  -- statusPecaTesteModelo). Modelo que nao e da loja (ou id inexistente) = OMITIDO. EXECUTE so postgres/service_role.
  IF _tenant IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  v_ids := coalesce(_modelo_ids, '{}'::uuid[]);
  IF array_length(v_ids, 1) > 2000 THEN
    RAISE EXCEPTION 'peca_teste_status_lote: lote grande demais (maximo 2000 modelos)' USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce((
    SELECT jsonb_object_agg(d.modelo_id::text, d.status)
      FROM (
        SELECT m.id AS modelo_id,
               CASE
                 WHEN NOT EXISTS (
                   SELECT 1 FROM public.modelo_servico_mo s
                     JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
                                                           AND ct.tenant_id = _tenant AND ct.exige_peca_teste
                    WHERE s.modelo_id = m.id
                 ) THEN 'nao_exige'
                 WHEN NOT EXISTS (
                   -- alguma linha que EXIGE ainda nao esta toda aprovada (M.O. aprovada E trilha do TIPO aprovada)
                   SELECT 1 FROM public.modelo_servico_mo s
                     JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
                                                           AND ct.tenant_id = _tenant AND ct.exige_peca_teste
                    WHERE s.modelo_id = m.id
                      AND NOT (s.aprovado IS TRUE AND public._peca_teste_aprovada_tipo(m.id, s.categoria_terceirizado_id))
                 ) THEN 'aprovada'
                 ELSE CASE WHEN EXISTS (
                   SELECT 1 FROM public.modelo_servico_mo s
                     JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
                                                           AND ct.tenant_id = _tenant AND ct.exige_peca_teste
                     JOIN public.modelo_peca_teste_tentativas t ON t.modelo_id = m.id
                          AND t.categoria_terceirizado_id = s.categoria_terceirizado_id AND t.tenant_id = _tenant
                          AND t.data_saida IS NOT NULL
                    WHERE s.modelo_id = m.id
                 ) THEN 'em_teste' ELSE 'falta' END
               END AS status
          FROM public.modelos m
         WHERE m.id = ANY(v_ids) AND m.tenant_id = _tenant
      ) d
  ), '{}'::jsonb);
END
$function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_status_lote_core(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('_peca_teste_fornecedores_tipo', '_peca_teste_trilhas_core', '_peca_teste_quadro_core', '_peca_teste_status_lote_core')
                AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
                AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'reforma_pt_leitura: pos-condicao falhou - ACL com EXECUTE para PUBLIC/anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
