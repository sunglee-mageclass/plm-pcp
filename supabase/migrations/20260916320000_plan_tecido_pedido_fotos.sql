-- Plan. Tecido — FOTOS DO PEDIDO por nome de tecido (set/2026, Modo Plano).
--
-- No Modo Plano, cada nome de tecido tem um carrossel de fotos do PEDIDO (anexadas pelo usuário),
-- distinto das fotos de referência do modelo. Ancoradas por (coleção, nome de tecido texto) — o nome
-- de tecido é o agrupador da view (nome do artigo do Tecido 1), não uma entidade própria. `paths` =
-- text[] de caminhos no bucket "oc-tecido" (mesmo bucket dos anexos de pedido/OC). Padrão de tenant,
-- RLS e wrapper+_core igual às demais tabelas plan_tecido_*.

BEGIN;

CREATE TABLE IF NOT EXISTS public.plan_tecido_pedido_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  colecao_id uuid NOT NULL REFERENCES public.colecoes(id) ON DELETE CASCADE,
  nome_tecido text NOT NULL,
  paths text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, colecao_id, nome_tecido)
);

ALTER TABLE public.plan_tecido_pedido_fotos ENABLE ROW LEVEL SECURITY;

-- RLS por tenant (mesmo padrão de plan_tecido_paleta).
DROP POLICY IF EXISTS tenant_select ON public.plan_tecido_pedido_fotos;
DROP POLICY IF EXISTS tenant_insert ON public.plan_tecido_pedido_fotos;
DROP POLICY IF EXISTS tenant_update ON public.plan_tecido_pedido_fotos;
DROP POLICY IF EXISTS tenant_delete ON public.plan_tecido_pedido_fotos;
CREATE POLICY tenant_select ON public.plan_tecido_pedido_fotos FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY tenant_insert ON public.plan_tecido_pedido_fotos FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id() OR tenant_id IS NULL);
CREATE POLICY tenant_update ON public.plan_tecido_pedido_fotos FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY tenant_delete ON public.plan_tecido_pedido_fotos FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- ── Escrita: upsert das fotos de um nome de tecido (estado completo). ────────────────────────────
CREATE OR REPLACE FUNCTION public._plan_tecido_set_pedido_fotos_core(_tenant uuid, _colecao_id uuid, _nome_tecido text, _paths text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  if coalesce(array_length(_paths, 1), 0) = 0 then
    -- sem fotos → remove a linha (não deixa lixo)
    delete from plan_tecido_pedido_fotos
      where tenant_id = _tenant and colecao_id = _colecao_id and nome_tecido = _nome_tecido;
    return;
  end if;
  insert into plan_tecido_pedido_fotos (tenant_id, colecao_id, nome_tecido, paths)
    values (_tenant, _colecao_id, _nome_tecido, _paths)
  on conflict (tenant_id, colecao_id, nome_tecido)
    do update set paths = excluded.paths, updated_at = now();
end $function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_set_pedido_fotos(_colecao_id uuid, _nome_tecido text, _paths text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criacao não habilitado' using errcode = '42501';
  end if;
  perform public._plan_tecido_set_pedido_fotos_core(public.get_user_tenant_id(), _colecao_id, _nome_tecido, _paths);
end $function$;

-- ── Leitura: mapa { nome_tecido: paths[] } da coleção. ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._plan_tecido_pedido_fotos_core(_tenant uuid, _colecao_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(nome_tecido, to_jsonb(paths)), '{}'::jsonb)
  from plan_tecido_pedido_fotos
  where tenant_id = _tenant and colecao_id = _colecao_id;
$function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_pedido_fotos(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criacao não habilitado' using errcode = '42501';
  end if;
  return public._plan_tecido_pedido_fotos_core(public.get_user_tenant_id(), _colecao_id);
end $function$;

-- EXECUTE dos _core revogado (invariante #9): recebem o tenant por parâmetro; só os wrappers entram.
REVOKE EXECUTE ON FUNCTION public._plan_tecido_set_pedido_fotos_core(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_pedido_fotos_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
