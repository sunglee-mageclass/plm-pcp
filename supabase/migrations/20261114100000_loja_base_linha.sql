-- F2 Tarefa A — base por loja x linha (coluna GRA/ do dialog "Distribuir por loja").
-- Tabela filha de lojas_direcionamento; RLS tenant-scoped; escrita so tenant_admin/super.
-- RPC de leitura loja_base_linha_ler(_linha_id) -> { "<loja_id>": base } para o dialog pre-preencher a Base.
-- Inverso: supabase/rollback/20261114100000_loja_base_linha_down.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.loja_direcionamento_base_linha (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id uuid NOT NULL REFERENCES public.lojas_direcionamento(id) ON DELETE CASCADE,
  linha_id uuid NOT NULL REFERENCES public.linhas(id) ON DELETE CASCADE,
  base integer NOT NULL DEFAULT 0 CHECK (base >= 0),
  tenant_id uuid NOT NULL DEFAULT public.get_user_tenant_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loja_id, linha_id)
);

CREATE INDEX IF NOT EXISTS idx_lbl_tenant_linha ON public.loja_direcionamento_base_linha (tenant_id, linha_id);
CREATE INDEX IF NOT EXISTS idx_lbl_loja ON public.loja_direcionamento_base_linha (loja_id);

ALTER TABLE public.loja_direcionamento_base_linha ENABLE ROW LEVEL SECURITY;

-- SELECT: todo usuario da loja (tenant) ou super; escrita: so admin da loja/super (igual lojas_direcionamento).
CREATE POLICY lbl_select ON public.loja_direcionamento_base_linha
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
CREATE POLICY lbl_insert ON public.loja_direcionamento_base_linha
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id() AND (public.is_tenant_admin() OR public.is_super_admin()));
CREATE POLICY lbl_update ON public.loja_direcionamento_base_linha
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id() AND (public.is_tenant_admin() OR public.is_super_admin()))
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND (public.is_tenant_admin() OR public.is_super_admin()));
CREATE POLICY lbl_delete ON public.loja_direcionamento_base_linha
  FOR DELETE USING (tenant_id = public.get_user_tenant_id() AND (public.is_tenant_admin() OR public.is_super_admin()));

-- S5 (faxina de privilegios): objeto novo criado pelo postgres ja nasce sem anon; damos escrita/leitura
-- so a authenticated (service_role mantem por default). anon fica de fora.
REVOKE ALL ON public.loja_direcionamento_base_linha FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loja_direcionamento_base_linha TO authenticated;

-- Leitura para o dialog: base por LINHA de TODAS as lojas da conta (tenant) -> { "<loja_id>": base }.
CREATE OR REPLACE FUNCTION public._loja_base_linha_ler_core(_tenant uuid, _linha_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT coalesce(jsonb_object_agg(l.loja_id::text, l.base), '{}'::jsonb)
  FROM public.loja_direcionamento_base_linha l
  WHERE l.tenant_id = _tenant AND l.linha_id = _linha_id;
$fn$;
REVOKE EXECUTE ON FUNCTION public._loja_base_linha_ler_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.loja_base_linha_ler(_linha_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare v_tenant uuid;
begin
  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then raise exception 'sem_tenant' using errcode = 'P0001'; end if;
  if _linha_id is null then return '{}'::jsonb; end if;
  return public._loja_base_linha_ler_core(v_tenant, _linha_id);
end $fn$;
REVOKE EXECUTE ON FUNCTION public.loja_base_linha_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.loja_base_linha_ler(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
