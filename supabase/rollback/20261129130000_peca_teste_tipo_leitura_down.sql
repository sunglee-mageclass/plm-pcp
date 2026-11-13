-- Volta de 20261129130000: devolve o corpo de ANTES de _peca_teste_trilhas_core, _peca_teste_quadro_core e _peca_teste_status_lote_core (leitura por linha de M.O.). A funcao nova _peca_teste_fornecedores_tipo FICA (so cai no _down_drop, depois de TODOS os _down). So catalogo.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
CREATE OR REPLACE FUNCTION public._peca_teste_trilhas_core(_tenant uuid, _modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] secao Peca Teste do card: trilhas = linhas de M.O. do card cujo tipo (da MESMA loja) exige peca teste, na ordem da
  -- M.O. (ct.ordem, ct.nome, created_at, id); tentativas = as da trilha (linha x tipo ATUAL), numero ASC; "aprovada" = o predicado
  -- unico (_peca_teste_aprovada, com o fornecedor da linha). "outros" = as demais linhas COM tipo (so servico + fornecedor; Ruling
  -- 33). NUNCA devolve valor da M.O. Card de outra loja / inexistente = NULL.
  IF _tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = _tenant) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'trilhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'mo_linha_id', s.id,
               'categoria_id', s.categoria_terceirizado_id,
               'categoria_nome', ct.nome,
               'empresa_id', s.empresa_id,
               'empresa_nome', e.nome_fantasia,
               'mo_aprovado', s.aprovado,
               'aprovada', public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id),
               'tentativas', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', t.id, 'numero', t.numero, 'empresa_id', t.empresa_id, 'empresa_nome', te.nome_fantasia,
                          'data_saida', t.data_saida, 'data_entrada', t.data_entrada, 'aprovacao', t.aprovacao,
                          'decidido_em', t.decidido_em, 'rev', t.rev,
                          'mini', public._peca_teste_trilha_mini(t.id)) ORDER BY t.numero)
                   FROM public.modelo_peca_teste_tentativas t
                   LEFT JOIN public.empresas te ON te.id = t.empresa_id AND te.tenant_id = _tenant
                  WHERE t.mo_linha_id = s.id AND t.categoria_terceirizado_id = s.categoria_terceirizado_id AND t.tenant_id = _tenant
               ), '[]'::jsonb)
             ) ORDER BY ct.ordem, ct.nome, s.created_at, s.id)
        FROM public.modelo_servico_mo s
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
       WHERE s.modelo_id = _modelo_id
    ), '[]'::jsonb),
    'outros', coalesce((
      SELECT jsonb_agg(jsonb_build_object('categoria_nome', ct.nome, 'empresa_nome', e.nome_fantasia)
             ORDER BY ct.ordem, ct.nome, s.created_at, s.id)
        FROM public.modelo_servico_mo s
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND NOT ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
       WHERE s.modelo_id = _modelo_id
    ), '[]'::jsonb));
