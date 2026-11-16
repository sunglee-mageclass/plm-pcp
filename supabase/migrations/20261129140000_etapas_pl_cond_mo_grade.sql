-- Reforma das Etapas PL (Parte B) - migration 5 de 5: o catalogo de condicoes das Etapas PL ganha 2 condicoes do Desenvolvimento:
--   servico_aprovado ("M.O. aprovada": modelos.custo_terceirizados_aprovado) e grade_preenchida (soma de modelo_grades.grade_total > 0).
-- So catalogo (CREATE OR REPLACE FUNCTION + REVOKE); nenhum dado. Gerado de pg_get_functiondef + 1 troca exata (acrescenta 2 keys antes
-- de 'lancado'); as demais keys ficam byte a byte. Espelho TS: CONDICOES_PL em src/lib/etapas-pl-condicoes.ts (anti-drift SQL x TS em
-- tests/integration/kanban-pl-condicoes.test.ts; paridade Dev x PL em tests/integration/etapas-pl-cond-mo-grade.test.ts).
-- O Dev nao tem helper para esses 2 predicados (sao inline em _avaliar_condicoes_kanban_core); como o PL ja faz com peca_teste_aprovada, o
-- PL repete a MESMA expressao e a paridade e pinada por teste. Nenhuma das 2 esta em _kanban_cond_modulos(): vale em qualquer loja (a regra
-- "modulo desligado = nao se aplica" nao se aplica a elas, como no Dev).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])   ANTES f1b0fb725bac26981bdfede204238e78
-- ====================================================================================
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261129140000_etapas_pl_cond_mo_grade.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK. Banco ANTES do site. Volta: supabase/rollback/20261129140000_etapas_pl_cond_mo_grade_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $pre$
DECLARE
  v_ava text := md5(pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure));
BEGIN
  IF v_ava <> 'f1b0fb725bac26981bdfede204238e78'
     AND position('[reforma pt B]' in pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'reforma_pt_cond: _avaliar_condicoes_etapas_pl_core divergente (md5 %), esperado f1b0fb725bac26981bdfede204238e78', v_ava
      USING ERRCODE = 'P0001';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public._avaliar_condicoes_etapas_pl_core(_tenant uuid, _ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    -- peca_teste_aprovada: MESMO predicado do Dev (_avaliar_condicoes_kanban_core). Vacuoso true sem linha.
    'peca_teste_aprovada', not exists (
      select 1 from modelo_servico_mo pm
      join categorias_terceirizado pc on pc.id = pm.categoria_terceirizado_id and pc.tenant_id = m.tenant_id and pc.exige_peca_teste
      where pm.modelo_id = m.id
        and (pm.aprovado is not true
             or not public._peca_teste_aprovada(pm.id, pm.categoria_terceirizado_id, pm.empresa_id))),
    -- tem_peca_teste: EXISTE trilha de peca teste (linha de M.O. com categoria exige_peca_teste), aprovada OU nao.
    -- Porta de entrada da 1a coluna do kanban PL. DIFERENTE de peca_teste_aprovada (vacuamente true sem trilha).
    'tem_peca_teste', exists (
      select 1 from modelo_servico_mo pm
       join categorias_terceirizado pc
         on pc.id = pm.categoria_terceirizado_id and pc.tenant_id = m.tenant_id and pc.exige_peca_teste
       where pm.modelo_id = m.id),
    -- enviado_a_servicos: saiu da Explosao (cad.enviado_corte).
    'enviado_a_servicos', exists (select 1 from cad c where c.modelo_id = m.id and coalesce(c.enviado_corte, false)),
    -- materiais_separados: >=1 bloco ativo E TODOS com data_enviado (0 blocos = false).
    'materiais_separados', (
      exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true))
      and not exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true) and pt.data_enviado is null)
    ),
    -- grade_cortada_retornou: TODOS os blocos ativos tem alguma celula grade_detalhe com cortada>0 (0 blocos = false).
    'grade_cortada_retornou', (
      exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true))
      and not exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true)
          and not exists (
            select 1 from jsonb_path_query(coalesce(pt.grade_detalhe, '{}'::jsonb), '$.*.*') cell
            where coalesce((cell->>'cortada')::numeric, 0) > 0))
    ),
    -- oficina_entregue: TODOS os blocos ativos entregaram (data_entregue + quantidade_recebida>0) (0 blocos = false).
    'oficina_entregue', (
      exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true))
      and not exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true)
          and not (pt.data_entregue is not null and coalesce(pt.quantidade_recebida, 0) > 0))
    ),
    -- cq_liberado: _cq_liberado(c.id) do CAD do modelo (false sem CAD).
    'cq_liberado', coalesce((select bool_or(public._cq_liberado(c.id)) from cad c where c.modelo_id = m.id), false),
    -- [reforma pt B] servico_aprovado: MESMO predicado do Dev (_avaliar_condicoes_kanban_core): toda a M.O. aprovada (flag do card;
    -- vacuamente true sem linhas). Anti-drift Dev x PL em tests/integration/etapas-pl-cond-mo-grade.test.ts.
    'servico_aprovado', coalesce(m.custo_terceirizados_aprovado, false),
    -- [reforma pt B] grade_preenchida: MESMO predicado do Dev: soma de grade_total do modelo > 0.
    'grade_preenchida', coalesce((select sum(g.grade_total) from modelo_grades g where g.modelo_id = m.id), 0) > 0,
    -- lancado: fonte unica = modelos.lancado.
    'lancado', coalesce(m.lancado, false)
  )), '{}'::jsonb)
  from modelos m
  where m.tenant_id = _tenant and m.id = any(_ids);
$function$;
REVOKE EXECUTE ON FUNCTION public._avaliar_condicoes_etapas_pl_core(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

DO $pos$
BEGIN
  IF position('''servico_aprovado''' in pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure)) = 0
     OR position('''grade_preenchida''' in pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'reforma_pt_cond: pos-condicao falhou - as 2 keys novas nao estao no avaliador' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = 'public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure
                AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
                AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'reforma_pt_cond: pos-condicao falhou - ACL com EXECUTE para PUBLIC/anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
