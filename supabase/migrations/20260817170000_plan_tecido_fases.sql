-- Plan. Tecido — FASE (etapa do fluxo) de cada modelo REAL da coleção, p/ o badge do card (item 10).
-- 1 query batch por coleção (não N por card). Espelha a ORDEM do _dashboard_producao_core (a fase
-- MAIS avançada vence), mas na régua do dono: colapsa CQ em "PCP" e usa o direcionamento SEPARADO
-- (cad.direcionamento_status='separado') como marco. NÃO é gate — só exibição (não reusa cqLiberado).
--
-- Escada (mais avançada vence, primeiro casa vence):
--   lancado          -> modelos.lancado
--   direcionamento   -> cad.direcionamento_status = 'separado'
--   pcp              -> enviado_cad E (bloco de serviço ativo OU CQ existe); detalhe = serviço ATUAL
--                       (1º bloco NÃO finalizado por etapa [pré<pós] e categorias_terceirizado.ordem;
--                        "finalizado" = data-derivado, igual ao PCP > Serviços) OU 'CQ' se nada em curso
--   explosao         -> enviado_cad
--   dev              -> ordem_criacao_enviada; detalhe = status_desenvolvimento (front resolve o rótulo)
--   planejamento     -> nenhum acima

CREATE OR REPLACE FUNCTION public._plan_tecido_fases_core(_tenant uuid, _colecao_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with base as (
    select m.id,
           coalesce(m.lancado, false)                as lancado,
           coalesce(m.enviado_cad, false)            as enviado_cad,
           coalesce(m.ordem_criacao_enviada, false)  as ordem_criacao_enviada,
           m.status_desenvolvimento,
           exists(select 1 from cad c
                   where c.modelo_id = m.id and c.direcionamento_status = 'separado')      as direcionado,
           exists(select 1 from cad c
                    join producao_terceirizados pt on pt.cad_id = c.id
                   where c.modelo_id = m.id and coalesce(pt.ativo, true) <> false)         as tem_servico,
           exists(select 1 from cad c
                    join controle_qualidade q on q.cad_id = c.id
                   where c.modelo_id = m.id)                                               as tem_cq
      from modelos m
     where m.colecao_id = _colecao_id and m.tenant_id = _tenant
  ),
  fase as (
    select b.*,
      case
        when b.lancado                                     then 'lancado'
        when b.direcionado                                 then 'direcionamento'
        when b.enviado_cad and (b.tem_servico or b.tem_cq) then 'pcp'
        when b.enviado_cad                                 then 'explosao'
        when b.ordem_criacao_enviada                       then 'dev'
        else                                                    'planejamento'
      end as fase
    from base b
  )
  select coalesce(jsonb_object_agg(f.id, jsonb_build_object(
           'fase', f.fase,
           'detalhe', case
             when f.fase = 'dev' then f.status_desenvolvimento
             when f.fase = 'pcp' then coalesce(
               (select ct.nome
                  from cad c
                  join producao_terceirizados pt on pt.cad_id = c.id
                  join categorias_terceirizado ct on ct.id = pt.categoria_terceirizado_id
                 where c.modelo_id = f.id and coalesce(pt.ativo, true) <> false
                   and not (pt.data_entregue is not null and coalesce(pt.quantidade_enviada,0) > 0
                            and (coalesce(pt.quantidade_recebida,0) > 0 or coalesce(pt.quantidade_defeito,0) > 0))
                 order by case coalesce(ct.etapa,'ate_costura') when 'ate_costura' then 0 else 1 end,
                          coalesce(ct.ordem, 999), ct.nome
                 limit 1),
               'CQ')  -- serviços todos finalizados (ou sem serviço) → em CQ
             else null
           end
         )), '{}'::jsonb)
  from fase f;
$function$;

REVOKE EXECUTE ON FUNCTION public._plan_tecido_fases_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.plan_tecido_fases(_colecao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criacao não habilitado' using errcode = '42501';
  end if;
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from public.get_user_tenant_id() then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  return public._plan_tecido_fases_core(public.get_user_tenant_id(), _colecao_id);
end
$function$;
