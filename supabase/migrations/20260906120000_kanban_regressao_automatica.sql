-- Kanban — FASE 2: REGRESSÃO AUTOMÁTICA de etapa (Desenvolvimento, fluxo INTERNO)
-- ============================================================================
-- A cascata de ENTRADA (Fase 1) impede o card de PULAR para uma etapa adiantada sem
-- cumprir os requisitos das anteriores. Mas não faz o card VOLTAR se um requisito de
-- etapa anterior é DESFEITO depois (ex.: MO aprovada→reprovada, CQ desmarcado). Este
-- migration fecha esse buraco: quando um requisito cai, o card MOVE de coluna.
--
-- ALVO (decisão do dono): o card vai EXATAMENTE para a coluna que EXIGE o requisito
-- perdido — a PRIMEIRA coluna (na ordem do board) cujos requisitos EFETIVOS (cascata)
-- incluem alguma condição não satisfeita. Se vários requisitos caem, vai para a mais
-- ATRÁS (a primeira que falha), não deixando requisito pendente à frente. Só MOVE se o
-- card está À FRENTE dessa coluna (nunca empurra pra frente) — espelha o padrão dos
-- rebaixamentos existentes (`fn_rebaixa_lancado_cq`, `fn_rebaixa_direcionamento_grade`),
-- que só agem em quem estava adiantado. Acende `#Erro` (`revisao_pendente.kanban`).
--
-- Fluxo COMPRADO (revenda/importado): fluxo próprio (`revenda_kanban_*`), SEM cascata →
-- SEM esta regressão. `origem IS DISTINCT FROM 'interno'` sai cedo.
--
-- SSOT compartilhado: a ORDEM/keys das colunas vêm de `_kanban_status_rows` (mesma fonte do
-- board e de `_ref_exibir_gate`); os requisitos por coluna de `tenant_config.kanban_requisitos`
-- (+`_excecoes`). A cascata `requisitosEfetivos`/`colunaRegressaoAlvo` (src/lib/kanban-condicoes.ts)
-- é espelhada MANUALMENTE aqui em SQL — o TS é o SSOT testável em Vitest
-- (tests/unit/kanban-regressao.test.ts); ESTE espelho SQL é validado por teste transacional no
-- banco (BEGIN…ROLLBACK), NÃO há trava automática de drift. Ao mudar um lado, atualize o outro.
-- A avaliação das ~32 condições é reusada de `avaliar_condicoes_kanban` via `_core` extraído.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Extrai o CORE de avaliar_condicoes_kanban (parametrizado por tenant) para poder
--    ser chamado por trigger (fora do contexto de get_user_tenant_id()). O wrapper
--    público mantém a assinatura/segurança de hoje. Corpo das condições IDÊNTICO.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._avaliar_condicoes_kanban_core(_tenant uuid, _ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    -- Planejamento
    'categoria_definida', m.categoria_principal_id is not null,
    'subcategoria1_definida', m.subcategoria1_id is not null,
    'subcategoria2_definida', m.subcategoria2_id is not null,
    'estilista_definido', m.estilista_id is not null,
    'linha_definida', m.linha_id is not null,
    'colecao_preenchida', coalesce(btrim(m.colecao),'') <> '',
    'tecido_planejado', coalesce(array_length(m.tecidos_planejados, 1), 0) > 0,
    'ordem_criacao_enviada', coalesce(m.ordem_criacao_enviada, false),
    'preco_venda_preenchido', coalesce(m.preco_venda, 0) > 0,
    'data_lancamento_preenchida', m.data_lancamento is not null,
    'lancado', coalesce(m.lancado, false),
    -- Desenvolvimento
    'modelista_definido', m.modelista_id is not null,
    'piloteiro_definido', (m.piloteiro1_id is not null or m.piloteiro2_id is not null or m.piloteiro3_id is not null),
    'data_desenho_tecnico', m.data_desenho_tecnico is not null,
    'data_piloto1', m.data_piloto1 is not null,
    'data_piloto2', m.data_piloto2 is not null,
    'data_piloto3', m.data_piloto3 is not null,
    'data_aprovacao', m.data_aprovacao is not null,
    'grade_preenchida', coalesce((select sum(g.grade_total) from modelo_grades g where g.modelo_id = m.id), 0) > 0,
    'grade_todas_variantes', (
      with vc as (
        select count(*) as n
        from modelo_tecidos mt
        join modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id
        where mt.modelo_id = m.id and mt.tipo = 'tecido' and mt.numero = 1
          and mtv.variante_tecido_id is not null
      )
      select vc.n > 0 and vc.n = (
        select count(distinct g.variante_numero)
        from modelo_grades g
        where g.modelo_id = m.id and coalesce(g.grade_total,0) > 0
          and g.variante_numero between 1 and vc.n
      )
      from vc),
    'tecido_com_variante', exists (
      select 1 from modelo_tecidos mt
      join modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id
      where mt.modelo_id = m.id and mt.tipo = 'tecido'),
    'aviamento_definido', exists (select 1 from modelo_aviamentos ma where ma.modelo_id = m.id and ma.aviamento_id is not null),
    'anexo_croqui', coalesce(m.croqui_url, '') <> '',
    'desenho_tecnico_anexado', coalesce(m.desenho_tecnico_url, '') <> '',
    'anexo_modelo', coalesce(array_length(m.fotos_modelo, 1), 0) > 0,
    'ficha_medida_anexada', coalesce(m.ficha_medida_url, '') <> '',
    'enviado_cad', coalesce(m.enviado_cad, false),
    -- CAD
    'cad_preenchido', exists (
      select 1
      from cad c
      join cad_tecidos ct on ct.cad_id = c.id
      join cad_tecido_variantes ctv on ctv.cad_tecido_id = ct.id
      where c.modelo_id = m.id
        and (coalesce(ct.tamanho_folha, 0) > 0
             or coalesce(ctv.quantidade_folhas, 0) > 0
             or coalesce(ctv.metragem_planejada, 0) > 0)
    ),
    -- Produção / Serviços
    'servico_aprovado', coalesce(m.custo_terceirizados_aprovado, false),
    'servico_finalizado', (
      select count(*) filter (where coalesce(pt.ativo, true)) > 0
         and count(*) filter (where coalesce(pt.ativo, true) and not (
              pt.data_entregue is not null and coalesce(pt.quantidade_enviada, 0) > 0
              and (coalesce(pt.quantidade_recebida, 0) > 0 or coalesce(pt.quantidade_defeito, 0) > 0)
            )) = 0
      from producao_terceirizados pt join cad c on c.id = pt.cad_id
      where c.modelo_id = m.id),
    'grade_cortada_lancada', exists (
      select 1
      from cad c
      join producao_terceirizados pt on pt.id = public._resolver_fonte_confeccao(c.id)
      join lateral jsonb_path_query(coalesce(pt.grade_detalhe, '{}'::jsonb), '$.*.*') cell on true
      where c.modelo_id = m.id
        and coalesce((cell->>'cortada')::numeric, 0) > 0
    ),
    'direcionamento_feito', exists (select 1 from cad c where c.modelo_id = m.id and c.direcionamento_confirmado_at is not null),
    -- CQ
    'cq_confirmado', exists (select 1 from cad c join controle_qualidade cq on cq.cad_id = c.id where c.modelo_id = m.id and cq.status = 'confirmado'),
    'cq_pos_confirmado', exists (select 1 from cad c join controle_qualidade cq on cq.cad_id = c.id where c.modelo_id = m.id and cq.status_pos = 'confirmado'),
    'cq_liberado', coalesce((select public._cq_liberado(c.id) from cad c where c.modelo_id = m.id), false)
  )), '{}'::jsonb)
  from modelos m
  where m.tenant_id = _tenant and m.id = any(_ids);
