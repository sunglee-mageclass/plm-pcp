-- MO por serviço — rollup derivado (2026-08-06). Torna custo_terceirizados_aprovado DERIVADO:
--   liberada = NOT EXISTS(linha do modelo com aprovado IS DISTINCT FROM true); sem linha = true.
-- Dois gatilhos: (M) BEFORE em modelos re-deriva o flag em qualquer write (à prova de adulteração);
-- (S) AFTER em modelo_servico_mo repinta o modelo. Aposenta trg_enforce_maodeobra_aprovacao
-- (o flag deixa de ser escrito pela UI; a permissão vira per-linha na Task 4). Repinta o
-- custo_unitario. Envolvido em BEGIN/COMMIT (troca de trigger + recompute de dado).
BEGIN;

-- Helper (invariante #9: REVOKE dos três).
CREATE OR REPLACE FUNCTION public._mo_liberada(_modelo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.modelo_servico_mo s
    WHERE s.modelo_id = _modelo_id AND s.aprovado IS DISTINCT FROM true
  );
$function$;
REVOKE EXECUTE ON FUNCTION public._mo_liberada(uuid) FROM PUBLIC, anon, authenticated;

-- (M) modelos: força o flag = derivado em todo INSERT/UPDATE (ignora o valor do cliente).
CREATE OR REPLACE FUNCTION public.fn_modelo_mo_flag_derivada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.custo_terceirizados_aprovado := public._mo_liberada(NEW.id);
  RETURN NEW;
END $function$;

-- (S) modelo_servico_mo: qualquer mudança de linha repinta o flag do modelo (dispara M).
CREATE OR REPLACE FUNCTION public.fn_modelo_servico_mo_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_modelo uuid := COALESCE(NEW.modelo_id, OLD.modelo_id);
BEGIN
  UPDATE public.modelos
     SET custo_terceirizados_aprovado = public._mo_liberada(v_modelo)
   WHERE id = v_modelo;
  RETURN COALESCE(NEW, OLD);
END $function$;

-- Aposenta o guard histórico (o flag não é mais escrito diretamente pela UI).
DROP TRIGGER IF EXISTS trg_enforce_maodeobra_aprovacao ON public.modelos;
DROP FUNCTION IF EXISTS public.enforce_maodeobra_aprovacao();

-- Instala os gatilhos.
DROP TRIGGER IF EXISTS trg_modelo_mo_flag ON public.modelos;
CREATE TRIGGER trg_modelo_mo_flag BEFORE INSERT OR UPDATE ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_mo_flag_derivada();

DROP TRIGGER IF EXISTS trg_modelo_servico_mo_rollup ON public.modelo_servico_mo;
CREATE TRIGGER trg_modelo_servico_mo_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.modelo_servico_mo
  FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_servico_mo_rollup();

-- Recompute único: só toca modelos cujo flag muda (evita ruído no audit_log). O trigger M
-- re-deriva na escrita; aqui filtramos pelas linhas que efetivamente vão mudar.
UPDATE public.modelos m
   SET custo_terceirizados_aprovado = public._mo_liberada(m.id)
 WHERE m.custo_terceirizados_aprovado IS DISTINCT FROM public._mo_liberada(m.id);

-- Repinta mao_obra_previsto no core do custo unitário: passa a somar modelo_servico_mo.valor.
-- (Só esta linha muda; o resto do core é idêntico ao atual — copiado na íntegra p/ CREATE OR REPLACE.)
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
    'mao_obra_previsto', coalesce((select sum(s.valor) from modelo_servico_mo s where s.modelo_id = m.id), 0),
    'mao_obra_real', coalesce((select case when grade > 0 then servico_total / grade else 0 end
                               from mat where mat.modelo_id = m.id), 0),
    'confirmado', exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
  )), '{}'::jsonb)
  into v_result
  from modelos m
  where m.tenant_id = v_tenant and m.id = any(_ids);

  return v_result;
end;
$function$;
-- Reassert do REVOKE (CREATE OR REPLACE preserva ACL, mas invariante #9 pede reassert).
REVOKE EXECUTE ON FUNCTION public._custo_unitario_modelos_core(uuid[]) FROM PUBLIC, anon, authenticated;

COMMIT;
