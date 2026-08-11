-- Fast-follow Revenda (ago/2026): trava otimista (rev + _rev_base + P0409) na grade
-- cor×tamanho do card de Revenda no Planejamento (`modelo_grades`, variante_numero=ordem).
-- Antes, o front (`criacao.planejamento.tsx`) fazia DELETE+INSERT DIRETO em `modelo_grades`
-- sem NENHUMA checagem de versão — last-write-wins puro entre duas abas/usuários editando a
-- mesma grade. Esta migration só fecha essa trava; NÃO é merge por célula (fora de escopo).
--
-- RPC `salvar_grade_revenda` no MOLDE do rev-check de `_salvar_modelo_bom_core`
-- (20260803190000_colab_trava_rev.sql): `_rev_base` null = bypass (card novo, sem
-- concorrência possível); informado = compara contra `modelos.rev` sob `FOR UPDATE` e dá
-- P0409 se alguém salvou no meio. O bump de `modelos.rev` é AUTOMÁTICO — `modelo_grades` já
-- tem o trigger `trg_colab_bump` (20260803180000_colab_rev_infra.sql, infra do piloto
-- colab) que faz um UPDATE no-op na raiz a cada INSERT/UPDATE/DELETE nela; não precisa de
-- bump explícito aqui.
--
-- Padrão wrapper/_core (invariante #9): _core com EXECUTE revogado dos TRÊS
-- (PUBLIC/anon/authenticated); wrapper com o gate de módulo + revogado de PUBLIC/anon,
-- concedido só a authenticated (mesmo padrão hardened em 20260807130000/20260807150000 —
-- não repetir o vazamento de ACL do wrapper já corrigido lá).

CREATE OR REPLACE FUNCTION public._salvar_grade_revenda_core(_modelo_id uuid, _grades jsonb, _rev_base integer DEFAULT NULL::integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_origem text;
  v_user uuid := auth.uid();
  g jsonb;
  v_grades jsonb;
  v_grade_total numeric;
  v_has_value boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- trava otimista (molde salvar_modelo_bom / spec 2026-08-03)
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.modelos
        where id = _modelo_id and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
        for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  SELECT tenant_id, origem INTO v_tenant, v_origem FROM public.modelos WHERE id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;

  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo';
  END IF;

  IF v_origem IS DISTINCT FROM 'revenda' THEN
    RAISE EXCEPTION 'Este modelo não é de Revenda (Produto Acabado) — grade cor×tamanho não se aplica.' USING ERRCODE='P0001';
  END IF;

  DELETE FROM public.modelo_grades WHERE modelo_id = _modelo_id;

  IF jsonb_typeof(_grades) = 'array' THEN
    FOR g IN SELECT value FROM jsonb_array_elements(COALESCE(_grades, '[]'::jsonb)) LOOP
      v_grades := COALESCE(g->'grades', '{}'::jsonb);
      v_grade_total := COALESCE((g->>'grade_total')::numeric, 0);
      v_has_value := false;
      IF v_grade_total > 0 THEN
        v_has_value := true;
      ELSIF jsonb_typeof(v_grades) = 'object' THEN
        SELECT EXISTS(
          SELECT 1 FROM jsonb_each_text(v_grades)
          WHERE NULLIF(value,'')::numeric > 0
        ) INTO v_has_value;
      END IF;
      IF v_has_value THEN
        INSERT INTO public.modelo_grades
          (modelo_id, variante_numero, grades, grade_total)
        VALUES
          (_modelo_id,
           (g->>'variante_numero')::int,
           v_grades,
           v_grade_total);
      END IF;
    END LOOP;
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.salvar_grade_revenda(_modelo_id uuid, _grades jsonb, _rev_base integer DEFAULT NULL::integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado (Revenda) não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._salvar_grade_revenda_core(_modelo_id, _grades, _rev_base);
END
$function$;

-- REVOKEs (invariante #9: dos TRÊS no _core; PUBLIC+anon no wrapper) ------
REVOKE EXECUTE ON FUNCTION public._salvar_grade_revenda_core(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.salvar_grade_revenda(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_grade_revenda(uuid, jsonb, integer) TO authenticated;
