-- Achados MEDIOS, release R16 (so banco, sem site): preco M7 = prod #8, P-186 A (dono 01/out) + caronas R12 INFO 6 e
-- preco M1 (CTE pa).
--   _custo_unitario_modelos_core (FONTE UNICA do custo: custo_unitario_modelos -> Sheet/lista do Planejamento, Plan.
--   Tecido, OTB (2 telas), Dashboard (aba Comercial e custo_unitario_modelos direto), Lancamentos; _dashboard_custos_core;
--   integracao_listar/_previa/_marcar -> preco_custo do ERP): no modelo INTERNO cortado (cad enviado ao corte) o 'real'
--   trocava a M.O. prevista inteira pela M.O. LANCADA nos Servicos (externo / grade). Enquanto nada foi lancado, ou com
--   costura interna, o custo despencava (VESTAL da Loja Teste: 134,98 previsto -> 86,23 real, M.O. 60 sumia).
--   Agora a M.O. do 'real' e POR SERVICO:
--     - servico com bloco EXTERNO ativo no cad (producao_terceirizados interno=false, ativo) -> o valor LANCADO
--       (preco x qtd enviada - desconto + multa) / grade, como antes;
--     - servico SEM bloco externo -> a M.O. PREVISTA daquele servico (a linha de modelo_servico_mo da categoria);
--       costura/oficina INTERNA nunca tem lancado -> sempre a prevista;
--     - linha "Geral (legado)" (categoria NULL, backfill de antes da M.O. por servico): fica de fora quando o cad tem
--       bloco externo ativo de servico SEM linha propria no modelo (sem categoria ou de categoria sem linha) - esse
--       lancado e o que a substitui; senao entra a prevista (sem contar duas vezes a mesma M.O.);
--     - bloco externo INATIVO (servico desmarcado no PCP) nao conta mais como lancado (alinha ao Financeiro, que nao
--       cobra parcela nao paga de bloco inativo). Hoje: 0 blocos inativos em cads cortados (copia).
--   'mao_obra_real' passa a ser a M.O. EMBUTIDA no 'real' (lancado / grade + prevista dos servicos sem lancado): a
--   regra do front "Materiais = real - mao_obra_real" (criacao.planejamento.tsx custoMat, PlanejamentoDetail
--   maoObraSetor, custo-base.ts moEmbutidaDoCusto) segue fechando sem mudar o site. Materiais do 'real' seguem os do CAD.
--   Modelo nao cortado: intocado ('real' = custo_peca_previsto). Revenda/importado: a M.O. nao muda; 2 caronas
--   (controlador, 01/out) na MESMA funcao:
--     R12 INFO 6: compra RECEBIDA sem valor real voltava confirmado=true com real ~ 0 ("onde estourou" -100%). As
--       colunas ocs_p_acabado.valor_unitario_real e ocs_importado.custo_unitario_landed_real sao NOT NULL DEFAULT 0, entao
--       "sem valor real" = 0 (NULL nao acontece). Agora: revenda real = COALESCE(NULLIF(valor_unitario_real, 0),
--       valor_unitario x (1 - desconto_pct/100)) + insumos; importado real = COALESCE(NULLIF(landed_real, 0), landed do
--       card). Real 0 de verdade so se a compra tambem custa 0. Hoje: 0 OCs de compra recebidas (copia).
--     preco M1 (parte do CTE pa): insumos por peca da revenda = SUM(modelo_etiquetas.custo_previsto) - a linha ja e
--       preco x consumo x (1 + perda) (a ficha soma assim em totaisBom, ficha-calc.ts); antes multiplicava o consumo de
--       novo. Hoje: 0 casos (as 2 linhas de revenda tem consumo 1). FORA: _pa_recomputar_precos_modelo (l.33) ainda faz
--       consumo x custo_previsto no recompute do preco da revenda (BAIXA, a parte de preco do M1).
-- Efeito (so leitura; funcao STABLE, nada gravado muda): Passo 0 de producao (01/out 11:06) = 5 cortados, todos Loja
-- Teste (0c1ee839, 1494e80b, 1cf428ba, 28072185, 537d98e9; mesmos ids da copia). Na copia mudam 2:
--   1494e80b "Vestal"          real 86,23 -> 146,23 (CAD 86,23 + M.O. prevista "Geral" 60; o previsto 134,98 usa os
--                              materiais do BOM 74,98)  mao_obra_real 0 -> 60
--   28072185 "Blusa do Teste 1" real 12,37 -> 22,37 (Corte sem bloco: prevista 10; PL lancado 9 substitui o "Geral" 9)
--                              mao_obra_real 9 -> 19
--   0c1ee839 (Oficina+Corte lancados substituem o "Geral" 7), 1cf428ba (PL lancado, sem linha), 537d98e9 ("Geral" 0 +
--   PL lancado): sem mudanca.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._custo_unitario_modelos_core(uuid[])
--     ANTES  d26c7c9afb636f6ed26e66daf76e92ae  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS 49300957b8a81048211a0930dd0c04c7  (este arquivo; reaplicar = no-op)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (trava de objeto da propria funcao; nada em tabela, nada em auth/storage).
-- Sem DDL de tabela, sem DROP, sem funcao nova. ACL: CREATE OR REPLACE mantem a de hoje (so postgres/service_role -
-- inv. #9); a pos-condicao confere ACL identica e sem EXECUTE para PUBLIC/anon/authenticated. O wrapper
-- custo_unitario_modelos (gate de custo, inv. #12) nao muda.
-- Volta: supabase/rollback/20261026200000_custo_real_mo_prevista_down.sql (devolve o texto de antes, com guarda do de
-- depois). LIFO: o inverso DESTA roda ANTES de 20261022100000_dashboards_fonte_unica_down (R12; confere
-- _custo_unitario_modelos_core d26c7c9a como dependencia). Reaplicar a ida da R12 ou a 20261019300000_custo_previsto_servidor
-- (guarda 'dep' d26c7c9a) exige desfazer esta antes.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r16b_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r16b_md5_aceitos VALUES
  ('public._custo_unitario_modelos_core(uuid[])', 'd26c7c9afb636f6ed26e66daf76e92ae', 'antes'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._custo_unitario_modelos_core(uuid[])', '49300957b8a81048211a0930dd0c04c7', 'depois');  -- este arquivo; reaplicar = no-op

-- ACL de antes (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _r16b_acl_antes ON COMMIT DROP AS
  SELECT DISTINCT a.assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(a.assinatura)) AS acl
    FROM _r16b_md5_aceitos a;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _r16b_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'medios_r16_m7: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r16b_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r16_m7: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

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
        from producao_terceirizados pt where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false
          and coalesce(pt.ativo,true)), 0) as servico_total,
      coalesce((select sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)) from cad_grades g where g.cad_id = cc.cad_id), 0) as grade,
      -- [medios R16 preco M7, P-186 A] M.O. PREVISTA dos servicos SEM bloco externo lancado (por peca):
      --   linha de modelo_servico_mo COM categoria -> entra se o cad NAO tem bloco externo ativo daquela categoria
      --     (com bloco, vale o lancado, ja somado em servico_total); costura/oficina INTERNA nunca tem lancado -> prevista;
      --   linha "Geral (legado)" (categoria NULL) -> entra se o cad NAO tem bloco externo ativo de servico SEM linha
      --     propria (sem categoria, ou de categoria sem linha no modelo) - esse lancado e o que substitui o "Geral".
      coalesce((select sum(s.valor) from modelo_servico_mo s
        where s.modelo_id = cc.modelo_id
          and case when s.categoria_terceirizado_id is not null
                then not exists (select 1 from producao_terceirizados pt
                                  where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false and coalesce(pt.ativo,true)
                                    and pt.categoria_terceirizado_id = s.categoria_terceirizado_id)
                else not exists (select 1 from producao_terceirizados pt
                                  where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false and coalesce(pt.ativo,true)
                                    and (pt.categoria_terceirizado_id is null
                                         or not exists (select 1 from modelo_servico_mo s2
                                                         where s2.modelo_id = cc.modelo_id
                                                           and s2.categoria_terceirizado_id = pt.categoria_terceirizado_id)))
              end), 0) as mo_prevista_sem_lancado
    from cad_conf cc
  ),
  pa as (
    select p.modelo_id,
      p.valor_unitario,
      p.desconto_pct,
      oc.valor_unitario_real,
      oc.status as oc_status,
      -- [medios R16, preco M1] custo_previsto da linha JA e preco x consumo x (1 + perda) (por peca; = o que a ficha
      -- soma em totaisBom) -> soma direta (antes multiplicava o consumo de novo).
      coalesce((select sum(coalesce(me.custo_previsto,0))
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
                         -- [medios R16, R12 INFO 6] recebida sem valor real (a coluna e NOT NULL DEFAULT 0: "sem" = 0)
                         -- -> o valor da compra (bruto - desconto), nunca 0
                         then coalesce(nullif(pa.valor_unitario_real, 0),
                                       coalesce(pa.valor_unitario,0) * (1 - coalesce(pa.desconto_pct,0)/100.0))
                              + coalesce(pa.insumos_por_peca,0)
                       else null end
             when m.origem = 'importado' and imp.modelo_id is not null
                  then case when imp.oc_status = 'recebido'
                         -- [medios R16, R12 INFO 6] recebida sem landed real (NOT NULL DEFAULT 0: "sem" = 0) -> o
                         -- landed do card, nunca 0
                         then coalesce(nullif(imp.landed_real, 0), imp.landed, 0)
                       else null end
             when exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
               then coalesce((select materials + case when grade > 0 then servico_total / grade else 0 end
                                     + mo_prevista_sem_lancado
                              from mat where mat.modelo_id = m.id), 0)
                    + coalesce((select sum((c->>'valor')::numeric)
                               from jsonb_array_elements(coalesce(m.custos_adicionais,'[]'::jsonb)) c), 0)
             else coalesce(m.custo_peca_previsto,0)
           end,
    'mao_obra_previsto', coalesce((select sum(s.valor) from modelo_servico_mo s where s.modelo_id = m.id), 0),
    -- [medios R16 preco M7] M.O. embutida no 'real' = lancado / grade + prevista dos servicos sem lancado.
    'mao_obra_real', coalesce((select case when grade > 0 then servico_total / grade else 0 end + mo_prevista_sem_lancado
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
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _r16b_md5_aceitos WHERE papel IN ('depois','dep') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'medios_r16_m7: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- ACL identica a de antes (CREATE OR REPLACE nao mexe; conferido).
  FOR r IN SELECT assinatura, acl FROM _r16b_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'medios_r16_m7: pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: os internos seguem sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._custo_unitario_modelos_core(uuid[])')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_m7: % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r16_m7: % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
