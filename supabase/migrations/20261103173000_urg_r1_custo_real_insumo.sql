-- Urgentes R1 T5 - custo REAL do insumo vinculado a UM tamanho rateado pela grade do CAD (Ruling A5).
-- GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-a.md (Task 5; mapa dos consumidores #9; Rulings A3, A5).
-- O que muda (1x CREATE OR REPLACE, troca EXATA de texto sobre o vivo, ancora 1x; ACL/DEFINER/STABLE/search_path preservados):
--   _custo_unitario_modelos_core, CTE mat (custo REAL do card INTERNO enviado ao corte): a soma de insumo do CAD (cad_etiquetas)
--   passa a ser consumo x FATOR x preco, FATOR = _insumo_fator_custo(_insumo_tamanho_de(insumo), _grade_mapa_cad(cad, real),
--   soma de coalesce(grade_total_real, grade_total_planejada, 0) de cad_grades) - o MESMO total que a coluna grade ja usa. Assim o
--   card cortado nao mostra real > previsto por insumo vinculado (o previsto ja e rateado pela 20261103171000).
--   Ramos revenda/importado (insumos_por_peca = soma do custo_previsto da linha) NAO mudam.
-- Insumo SEM vinculo (ou com tamanho proprio, Ruling A2): fator 1 => o MESMO valor de hoje (diff-validado byte a byte em TODAS as
-- lojas da copia, no estado real e com todo CAD "cortado" na txn: tests/integration/urg-a1-custo-real.test.ts). Funcao de LEITURA:
-- nenhum dado muda. A tela le pelo wrapper custo_unitario_modelos (mascara '{}' sem _pode_ver_custos - invariante 12), intocado.
-- Trava: SO catalogo (MEDIDO na copia, por diferenca de pg_locks: corpo plpgsql nao toca tabela na validacao; so AccessShare em
-- information_schema.columns da guarda) - nao bloqueia leitura nem escrita; NADA em auth/storage/realtime. Qualquer hora.
-- Idempotente.
-- ATENCAO (LIFO): enquanto esta migration estiver viva RECUSAM pela guarda md5 (fixam 4bf2770e4932d00914d5209a71ca6312) - desfazer ESTA antes:
--   supabase/rollback/20261026200000_custo_real_mo_prevista_down.sql
--   supabase/migrations/20261026200000_custo_real_mo_prevista.sql
--   supabase/migrations/20261028200000_revenda_insumo_preco.sql
--   (o _down da L8, 20261028200000_down, NAO confere esta funcao; so a re-aplicacao da ida da L8 a exige como dependencia.)
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._custo_unitario_modelos_core(uuid[])
--     ANTES  4bf2770e4932d00914d5209a71ca6312
--     DEPOIS 9c0b0f18df6b63a4990c3dda57e506a3
-- ====================================================================================
-- Volta: supabase/rollback/20261103173000_urg_r1_custo_real_insumo_down.sql (devolve o texto de ANTES) - ANTES do 20261103172000_down.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._custo_unitario_modelos_core(uuid[])', '4bf2770e4932d00914d5209a71ca6312', '9c0b0f18df6b63a4990c3dda57e506a3')
    ) AS x(f, a, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.d) THEN
      RAISE EXCEPTION 'urg_r1_173000: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- dependencia: os 6 helpers da 20261103170000 (o texto novo chama _insumo_fator_custo/_insumo_tamanho_de/_grade_mapa_cad)
  FOR r IN SELECT * FROM (VALUES
      ('public._insumo_tamanho_efetivo(text,text,boolean)', 'c3cdade8a88d585492eeb6a01205ce3e'),
      ('public._insumo_pecas(text,jsonb,numeric)', '2e1b701be975366933e9ad704cb25c18'),
      ('public._insumo_fator_custo(text,jsonb,numeric)', 'c32298c26ec5ed77856fd860299d958a'),
      ('public._insumo_tamanho_de(uuid)', '46fd6f65599f7de2d3ab12777fefa7d1'),
      ('public._grade_mapa_modelo(uuid)', '96b2a9c7e16fc789965dbf482b23b4c5'),
      ('public._grade_mapa_cad(uuid,boolean)', '44224a78f86abff7ac18f8e2051a7067')
    ) AS x(f, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.m
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'etiquetas'
                        AND column_name = 'tamanho_vinculado' AND data_type = 'text') THEN
      RAISE EXCEPTION 'urg_r1_173000: a 20261103170000 (coluna tamanho_vinculado + helpers) nao esta aplicada - aplique-a antes (falta %)', r.f
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

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
        from cad_aviamentos ca left join aviamentos av on av.id = ca.aviamento_id where ca.cad_id = cc.cad_id), 0)
      -- [urg R1] insumo vinculado a UM tamanho: custo REAL rateado como o previsto (Ruling A5) - consumo x fator, fator = pecas do
      -- tamanho / grade do CAD (_insumo_fator_custo: grade vazia = 1, tamanho fora da grade = 0), com o MESMO total da coluna grade
      -- abaixo (real, senao planejada, por linha de cad_grades). Insumo sem vinculo: fator 1 = o valor de antes.
      + COALESCE((SELECT SUM(COALESCE(ce.consumo,0)
          * public._insumo_fator_custo(public._insumo_tamanho_de(ce.etiqueta_id), public._grade_mapa_cad(cc.cad_id, true),
              (SELECT coalesce(sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)),0) FROM cad_grades g WHERE g.cad_id = cc.cad_id))
          * COALESCE(NULLIF((SELECT MAX(COALESCE(ve.preco,0)) FROM variantes_etiqueta ve WHERE ve.etiqueta_id = ce.etiqueta_id AND ve.cor_id IS NOT DISTINCT FROM ce.cor_id),0), (SELECT et.preco FROM etiquetas et WHERE et.id = ce.etiqueta_id), 0)) FROM cad_etiquetas ce WHERE ce.cad_id = cc.cad_id), 0) as materials,
      coalesce((select sum(coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0)
            - coalesce(pt.desconto_total,0) + coalesce(pt.multa_total,0))
        from producao_terceirizados pt where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false
          and coalesce(pt.ativo,true)
          -- [R16 fix round 1/2, M2 + INFO R1] "o lancado" do servico = bloco com BRUTO (preco x qtd) > 0; soma o liquido
          -- (bruto - desconto + multa), que pode ser 0 (servico feito e todo descontado = custo 0, nao a prevista)
          and coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0) > 0), 0) as servico_total,
      coalesce((select sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)) from cad_grades g where g.cad_id = cc.cad_id), 0) as grade,
      -- [medios R16 preco M7, P-186 A] M.O. PREVISTA dos servicos SEM bloco externo lancado (por peca):
      --   (fix round 1/2, M2 + INFO R1: "lancado" = bloco externo ativo com BRUTO preco x qtd > 0; bloco vazio ainda nao
      --   lancou -> vale a prevista daquele servico; bloco lancado e todo descontado -> custo 0, nao a prevista)
      --   linha de modelo_servico_mo COM categoria -> entra se o cad NAO tem bloco externo ativo daquela categoria
      --     (com bloco, vale o lancado, ja somado em servico_total); costura/oficina INTERNA nunca tem lancado -> prevista;
      --   linha "Geral (legado)" (categoria NULL) -> entra se o cad NAO tem bloco externo ativo de servico SEM linha
      --     propria (sem categoria, ou de categoria sem linha no modelo) - esse lancado e o que substitui o "Geral".
      coalesce((select sum(s.valor) from modelo_servico_mo s
        where s.modelo_id = cc.modelo_id
          and case when s.categoria_terceirizado_id is not null
                then not exists (select 1 from producao_terceirizados pt
                                  where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false and coalesce(pt.ativo,true)
                                    and coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0) > 0
                                    and pt.categoria_terceirizado_id = s.categoria_terceirizado_id)
                else not exists (select 1 from producao_terceirizados pt
                                  where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false and coalesce(pt.ativo,true)
                                    and coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0) > 0
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
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._custo_unitario_modelos_core(uuid[])', '9c0b0f18df6b63a4990c3dda57e506a3', '{postgres=X/postgres,service_role=X/postgres}', true, 's')
    ) AS x(f, m, acl, sd, vol) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r1_173000: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND p.provolatile::text = r.vol
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r1_173000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
