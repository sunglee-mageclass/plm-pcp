-- 20260803181000_audit_ignora_rev.sql
-- Fix: fn_audit deve ignorar rev e plan_rev no diff, como já ignora created_at/updated_at.
-- Estas são colunas de manutenção do servidor (bumped pelo colab infrastructure),
-- não edições de negócio. Sem isto, cada child change geraria uma entrada fantasma no audit.

create or replace function public.fn_audit() returns trigger
language plpgsql security definer set search_path to 'public' as $$
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
  ELSIF (TG_TABLE_NAME = 'user_roles') THEN
    -- user_roles nao tem tenant_id: resolve pela loja do usuario.
    SELECT tenant_id INTO v_tenant FROM public.users WHERE id = nullif(v_row->>'user_id','')::uuid;
  ELSE
    v_tenant := nullif(v_row->>'tenant_id','')::uuid;
  END IF;
  v_rid := nullif(v_row->>'id','')::uuid;

  v_entidade := CASE TG_TABLE_NAME
    WHEN 'ocs_tecido' THEN 'OC de Tecido'
    WHEN 'ocs_aviamento' THEN 'OC de Aviamento'
    WHEN 'ordens_saida_tecido' THEN 'Ordem de Saída (Tecido)'
    WHEN 'ordens_saida_aviamento' THEN 'Ordem de Saída (Aviamento)'
    WHEN 'ordens_saida_aviamento_itens' THEN 'Item de Ordem de Saída (Aviamento)'
    WHEN 'modelos' THEN 'Modelo'
    WHEN 'cad' THEN 'CAD'
    WHEN 'controle_qualidade' THEN 'Controle de Qualidade'
    WHEN 'estoque_tecido_baixas' THEN 'Baixa de Estoque'
    WHEN 'parcelas' THEN 'Parcela (a pagar)'
    WHEN 'parcelas_servico' THEN 'Parcela de Serviço'
    WHEN 'lancamentos' THEN 'Lançamento'
    WHEN 'producao_terceirizados' THEN 'Produção de Serviços'
    WHEN 'producao_oficina' THEN 'Oficina'
    WHEN 'producao_acabamento' THEN 'Acabamento'
    WHEN 'direcionamento' THEN 'Direcionamento'
    WHEN 'artigos' THEN 'Tecido'
    WHEN 'aviamentos' THEN 'Aviamento'
    WHEN 'colaboradores' THEN 'Colaborador'
    WHEN 'empresas' THEN 'Empresa'
    WHEN 'representantes' THEN 'Representante'
    WHEN 'tenant_config' THEN 'Configuração da Loja'
    WHEN 'users' THEN 'Usuário'
    WHEN 'user_permissions' THEN 'Permissões de Usuário'
    WHEN 'user_roles' THEN 'Papel de Usuário'
    WHEN 'tenants' THEN 'Loja'
    WHEN 'system_settings' THEN 'Identidade do Sistema'
    ELSE TG_TABLE_NAME
  END;

  -- rotulo legivel do registro (numero/nome/codigo/ref/role), quando houver
  v_rotulo := coalesce(
    v_row->>'numero_pedido', v_row->>'numero_os', v_row->>'numero',
    v_row->>'rolo_codigo', v_row->>'nome', v_row->>'codigo_nome',
    v_row->>'ref', v_row->>'nome_sistema', v_row->>'role', ''
  );

  v_desc := v_verbo || ' ' || v_entidade || CASE WHEN v_rotulo <> '' THEN ' "' || v_rotulo || '"' ELSE '' END;

  -- UPDATE: so os campos que mudaram (ignora ruido); se nada relevante mudou, nao loga.
  IF (TG_OP = 'UPDATE') THEN
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    SELECT jsonb_object_agg(e.key, jsonb_build_object('de', v_old->e.key, 'para', e.value))
      INTO v_dados
    FROM jsonb_each(v_new) AS e(key, value)
    WHERE (v_old->e.key) IS DISTINCT FROM e.value
      AND e.key NOT IN ('updated_at', 'created_at', 'rev', 'plan_rev');
    IF v_dados IS NULL THEN RETURN NULL; END IF;
  END IF;

  INSERT INTO public.audit_log (tenant_id, user_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados)
  VALUES (v_tenant, v_user, v_nome, v_acao, v_entidade, TG_TABLE_NAME, v_rid, v_desc, v_dados);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Auditoria NUNCA pode quebrar a operacao de negocio.
  RETURN NULL;
END;
$$ ;
