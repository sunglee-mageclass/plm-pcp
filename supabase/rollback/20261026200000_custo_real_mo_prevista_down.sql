-- INVERSO de supabase/migrations/20261026200000_custo_real_mo_prevista.sql (achados MEDIOS R16: preco M7, P-186 A).
-- Devolve o texto de ANTES de _custo_unitario_modelos_core (o 'real' do cortado usa so a M.O. lancada / grade; a
-- prevista some; compra recebida sem valor real volta a real ~ 0; insumos da revenda voltam a consumo x custo_previsto).
-- Guarda: so roda se a funcao esta EXATAMENTE com o texto da ida (md5 de depois); outro -> P0001 e nada
-- muda. Nada gravado muda (funcao de leitura). LIFO: este inverso roda ANTES de
-- 20261022100000_dashboards_fonte_unica_down (R12), que confere o texto que esta volta devolve (d26c7c9a). Sem site.
-- Travas: so CREATE OR REPLACE FUNCTION. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._custo_unitario_modelos_core(uuid[])', '4bf2770e4932d00914d5209a71ca6312')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r16_m7 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r16_m7 (volta): % nao esta com o texto esperado da ida (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- ACL de antes da volta (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _r16bv_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public._custo_unitario_modelos_core(uuid[])')) v(s);

CREATE OR REPLACE FUNCTION public._custo_unitario_modelos_core(_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  with cad_conf as (
    select distinct on (c.modelo_id) c.modelo_id, c.id as cad_id
    from cad c
    where c.tenant_id = v_tenant and c.enviado_corte
    order by c.modelo_id, c.data_enviado_corte desc nulls last
  ),
  mat as (
    select cc.modelo_id,
      coalesce((select sum(case when ct.custo_cad is not null then ct.custo_cad
          else coalesce(ct.consumo_cad,0) * (1 + coalesce(ct.loss_percent_cad,0)/100.0)
               * public._preco_tecido_por_metro(cc.modelo_id, ct.tipo, ct.numero, ct.artigo_id) end)
        from cad_tecidos ct where ct.cad_id = cc.cad_id), 0)
      + coalesce((select sum(coalesce(ca.consumo,0) * coalesce(av.preco,0))
        from cad_aviamentos ca left join aviamentos av on av.id = ca.aviamento_id where ca.cad_id = cc.cad_id), 0) + COALESCE((SELECT SUM(COALESCE(ce.consumo,0) * COALESCE(NULLIF((SELECT MAX(COALESCE(ve.preco,0)) FROM variantes_etiqueta ve WHERE ve.etiqueta_id = ce.etiqueta_id AND ve.cor_id IS NOT DISTINCT FROM ce.cor_id),0), (SELECT et.preco FROM etiquetas et WHERE et.id = ce.etiqueta_id), 0)) FROM cad_etiquetas ce WHERE ce.cad_id = cc.cad_id), 0) as materials,
      coalesce((select sum(coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0)
            - coalesce(pt.desconto_total,0) + coalesce(pt.multa_total,0))
        from producao_terceirizados pt where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false), 0) as servico_total,
      coalesce((select sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)) from cad_grades g where g.cad_id = cc.cad_id), 0) as grade
    from cad_conf cc
  ),
  pa as (
    select p.modelo_id,
      p.valor_unitario,
      p.desconto_pct,
      oc.valor_unitario_real,
      oc.status as oc_status,
      coalesce((select sum(coalesce(me.consumo,0) * coalesce(me.custo_previsto,0))
                from modelo_etiquetas me where me.modelo_id = p.modelo_id), 0) as insumos_por_peca
    from produtos_acabados p
    left join ocs_p_acabado oc on oc.produto_acabado_id = p.id
    where p.tenant_id = v_tenant and p.modelo_id is not null
  ),
  imp as (
    -- Card: `landed` (previsto). OC (se vinculada): status + custo landed REAL da OC.
    select p.modelo_id,
      public._imp_custo_landed(p.id) as landed,
      oc.status as oc_status,
      oc.custo_unitario_landed_real as landed_real
    from produtos_importados p
    left join ocs_importado oc on oc.produto_importado_id = p.id
    where p.tenant_id = v_tenant and p.modelo_id is not null
  )
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    'previsto', case when m.origem = 'revenda' and pa.modelo_id is not null
                  then coalesce(pa.valor_unitario,0) * (1 - coalesce(pa.desconto_pct,0)/100.0) + coalesce(pa.insumos_por_peca,0)
                when m.origem = 'importado' and imp.modelo_id is not null
                  then coalesce(imp.landed,0)
                else coalesce(m.custo_peca_previsto,0) end,
    'real', case when m.origem = 'revenda' and pa.modelo_id is not null
                  then case when pa.oc_status = 'recebido'
                         then coalesce(pa.valor_unitario_real,0) + coalesce(pa.insumos_por_peca,0)
                       else null end
             when m.origem = 'importado' and imp.modelo_id is not null
                  then case when imp.oc_status = 'recebido'
                         then coalesce(imp.landed_real,0)
                       else null end
             when exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
               then coalesce((select materials + case when grade > 0 then servico_total / grade else 0 end
                              from mat where mat.modelo_id = m.id), 0)
                    + coalesce((select sum((c->>'valor')::numeric)
                               from jsonb_array_elements(coalesce(m.custos_adicionais,'[]'::jsonb)) c), 0)
             else coalesce(m.custo_peca_previsto,0)
           end,
    'mao_obra_previsto', coalesce((select sum(s.valor) from modelo_servico_mo s where s.modelo_id = m.id), 0),
    'mao_obra_real', coalesce((select case when grade > 0 then servico_total / grade else 0 end
                                from mat where mat.modelo_id = m.id), 0),
    'confirmado', case when m.origem = 'revenda' and pa.modelo_id is not null
                     then coalesce(pa.oc_status = 'recebido', false)
                   when m.origem = 'importado' and imp.modelo_id is not null
                     then coalesce(imp.oc_status = 'recebido', false)
                   else exists(select 1 from cad_conf cc where cc.modelo_id = m.id) end
  )), '{}'::jsonb)
  into v_result
  from modelos m
  left join pa on pa.modelo_id = m.id
  left join imp on imp.modelo_id = m.id
  where m.tenant_id = v_tenant and m.id = any(_ids);

  return v_result;
end;
$function$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._custo_unitario_modelos_core(uuid[])', 'd26c7c9afb636f6ed26e66daf76e92ae')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r16_m7 (volta): pos-condicao falhou - % nao voltou ao texto de antes (md5 %)', r.s,
        md5(pg_get_functiondef(to_regprocedure(r.s))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT assinatura, acl FROM _r16bv_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'medios_r16_m7 (volta): pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: os internos seguem sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._custo_unitario_modelos_core(uuid[])')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_m7 (volta): % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_m7 (volta): % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
