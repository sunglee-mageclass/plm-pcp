-- Custos adicionais por modelo (Desenvolvimento > 6. Custos).
-- Linhas livres {descricao, valor} (por peça) adicionadas no card de Desenvolvimento. Entram no
-- PREVISTO (custo_peca_previsto, somado no front) E no REAL. A Previsão de Mão de Obra
-- (custo_terceirizados_previsto) segue previsto-only — o real usa serviços reais, não a previsão.

ALTER TABLE public.modelos
  ADD COLUMN IF NOT EXISTS custos_adicionais jsonb NOT NULL DEFAULT '[]'::jsonb;

-- custo_unitario_modelos: o ramo `real` (CAD enviado ao corte) ganha + Σ(custos_adicionais).
-- (No ramo não-confirmado, real = custo_peca_previsto, que já os inclui via o front — sem dupla contagem.)
CREATE OR REPLACE FUNCTION public.custo_unitario_modelos(_ids uuid[])
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
          else coalesce(ct.consumo_cad,0) * (1 + coalesce(ct.loss_percent_cad,0)/100.0) * coalesce(a.preco_por_metro,0) end)
        from cad_tecidos ct left join artigos a on a.id = ct.artigo_id where ct.cad_id = cc.cad_id), 0)
      + coalesce((select sum(coalesce(ca.consumo,0) * coalesce(av.preco,0))
        from cad_aviamentos ca left join aviamentos av on av.id = ca.aviamento_id where ca.cad_id = cc.cad_id), 0) as materials,
      coalesce((select sum(coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0)
            - coalesce(pt.desconto_total,0) + coalesce(pt.multa_total,0))
        from producao_terceirizados pt where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false), 0) as servico_total,
      coalesce((select sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)) from cad_grades g where g.cad_id = cc.cad_id), 0) as grade
    from cad_conf cc
  )
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    'previsto', coalesce(m.custo_peca_previsto,0),
    'real', case when exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
              then coalesce((select materials + case when grade > 0 then servico_total / grade else 0 end
                             from mat where mat.modelo_id = m.id), 0)
                   + coalesce((select sum((c->>'valor')::numeric)
                              from jsonb_array_elements(coalesce(m.custos_adicionais,'[]'::jsonb)) c), 0)
              else coalesce(m.custo_peca_previsto,0)
            end,
    'confirmado', exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
  )), '{}'::jsonb)
  into v_result
  from modelos m
  where m.tenant_id = v_tenant and m.id = any(_ids);

  return v_result;
end;
$function$;

select pg_notify('pgrst','reload schema');
