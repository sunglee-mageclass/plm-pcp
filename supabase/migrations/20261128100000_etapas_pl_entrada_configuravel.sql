-- Kanban PL - Onda 3 (telas), Tasks 1..3: entrada configuravel da 1a coluna do board PL.
-- ESTE ARQUIVO CRESCE: a Task 1 (esta parte) so adiciona a condicao `tem_peca_teste` ao avaliador SQL
-- (_avaliar_condicoes_etapas_pl_core); as Tasks 2/3 acrescentam fn_etapas_pl_entrada e o seed no MESMO arquivo.
--
-- tem_peca_teste = EXISTE linha modelo_servico_mo com categoria exige_peca_teste (aprovada OU nao). E a porta
-- de entrada da 1a coluna do board PL. NAO confundir com peca_teste_aprovada (vacuamente true sem trilha).
-- Espelho TS: CONDICOES_PL em src/lib/etapas-pl-condicoes.ts (anti-drift em tests/integration/kanban-pl-condicoes.test.ts).
--
-- ADITIVA, so catalogo (CREATE OR REPLACE; nao prende tabela). BEGIN...COMMIT. Idempotente.
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK. Banco ANTES do site.
-- Volta: devolver o corpo de antes de _avaliar_condicoes_etapas_pl_core (md5 3715a292f9cd18a4b8eaa06601e114e9)
-- (inverso em supabase/rollback/, escrito junto das Tasks seguintes se o controlador pedir).

BEGIN;

-- Guarda md5 ANTES (o corpo que esta migration substitui). Idempotente: se ja esta no "depois" (re-execucao), passa.
DO $pre$
DECLARE
  v_ava text := md5(pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure));
BEGIN
  IF v_ava <> '3715a292f9cd18a4b8eaa06601e114e9' AND position('tem_peca_teste' in pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'etapas_pl_entrada_configuravel: _avaliar_condicoes_etapas_pl_core divergente (md5 %), esperado 3715a292f9cd18a4b8eaa06601e114e9', v_ava;
  END IF;
END
$pre$;

-- 1) _avaliar_condicoes_etapas_pl_core: + key tem_peca_teste (as outras 7 byte a byte)
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
    -- lancado: fonte unica = modelos.lancado.
    'lancado', coalesce(m.lancado, false)
  )), '{}'::jsonb)
  from modelos m
  where m.tenant_id = _tenant and m.id = any(_ids);
$function$;

REVOKE EXECUTE ON FUNCTION public._avaliar_condicoes_etapas_pl_core(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

COMMIT;

select pg_notify('pgrst', 'reload schema');
