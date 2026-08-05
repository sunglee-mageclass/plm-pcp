-- Direcionamento multi-lojas — fase 1/3: cadastro de lojas.
-- Tabela lojas_direcionamento + RLS + seed p/ tenants EXISTENTES + _seed_tenant_defaults v2
-- (loja nova/reset nasce com E-commerce default + Loja Física) + backfill da permissão
-- cadastro_lojas (quem já vê Atributos passa a ver Lojas — rollout não-quebra).
BEGIN;

CREATE TABLE IF NOT EXISTS public.lojas_direcionamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  ordem int,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lojas_direcionamento_tenant_nome_uk UNIQUE (tenant_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_lojas_dir_tenant ON public.lojas_direcionamento(tenant_id);

ALTER TABLE public.lojas_direcionamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lojas_dir_sel ON public.lojas_direcionamento;
DROP POLICY IF EXISTS lojas_dir_ins ON public.lojas_direcionamento;
DROP POLICY IF EXISTS lojas_dir_upd ON public.lojas_direcionamento;
DROP POLICY IF EXISTS lojas_dir_del ON public.lojas_direcionamento;
CREATE POLICY lojas_dir_sel ON public.lojas_direcionamento FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY lojas_dir_ins ON public.lojas_direcionamento FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY lojas_dir_upd ON public.lojas_direcionamento FOR UPDATE
  USING (tenant_id = get_user_tenant_id()) WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY lojas_dir_del ON public.lojas_direcionamento FOR DELETE
  USING (tenant_id = get_user_tenant_id());

DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.lojas_direcionamento;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.lojas_direcionamento
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
DROP TRIGGER IF EXISTS audit_lojas_direcionamento ON public.lojas_direcionamento;
CREATE TRIGGER audit_lojas_direcionamento AFTER INSERT OR DELETE OR UPDATE ON public.lojas_direcionamento
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lojas_direcionamento TO authenticated;

-- Seed p/ tenants EXISTENTES (idempotente).
INSERT INTO public.lojas_direcionamento (tenant_id, nome, ativo, is_default, ordem)
SELECT t.id, 'E-commerce', true, true, 1 FROM public.tenants t
ON CONFLICT (tenant_id, nome) DO NOTHING;
INSERT INTO public.lojas_direcionamento (tenant_id, nome, ativo, is_default, ordem)
SELECT t.id, 'Loja Física', true, false, 2 FROM public.tenants t
ON CONFLICT (tenant_id, nome) DO NOTHING;

-- _seed_tenant_defaults v2: corpo ATUAL (config + Corte/Oficina + 12 meses + anos) + lojas.
-- (Reproduz o corpo vivo verificado via pg_get_functiondef em 05/08/2026 — não remover blocos.)
CREATE OR REPLACE FUNCTION public._seed_tenant_defaults(_tid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem)
  VALUES (_tid, 'Corte', 0), (_tid, 'Oficina', 1)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 12 meses FIXOS (ordem 1..12) — a UI não deixa criar (atributo `fixed`), então precisam
  -- existir sempre; senão o dropdown de Mês (Planejamento/CAD/CQ/OTB/Lançamentos) fica vazio.
  INSERT INTO public.meses (tenant_id, mes, ordem) VALUES
    (_tid, 'Janeiro', 1), (_tid, 'Fevereiro', 2), (_tid, 'Março', 3),
    (_tid, 'Abril', 4), (_tid, 'Maio', 5), (_tid, 'Junho', 6),
    (_tid, 'Julho', 7), (_tid, 'Agosto', 8), (_tid, 'Setembro', 9),
    (_tid, 'Outubro', 10), (_tid, 'Novembro', 11), (_tid, 'Dezembro', 12)
  ON CONFLICT (tenant_id, mes) DO NOTHING;

  -- Ano corrente + próximo, p/ a loja já posicionar modelos no calendário ao abrir/resetar.
  INSERT INTO public.anos (tenant_id, ano) VALUES
    (_tid, EXTRACT(YEAR FROM CURRENT_DATE)::int::text),
    (_tid, (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text)
  ON CONFLICT (tenant_id, ano) DO NOTHING;

  -- Lojas do Direcionamento: E-commerce (padrão) + Loja Física — renomeáveis depois.
  INSERT INTO public.lojas_direcionamento (tenant_id, nome, ativo, is_default, ordem) VALUES
    (_tid, 'E-commerce', true, true, 1),
    (_tid, 'Loja Física', true, false, 2)
  ON CONFLICT (tenant_id, nome) DO NOTHING;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._seed_tenant_defaults(uuid) FROM PUBLIC, anon, authenticated;

-- Permissão nova cadastro_lojas: backfill não-quebra (espelha quem já vê/edita Atributos).
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT up.user_id, up.tenant_id, 'cadastro_lojas', up.pode_ver, up.pode_editar
FROM public.user_permissions up
WHERE up.pagina = 'cadastro_atributos'
ON CONFLICT (user_id, pagina) DO NOTHING;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