END $function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_trilhas_core(uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public._peca_teste_quadro_core(_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] coluna Peca Teste do quadro PCP > Etapas: 1 item por card NAO lancado da loja com >= 1 trilha (tipo exigindo) cuja
  -- tentativa atual esta "em_teste" (tem data de saida, sem decisao) ou "aprovada" (o predicado unico, com o fornecedor da linha);
  -- card Reprovado fica fora.
  -- O item traz TODAS as trilhas exigindo do card (as demais com status "pendente": virtual, reprovada, so com entrada, ou aprovada
  -- com outro fornecedor) para o front decidir "aprovada so se todas" (Ruling 20). O filtro "e PL" fica no front (isServicoPL).
  RETURN coalesce((
    WITH tr AS (
      SELECT s.modelo_id, s.id AS linha, ct.ordem, ct.nome AS cat_nome, s.created_at, e.nome_fantasia AS emp_nome,
             a.aprovacao, a.data_saida,
             public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id) AS ok
        FROM public.modelo_servico_mo s
        JOIN public.modelos m ON m.id = s.modelo_id AND m.tenant_id = _tenant AND NOT m.lancado
        JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id AND ct.tenant_id = _tenant AND ct.exige_peca_teste
        LEFT JOIN public.empresas e ON e.id = s.empresa_id AND e.tenant_id = _tenant
        LEFT JOIN LATERAL (SELECT t.aprovacao, t.data_saida FROM public.modelo_peca_teste_tentativas t
                            WHERE t.mo_linha_id = s.id AND t.categoria_terceirizado_id = s.categoria_terceirizado_id
                            ORDER BY t.numero DESC LIMIT 1) a ON true
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
                                          ORDER BY x.ordem, x.cat_nome, x.created_at, x.linha)
                           FROM st x WHERE x.modelo_id = m.id)
           ) ORDER BY m.ref NULLS LAST, m.nome, m.id)
      FROM public.modelos m
     WHERE m.tenant_id = _tenant AND NOT m.lancado
       -- card Reprovado (Dev OU Planejamento; o predicado canonico) sai do quadro (revisao T2, achado 6)
       AND NOT (lower(coalesce(m.status_desenvolvimento, '')) = 'reprovado' OR lower(coalesce(m.status_planejamento, '')) = 'reprovado')
       AND EXISTS (SELECT 1 FROM st x WHERE x.modelo_id = m.id AND x.status <> 'pendente')
  ), '[]'::jsonb);
END $function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_quadro_core(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public._peca_teste_status_lote_core(_tenant uuid, _modelo_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  -- [F6] status da Peca Teste por modelo, em LOTE, para o selo/filtro da lista de Servicos. Para cada modelo de _modelo_ids
  -- que seja da loja _tenant, calcula 'nao_exige'/'falta'/'em_teste'/'aprovada' (mesma regra do TS statusPecaTesteModelo).
  -- Modelo que nao e da loja (ou id inexistente) = OMITIDO do mapa. EXECUTE so postgres/service_role (REVOKE dos 3 abaixo).
  IF _tenant IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  v_ids := coalesce(_modelo_ids, '{}'::uuid[]);
  -- Limite de seguranca: recusa lote absurdamente grande (a lista da tela pagina). ASCII (P0001 = 400).
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
                   -- alguma linha que EXIGE ainda nao esta toda aprovada (M.O. aprovada E peca teste aprovada)
                   SELECT 1 FROM public.modelo_servico_mo s
                     JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
                                                           AND ct.tenant_id = _tenant AND ct.exige_peca_teste
                    WHERE s.modelo_id = m.id
                      AND NOT (s.aprovado IS TRUE
                               AND public._peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id))
                 ) THEN 'aprovada'
                 -- exige e NAO aprovada: 'em_teste' se alguma linha que exige ja tem tentativa INICIADA
                 -- (data_saida nao nula) no tipo ATUAL da linha (espelha trilhaIniciada do TS); senao 'falta'.
                 ELSE CASE WHEN EXISTS (
                   SELECT 1 FROM public.modelo_servico_mo s
                     JOIN public.categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
                                                           AND ct.tenant_id = _tenant AND ct.exige_peca_teste
                     JOIN public.modelo_peca_teste_tentativas t ON t.mo_linha_id = s.id
                          AND t.categoria_terceirizado_id = s.categoria_terceirizado_id AND t.tenant_id = _tenant
                          AND t.data_saida IS NOT NULL
                    WHERE s.modelo_id = m.id
                 ) THEN 'em_teste' ELSE 'falta' END
               END AS status
          FROM public.modelos m
         WHERE m.id = ANY(v_ids) AND m.tenant_id = _tenant
      ) d
  ), '{}'::jsonb);
END $function$;
REVOKE EXECUTE ON FUNCTION public._peca_teste_status_lote_core(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
COMMIT;

select pg_notify('pgrst', 'reload schema');
