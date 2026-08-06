-- MO por serviço — fix round 1 (2026-08-06). Dois furos do gate de aprovação:
--   (1) ALTA — o DELETE do estado-completo em salvar_modelo_servico_mo apagava uma linha
--       pendente/reprovada (aprovado IS DISTINCT FROM true) SEM permissão; o rollup então
--       recalculava _mo_liberada=true e o Lançar passava (fura invariante #8/#12). O gate
--       existente cobria só INSERT/UPDATE de `aprovado`. Fix: BEFORE DELETE por-linha.
--   (2) MÉDIA — salvar aceitava categoria INATIVA ao criar linha NOVA. Fix: exigir ativo=true
--       só no INSERT de linha nova (UPDATE de linha histórica em categoria desativada segue
--       permitido, preservando o soft-hide; legado categoria NULL é sempre permitido).
-- Idempotente; envolto em BEGIN/COMMIT.
BEGIN;

-- (1) Gate por-linha no DELETE. Apagar linha NÃO-aprovada libera o modelo (mesmo efeito de
-- aprovar) → exige producao_servico_aprovacao. Apagar linha JÁ aprovada = remover serviço, livre.
-- Guarda de cascade: se o modelo pai já sumiu (DELETE de modelos cascateando p/ os filhos via
-- ON DELETE CASCADE), NÃO gateia — a exclusão do modelo tem sua própria autorização e não há
-- "liberação" a furar (o modelo deixa de existir).
CREATE OR REPLACE FUNCTION public.enforce_servico_mo_del_aprovacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.aprovado IS DISTINCT FROM true
     AND EXISTS (SELECT 1 FROM public.modelos WHERE id = OLD.modelo_id)
     AND NOT public.user_can_edit('producao_servico_aprovacao') THEN
    RAISE EXCEPTION 'Sem permissão para remover mão de obra pendente/reprovada' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $function$;

DROP TRIGGER IF EXISTS trg_enforce_servico_mo_del_aprovacao ON public.modelo_servico_mo;
CREATE TRIGGER trg_enforce_servico_mo_del_aprovacao
  BEFORE DELETE ON public.modelo_servico_mo
  FOR EACH ROW EXECUTE FUNCTION public.enforce_servico_mo_del_aprovacao();

-- (2) salvar: mesma lógica de antes + guarda de categoria ATIVA no INSERT de linha nova.
-- (Copiado na íntegra p/ CREATE OR REPLACE; a única mudança é o check de ativo no ramo NOT FOUND.)
CREATE OR REPLACE FUNCTION public._salvar_modelo_servico_mo_core(_modelo_id uuid, _linhas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_keep uuid[] := '{}';   -- categoria_terceirizado_id presentes (NULL não entra aqui)
  v_tem_legado boolean := false;
  r jsonb; v_cat uuid; v_valor numeric; v_obs text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido: as linhas de MO devem ser uma lista' USING ERRCODE = 'P0001';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(_linhas) LOOP
    v_cat := NULLIF(r->>'categoria_terceirizado_id','')::uuid;
    v_valor := COALESCE((r->>'valor')::numeric, 0);
    v_obs := NULLIF(r->>'observacoes','');
    IF v_cat IS NULL THEN
      v_tem_legado := true;
      UPDATE public.modelo_servico_mo
         SET valor = v_valor, observacoes = v_obs, updated_at = now()
       WHERE modelo_id = _modelo_id AND categoria_terceirizado_id IS NULL;
      IF NOT FOUND THEN
        INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, observacoes)
        VALUES (v_tenant, _modelo_id, NULL, v_valor, v_obs);
      END IF;
    ELSE
      -- a categoria tem que ser do tenant
      IF NOT EXISTS (SELECT 1 FROM public.categorias_terceirizado
                      WHERE id = v_cat AND tenant_id = v_tenant) THEN
        RAISE EXCEPTION 'Serviço inválido' USING ERRCODE = 'P0001';
      END IF;
      v_keep := array_append(v_keep, v_cat);
      UPDATE public.modelo_servico_mo
         SET valor = v_valor, observacoes = v_obs, updated_at = now()
       WHERE modelo_id = _modelo_id AND categoria_terceirizado_id = v_cat;
      IF NOT FOUND THEN
        -- linha NOVA: só pode nascer em categoria ATIVA (soft-hide barra novo serviço,
        -- mas NÃO impede editar linha histórica já existente numa categoria desativada).
        IF NOT EXISTS (SELECT 1 FROM public.categorias_terceirizado
                        WHERE id = v_cat AND tenant_id = v_tenant AND ativo = true) THEN
          RAISE EXCEPTION 'Serviço desativado' USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, observacoes)
        VALUES (v_tenant, _modelo_id, v_cat, v_valor, v_obs);
      END IF;
    END IF;
  END LOOP;

  -- estado completo: apaga o que não veio no payload.
  DELETE FROM public.modelo_servico_mo
   WHERE modelo_id = _modelo_id
     AND categoria_terceirizado_id IS NOT NULL
     AND NOT (categoria_terceirizado_id = ANY(v_keep));
  IF NOT v_tem_legado THEN
    DELETE FROM public.modelo_servico_mo
     WHERE modelo_id = _modelo_id AND categoria_terceirizado_id IS NULL;
  END IF;
END $function$;

-- Reassert do REVOKE (CREATE OR REPLACE preserva ACL, mas invariante #9 pede reassert).
REVOKE EXECUTE ON FUNCTION public._salvar_modelo_servico_mo_core(uuid, jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;
