-- Auditoria legível: resolve UUID de FK -> nome do registro.
-- A tela de Auditoria mostrava valores crus de FK como UUID
-- ("Modelista: — → fd668f24-..."), incompreensível. Este RPC recebe pares
-- (campo, id), sabe no SERVIDOR qual tabela cada campo referencia, e devolve
-- {id: nome}. O front chama 1x por página e troca UUID->nome (fallback = UUID
-- se o registro foi apagado). Retroativo (vale p/ todo o histórico).
--
-- Segurança (invariante #9): SECURITY DEFINER, mas filtra por tenant do
-- chamador — só resolve nomes do PRÓPRIO tenant; super_admin resolve global
-- (a Auditoria já é super=tudo / admin=a loja). EXECUTE só p/ authenticated.

BEGIN;

CREATE OR REPLACE FUNCTION public.audit_resolver_referencias(_pares jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := get_user_tenant_id();
  _super  boolean := is_super_admin();
  _out    jsonb := '{}'::jsonb;
  _ids    uuid[];
  -- Mapa campo -> (tabela, coluna-nome). Colunas verificadas no schema vivo.
  _map    jsonb := jsonb_build_object(
    'estilista_id',              jsonb_build_array('colaboradores','nome'),
    'modelista_id',              jsonb_build_array('colaboradores','nome'),
    'piloteiro1_id',             jsonb_build_array('colaboradores','nome'),
    'piloteiro2_id',             jsonb_build_array('colaboradores','nome'),
    'piloteiro3_id',             jsonb_build_array('colaboradores','nome'),
    'recebimento_responsavel_id',jsonb_build_array('colaboradores','nome'),
    'linha_id',                  jsonb_build_array('linhas','nome'),
    'subcategoria1_id',          jsonb_build_array('subcategorias1_produto','nome'),
    'subcategoria2_id',          jsonb_build_array('subcategorias2_produto','nome'),
    'categoria_principal_id',    jsonb_build_array('categorias_produto','nome'),
    'categoria_secundaria_id',   jsonb_build_array('categorias_produto','nome'),
    'categoria_tecido_id',       jsonb_build_array('categorias_tecido','nome'),
    'categoria_aviamento_id',    jsonb_build_array('categorias_aviamento','nome'),
    'subcategoria_aviamento_id', jsonb_build_array('subcategorias_aviamento','nome'),
    'colecao_id',                jsonb_build_array('colecoes','nome'),
    'cor_id',                    jsonb_build_array('cores','nome'),
    'cor_apelido_id',            jsonb_build_array('cores_apelido','nome'),
    'empresa_id',                jsonb_build_array('empresas','coalesce(nome_fantasia, razao_social)'),
    'representante_id',          jsonb_build_array('representantes','nome'),
    'material_aviamento_id',     jsonb_build_array('materiais_aviamento','nome'),
    'conjunto_id',               jsonb_build_array('modelos','nome'),
    -- arrays de UUID (o front achata cada item em um par {campo, id}):
    'tecidos_planejados',        jsonb_build_array('artigos','nome'),
    'mes_id',                    jsonb_build_array('meses','mes'),
    'ano_id',                    jsonb_build_array('anos','ano')
  );
  _campo text;
  _tab   text;
  _col   text;
  _sql   text;
  _res   jsonb;
BEGIN
  IF _pares IS NULL OR jsonb_typeof(_pares) <> 'array' THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Um SELECT por tabela distinta: agrupa os ids do mesmo campo/tabela.
  FOR _campo IN
    SELECT DISTINCT (p->>'campo') FROM jsonb_array_elements(_pares) p
    WHERE _map ? (p->>'campo')
  LOOP
    _tab := _map->_campo->>0;
    _col := _map->_campo->>1;

    -- ids desse campo (uuid válidos)
    SELECT array_agg(DISTINCT (p->>'id')::uuid)
      INTO _ids
    FROM jsonb_array_elements(_pares) p
    WHERE (p->>'campo') = _campo
      AND (p->>'id') ~ '^[0-9a-fA-F-]{36}$';

    IF _ids IS NULL OR array_length(_ids,1) IS NULL THEN
      CONTINUE;
    END IF;

    -- Monta o SELECT com identificadores validados pelo _map (sem injeção:
    -- _tab/_col vêm do literal _map, NUNCA do input do cliente). _col pode ser
    -- um nome simples (quote_ident %I) OU uma expressão como
    -- coalesce(nome_fantasia, razao_social) — nesse caso injeta cru (%s), seguro
    -- porque é literal do _map. Filtro por tenant salvo super_admin.
    _sql := format(
      'SELECT coalesce(jsonb_object_agg(id::text, %s), ''{}''::jsonb)
         FROM %I
        WHERE id = ANY($1) %s',
      CASE WHEN _col LIKE '%(%' THEN _col ELSE quote_ident(_col) END,
      _tab,
      CASE WHEN _super THEN '' ELSE 'AND tenant_id = $2' END
    );

    IF _super THEN
      EXECUTE _sql INTO _res USING _ids;
    ELSE
      EXECUTE _sql INTO _res USING _ids, _tenant;
    END IF;

    _out := _out || coalesce(_res, '{}'::jsonb);
  END LOOP;

  RETURN _out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_resolver_referencias(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.audit_resolver_referencias(jsonb) TO authenticated;

COMMIT;
