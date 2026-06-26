-- AUDITORIA (Admin > Auditoria): log de todos os eventos via TRIGGER no banco.
-- Captura acao (criar/editar/excluir), entidade, registro, usuario (auth.uid) e horario,
-- automaticamente e sem poder ser burlado. Tenant-scoped: admin da loja ve a propria loja,
-- super_admin ve tudo. Append-only: so o trigger (DEFINER) escreve; cliente so le.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid,
  user_id      uuid,
  user_nome    text,
  acao         text NOT NULL,           -- 'criar' | 'editar' | 'excluir'
  entidade     text NOT NULL,           -- nome amigavel (ex.: 'OC de Tecido')
  tabela       text NOT NULL,
  registro_id  uuid,
  descricao    text,
  dados        jsonb,                   -- UPDATE: { campo: { de, para } }; INSERT/DELETE: null
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON public.audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON public.audit_log (user_id);

-- ── Função genérica do trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row jsonb; v_old jsonb; v_new jsonb;
  v_tenant uuid; v_user uuid; v_nome text;
  v_acao text; v_verbo text; v_entidade text; v_rid uuid; v_rotulo text; v_desc text;
  v_dados jsonb;
BEGIN
  v_user := auth.uid();
  SELECT coalesce(nome, email) INTO v_nome FROM public.users WHERE id = v_user;

  IF (TG_OP = 'INSERT') THEN v_acao := 'criar'; v_verbo := 'Criou'; v_row := to_jsonb(NEW);
  ELSIF (TG_OP = 'UPDATE') THEN v_acao := 'editar'; v_verbo := 'Editou'; v_row := to_jsonb(NEW);
  ELSE v_acao := 'excluir'; v_verbo := 'Excluiu'; v_row := to_jsonb(OLD);
  END IF;

  -- tenant: a propria loja (tenants) ou a coluna tenant_id; null em tabelas globais.
  IF (TG_TABLE_NAME = 'tenants') THEN
    v_tenant := nullif(v_row->>'id','')::uuid;
  ELSE
    v_tenant := nullif(v_row->>'tenant_id','')::uuid;
  END IF;
  v_rid := nullif(v_row->>'id','')::uuid;

  v_entidade := CASE TG_TABLE_NAME
    WHEN 'ocs_tecido' THEN 'OC de Tecido'
    WHEN 'ocs_aviamento' THEN 'OC de Aviamento'
    WHEN 'ordens_saida_tecido' THEN 'Ordem de Saída (Tecido)'
    WHEN 'ordens_saida_aviamento' THEN 'Ordem de Saída (Aviamento)'
    WHEN 'modelos' THEN 'Modelo'
    WHEN 'cad' THEN 'CAD'
    WHEN 'controle_qualidade' THEN 'Controle de Qualidade'
    WHEN 'estoque_tecido_baixas' THEN 'Baixa de Estoque'
    WHEN 'parcelas' THEN 'Parcela (a pagar)'
    WHEN 'parcelas_servico' THEN 'Parcela de Serviço'
    WHEN 'lancamentos' THEN 'Lançamento'
    WHEN 'producao_terceirizados' THEN 'Produção Terceirizada'
    WHEN 'producao_oficina' THEN 'Oficina'
    WHEN 'producao_acabamento' THEN 'Acabamento'
    WHEN 'direcionamento' THEN 'Direcionamento'
    WHEN 'artigos' THEN 'Artigo'
    WHEN 'aviamentos' THEN 'Aviamento'
    WHEN 'colaboradores' THEN 'Colaborador'
    WHEN 'empresas' THEN 'Empresa'
    WHEN 'representantes' THEN 'Representante'
    WHEN 'tenant_config' THEN 'Configuração da Loja'
    WHEN 'users' THEN 'Usuário'
    WHEN 'user_permissions' THEN 'Permissões de Usuário'
    WHEN 'tenants' THEN 'Loja'
    WHEN 'system_settings' THEN 'Identidade do Sistema'
    ELSE TG_TABLE_NAME
  END;

  -- rotulo legivel do registro (numero/nome/codigo/ref), quando houver
  v_rotulo := coalesce(
    v_row->>'numero_pedido', v_row->>'numero_os', v_row->>'numero',
    v_row->>'rolo_codigo', v_row->>'nome', v_row->>'codigo_nome',
    v_row->>'ref', v_row->>'nome_sistema', ''
  );

  v_desc := v_verbo || ' ' || v_entidade || CASE WHEN v_rotulo <> '' THEN ' "' || v_rotulo || '"' ELSE '' END;

  -- UPDATE: so os campos que mudaram (ignora ruido); se nada relevante mudou, nao loga.
  IF (TG_OP = 'UPDATE') THEN
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    SELECT jsonb_object_agg(e.key, jsonb_build_object('de', v_old->e.key, 'para', e.value))
      INTO v_dados
    FROM jsonb_each(v_new) AS e(key, value)
    WHERE (v_old->e.key) IS DISTINCT FROM e.value
      AND e.key NOT IN ('updated_at', 'created_at');
    IF v_dados IS NULL THEN RETURN NULL; END IF;
  END IF;

  INSERT INTO public.audit_log (tenant_id, user_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados)
  VALUES (v_tenant, v_user, v_nome, v_acao, v_entidade, TG_TABLE_NAME, v_rid, v_desc, v_dados);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Auditoria NUNCA pode quebrar a operacao de negocio.
  RETURN NULL;
END;
$function$;

-- ── Anexa o trigger nas tabelas auditadas ─────────────────────────────────────
DO $do$
DECLARE t text;
  alvos text[] := ARRAY[
    'ocs_tecido','ocs_aviamento','ordens_saida_tecido','ordens_saida_aviamento',
    'modelos','cad','controle_qualidade','estoque_tecido_baixas',
    'parcelas','parcelas_servico','lancamentos',
    'producao_terceirizados','producao_oficina','producao_acabamento','direcionamento',
    'artigos','aviamentos','colaboradores','empresas','representantes',
    'tenant_config','users','user_permissions','tenants','system_settings'
  ];
BEGIN
  FOREACH t IN ARRAY alvos LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'audit_' || t, t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_audit()', 'audit_' || t, t);
  END LOOP;
END
$do$;

-- ── RLS: leitura para super_admin (tudo) e admin da loja (só a própria) ────────
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

DROP POLICY IF EXISTS "Auditoria: leitura admin" ON public.audit_log;
CREATE POLICY "Auditoria: leitura admin"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (public.is_tenant_admin() AND tenant_id = public.get_user_tenant_id()));