$function$;

-- Wrapper público inalterado na assinatura/segurança — só delega ao core.
CREATE OR REPLACE FUNCTION public.avaliar_condicoes_kanban(_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public._avaliar_condicoes_kanban_core(public.get_user_tenant_id(), _ids);
$function$;

REVOKE EXECUTE ON FUNCTION public._avaliar_condicoes_kanban_core(uuid, uuid[]) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.avaliar_condicoes_kanban(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_condicoes_kanban(uuid[]) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Núcleo da regressão: para 1 modelo, acha a coluna-alvo e move se estiver à frente.
--    Espelha requisitosEfetivos (cascata) em SQL. Só fluxo INTERNO.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_regredir_modelo(_modelo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_origem text;
  v_status text;
  v_lancado boolean;
  v_cur_idx int;
  v_reqs jsonb;      -- tenant_config.kanban_requisitos
  v_exc jsonb;       -- tenant_config.kanban_requisitos_excecoes
  v_cond jsonb;      -- mapa condição→bool do modelo
  v_col record;
  v_acc text[] := '{}';   -- requisitos efetivos acumulados (cascata) até a coluna corrente
  v_k text;
  v_exc_col text[];
  v_alvo_idx int := null;
  v_alvo_key text := null;
  v_falhou boolean;
BEGIN
  SELECT m.tenant_id, coalesce(m.origem,'interno'), m.status_desenvolvimento, coalesce(m.lancado,false)
    INTO v_tenant, v_origem, v_status, v_lancado
    FROM public.modelos m WHERE m.id = _modelo_id;
  IF v_tenant IS NULL THEN RETURN; END IF;                 -- modelo sumiu (cascade delete)
  IF v_origem IS DISTINCT FROM 'interno' THEN RETURN; END IF;  -- comprado: fluxo próprio, sem cascata
  IF v_lancado THEN RETURN; END IF;                        -- lançado: sai do fluxo; rebaixa é via CQ

  -- Config de requisitos por coluna (própria de cada etapa) + exceções.
  SELECT coalesce(kanban_requisitos, '{}'::jsonb), coalesce(kanban_requisitos_excecoes, '{}'::jsonb)
    INTO v_reqs, v_exc
    FROM public.tenant_config WHERE tenant_id = v_tenant;
  IF v_reqs IS NULL OR v_reqs = '{}'::jsonb THEN RETURN; END IF;  -- loja sem requisitos: nada a regredir

  -- Índice da coluna ATUAL do card na ordem do board (null → não está no board conhecido → sai).
  SELECT r.ord INTO v_cur_idx
    FROM public._kanban_status_rows(v_tenant) r
    WHERE r.key = lower(btrim(coalesce(v_status,''))) ORDER BY r.ord LIMIT 1;
  IF v_cur_idx IS NULL THEN RETURN; END IF;

  -- Mapa de condições do modelo (mesma fonte da RPC de avaliação).
  v_cond := coalesce(public._avaliar_condicoes_kanban_core(v_tenant, ARRAY[_modelo_id]) -> _modelo_id::text, '{}'::jsonb);

  -- Caminha as colunas na ORDEM do board; acumula os requisitos efetivos (cascata) e acha a
  -- PRIMEIRA coluna cujos requisitos efetivos incluem alguma condição NÃO satisfeita.
  FOR v_col IN SELECT r.ord, r.key FROM public._kanban_status_rows(v_tenant) r ORDER BY r.ord LOOP
    -- soma os requisitos PRÓPRIOS desta coluna
    FOR v_k IN SELECT jsonb_array_elements_text(coalesce(v_reqs -> v_col.key, '[]'::jsonb)) LOOP
      IF NOT (v_k = ANY(v_acc)) THEN v_acc := array_append(v_acc, v_k); END IF;
    END LOOP;
    -- subtrai as EXCEÇÕES desta coluna (herdados que o admin desligou aqui) — igual ao TS:
    -- só remove o que NÃO é próprio desta coluna.
    SELECT array_agg(x) INTO v_exc_col
      FROM jsonb_array_elements_text(coalesce(v_exc -> v_col.key, '[]'::jsonb)) x
      WHERE NOT (x IN (SELECT jsonb_array_elements_text(coalesce(v_reqs -> v_col.key, '[]'::jsonb))));
    IF v_exc_col IS NOT NULL THEN
      v_acc := ARRAY(SELECT a FROM unnest(v_acc) a WHERE NOT (a = ANY(v_exc_col)));
    END IF;

    -- esta coluna falha se algum requisito efetivo NÃO está satisfeito no mapa de condições
    v_falhou := EXISTS (
      SELECT 1 FROM unnest(v_acc) req
      WHERE coalesce((v_cond ->> req)::boolean, false) = false
    );
    IF v_falhou THEN
      v_alvo_idx := v_col.ord;
      v_alvo_key := v_col.key;
      EXIT;  -- a PRIMEIRA que falha é o alvo (a mais atrás)
    END IF;
  END LOOP;

  -- Move só se: existe coluna que falha E o card está À FRENTE dela.
  IF v_alvo_idx IS NOT NULL AND v_cur_idx > v_alvo_idx THEN
    UPDATE public.modelos
      SET status_desenvolvimento = v_alvo_key,
          revisao_pendente = coalesce(revisao_pendente, '{}'::jsonb) || '{"kanban": true}'::jsonb
      WHERE id = _modelo_id;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._kanban_regredir_modelo(uuid) FROM public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Triggers nas TABELAS-FONTE. Cada um resolve o(s) modelo(s) afetado(s) e chama a
--    regressão. Guarda de mudança onde faz sentido (evita trabalho à toa).
-- ────────────────────────────────────────────────────────────────────────────

-- 3a) modelos: quando muda uma coluna que É fonte de condição (flag de MO derivado,
--     enviado_cad, grade/tecido são em outras tabelas). Guardamos em custo_terceirizados_aprovado
--     e enviado_cad — as duas colunas de modelos que viram condição e podem CAIR.
--     (Não reagimos a status_desenvolvimento aqui — senão a própria regressão recursaria.)
CREATE OR REPLACE FUNCTION public.fn_kanban_regredir_modelos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.custo_terceirizados_aprovado IS DISTINCT FROM OLD.custo_terceirizados_aprovado
     OR NEW.enviado_cad IS DISTINCT FROM OLD.enviado_cad THEN
    PERFORM public._kanban_regredir_modelo(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_regredir_modelos ON public.modelos;
CREATE TRIGGER trg_kanban_regredir_modelos
  AFTER UPDATE OF custo_terceirizados_aprovado, enviado_cad ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_regredir_modelos();

-- 3b) controle_qualidade: status/status_pos mudou (afeta cq_confirmado/pos/liberado).
CREATE OR REPLACE FUNCTION public.fn_kanban_regredir_cq()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_modelo uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.status_pos IS NOT DISTINCT FROM OLD.status_pos THEN
    RETURN NEW;
  END IF;
  SELECT c.modelo_id INTO v_modelo FROM public.cad c WHERE c.id = coalesce(NEW.cad_id, OLD.cad_id);
  IF v_modelo IS NOT NULL THEN PERFORM public._kanban_regredir_modelo(v_modelo); END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_regredir_cq ON public.controle_qualidade;
CREATE TRIGGER trg_kanban_regredir_cq
  AFTER INSERT OR UPDATE OF status, status_pos ON public.controle_qualidade
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_regredir_cq();

-- 3c) cad: direcionamento_confirmado_at (direcionamento_feito) / enviado_corte mudou.
CREATE OR REPLACE FUNCTION public.fn_kanban_regredir_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.direcionamento_confirmado_at IS NOT DISTINCT FROM OLD.direcionamento_confirmado_at
     AND NEW.enviado_corte IS NOT DISTINCT FROM OLD.enviado_corte THEN
    RETURN NEW;
  END IF;
  IF NEW.modelo_id IS NOT NULL THEN PERFORM public._kanban_regredir_modelo(NEW.modelo_id); END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_regredir_cad ON public.cad;
CREATE TRIGGER trg_kanban_regredir_cad
  AFTER UPDATE OF direcionamento_confirmado_at, enviado_corte ON public.cad
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_regredir_cad();

-- 3d) cad_grades: grades_reais mudou (grade real → afeta condições de grade cortada etc.
--     via _resolver_fonte_confeccao/grade_cortada_lancada e grade). Só UPDATE (o
--     salvar_cad_completo faz DELETE+INSERT; re-inserção não é mudança real — mesmo
--     racional de fn_rebaixa_direcionamento_grade).
CREATE OR REPLACE FUNCTION public.fn_kanban_regredir_cad_grades()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_modelo uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.grades_reais IS NOT DISTINCT FROM OLD.grades_reais THEN RETURN NEW; END IF;
  SELECT c.modelo_id INTO v_modelo FROM public.cad c WHERE c.id = NEW.cad_id;
  IF v_modelo IS NOT NULL THEN PERFORM public._kanban_regredir_modelo(v_modelo); END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_regredir_cad_grades ON public.cad_grades;
CREATE TRIGGER trg_kanban_regredir_cad_grades
  AFTER UPDATE OF grades_reais ON public.cad_grades
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_regredir_cad_grades();

COMMIT;
