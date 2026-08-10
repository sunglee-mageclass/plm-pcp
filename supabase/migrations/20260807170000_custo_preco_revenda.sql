-- Task 4/8 — Produto Acabado / Revenda: preco_atacado + ramo revenda no custo unitário.
--
-- 1) modelos.preco_atacado — coluna nova (RLS já cobre: mesma policy tenant de `modelos`).
-- 2) _custo_unitario_modelos_core: ADICIONA um ramo pro modelo `origem='revenda'` COM
--    produto vinculado (produtos_acabados.modelo_id = m.id). Fora desse ramo novo, o
--    caminho fica intacto — a lógica original (CTEs cad_conf/mat e as expressões de
--    'previsto'/'real'/'mao_obra_*'/'confirmado') é preservada BYTE-A-BYTE como o ramo
--    ELSE de cada CASE novo (conferido via pg_get_functiondef antes/depois — só o texto
--    dos 3 campos que ganham CASE muda; 'mao_obra_previsto'/'mao_obra_real' inalterados).
--    Lição da Task 3: leu-se a definição VIVA no banco (não a migration antiga) antes de
--    ramificar.
--
--    Regra revenda (produto vinculado):
--      previsto = pa.valor_unitario × (1 − pa.desconto_pct/100) + insumos_por_peça
--      real     = oc.valor_unitario_real + insumos_por_peça  (OC vinculada com
--                 status='recebido'; senão NULL)
--      confirmado = (oc.status = 'recebido')
--      insumos_por_peça = Σ (modelo_etiquetas.consumo × custo_previsto) do modelo
--    Modelo revenda SEM produto vinculado → cai no ELSE (comportamento atual, intacto).
--
-- 3) REVOKE re-aplicado no final: CREATE OR REPLACE preserva ACL, mas reforçamos por
--    defesa em profundidade (mesmo padrão das Tasks 1-3).

alter table public.modelos add column if not exists preco_atacado numeric(12,2);

create or replace function public._custo_unitario_modelos_core(_ids uuid[])
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
  )
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    'previsto', case when m.origem = 'revenda' and pa.modelo_id is not null
                  then coalesce(pa.valor_unitario,0) * (1 - coalesce(pa.desconto_pct,0)/100.0) + coalesce(pa.insumos_por_peca,0)
                else coalesce(m.custo_peca_previsto,0) end,
    'real', case when m.origem = 'revenda' and pa.modelo_id is not null
                  then case when pa.oc_status = 'recebido'
                         then coalesce(pa.valor_unitario_real,0) + coalesce(pa.insumos_por_peca,0)
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
                   else exists(select 1 from cad_conf cc where cc.modelo_id = m.id) end
  )), '{}'::jsonb)
  into v_result
  from modelos m
  left join pa on pa.modelo_id = m.id
  where m.tenant_id = v_tenant and m.id = any(_ids);

  return v_result;
end;
$function$;

revoke execute on function public._custo_unitario_modelos_core(uuid[]) from public, anon, authenticated;
