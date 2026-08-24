BEGIN;
-- gap: Insumo não tinha o unique index que Tecido/Aviamento têm
CREATE UNIQUE INDEX IF NOT EXISTS ux_ocs_etiqueta_numero
  ON public.ocs_etiqueta (tenant_id, numero_pedido)
  WHERE numero_pedido IS NOT NULL AND numero_pedido <> '';

CREATE OR REPLACE FUNCTION public.proximo_numero_oc(_tipo text, _fornecedor_id uuid, _material_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant uuid := get_user_tenant_id();
  v_letra text; v_tab text; v_matnome text; v_sigF text; v_sigM text; v_prefixo text; v_seq int;
BEGIN
  IF _fornecedor_id IS NULL OR _material_id IS NULL THEN RETURN NULL; END IF;
  IF _tipo = 'tecido' THEN v_letra := 'T'; v_tab := 'ocs_tecido';
     SELECT nome INTO v_matnome FROM artigos WHERE id = _material_id;
  ELSIF _tipo = 'aviamento' THEN v_letra := 'A'; v_tab := 'ocs_aviamento';
     SELECT codigo_nome INTO v_matnome FROM aviamentos WHERE id = _material_id;
  ELSIF _tipo = 'insumo' THEN v_letra := 'I'; v_tab := 'ocs_etiqueta';
     SELECT nome INTO v_matnome FROM etiquetas WHERE id = _material_id;
  ELSE RAISE EXCEPTION 'tipo inválido: %', _tipo; END IF;
  v_sigF := _aviamento_sigla((SELECT nome_fantasia FROM empresas WHERE id = _fornecedor_id));
  v_sigM := _aviamento_sigla(v_matnome);
  v_prefixo := v_letra || '-' || coalesce(nullif(v_sigF,''),'FOR') || coalesce(nullif(v_sigM,''),'MAT') || '-';
  -- max+1 por prefixo/tenant sobre a tabela certa (EXECUTE por causa do nome dinâmico)
  EXECUTE format(
    'SELECT coalesce(max(nullif(regexp_replace(numero_pedido,''^.*\D'',''''),'''')::int),0)+1
       FROM %I WHERE tenant_id = $1 AND numero_pedido LIKE $2 || ''%%'' AND numero_pedido ~ ($2 || ''\d+$'')',
    v_tab) INTO v_seq USING v_tenant, v_prefixo;
  RETURN v_prefixo || lpad(v_seq::text, 5, '0');
END $fn$;

REVOKE EXECUTE ON FUNCTION public.proximo_numero_oc(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proximo_numero_oc(text, uuid, uuid) TO authenticated;
COMMIT;
