-- D2 — tipos_insumo: tabela de atributo "Tipo de Produto" p/ Insumos + FK em etiquetas.
-- Molde = categorias_fornecedor (id/tenant_id/nome varchar(255)/created_at + RLS 4 policies
-- tenant-scoped + trigger set_tenant_id_trg), com a coluna `protegido` no lugar de
-- `ativo`/`fixa` (dono: sem liga-desliga; Opção A = "renomear é livre, excluir não" pros
-- 3 iniciais). `protegido` é consumido só no FRONT via AttributeTab.noDeleteFlagField
-- (esconde a lixeira/seleção em massa quando true) — o Nome permanece editável no banco e
-- no front para os 3; a integridade real contra exclusão é a FK NO ACTION em
-- etiquetas.tipo_insumo_id (não dá pra apagar tipo em uso de qualquer forma).
-- ⚠️ _seed_tenant_defaults RE-BASEADA no corpo VIVO de 6 blocos (capturado via
-- pg_get_functiondef em 28/08/2026, idêntico ao aplicado pela migração 20260827120000) +
-- 7º bloco novo (tipos_insumo). Aditiva, idempotente (IF NOT EXISTS / ON CONFLICT / CREATE
-- OR REPLACE) — segura para reaplicar.
BEGIN;

-- 1) Tabela
CREATE TABLE IF NOT EXISTS public.tipos_insumo (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id),
  nome       varchar(255) NOT NULL,
  protegido  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tipos_insumo_tenant_id_nome_key UNIQUE (tenant_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_tipos_insumo_tenant ON public.tipos_insumo(tenant_id);

-- 2) RLS tenant padrão (molde categorias_fornecedor, versão simples: tenant_id NOT NULL
-- aqui, então o WITH CHECK não precisa aceitar NULL — o trigger preenche antes)
ALTER TABLE public.tipos_insumo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.tipos_insumo;
DROP POLICY IF EXISTS tenant_insert ON public.tipos_insumo;
DROP POLICY IF EXISTS tenant_update ON public.tipos_insumo;
DROP POLICY IF EXISTS tenant_delete ON public.tipos_insumo;
CREATE POLICY tenant_select ON public.tipos_insumo FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_insert ON public.tipos_insumo FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_update ON public.tipos_insumo FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id()) WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY tenant_delete ON public.tipos_insumo FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- 3) Trigger set_tenant_id (preenche tenant no INSERT; sem ele o quick-add do front
-- — que manda só {nome} — falha no WITH CHECK)
DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.tipos_insumo;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.tipos_insumo
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

-- 4) GRANT (mesmo padrão das tabelas de atributo tenant-scoped)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tipos_insumo TO authenticated;

-- 5) FK em etiquetas — NO ACTION (default; nunca apagar insumo por baixo). Idempotente.
ALTER TABLE public.etiquetas
  ADD COLUMN IF NOT EXISTS tipo_insumo_id uuid REFERENCES public.tipos_insumo(id);
CREATE INDEX IF NOT EXISTS idx_etiquetas_tipo_insumo ON public.etiquetas(tipo_insumo_id);

-- 6) Seed dos 3 iniciais (protegido=true) p/ tenants EXISTENTES — idempotente
INSERT INTO public.tipos_insumo (tenant_id, nome, protegido)
SELECT t.id, v.nome, true
FROM public.tenants t
CROSS JOIN (VALUES ('Cartão'), ('Croqui'), ('Etiqueta')) AS v(nome)
ON CONFLICT (tenant_id, nome) DO NOTHING;

-- 7) _seed_tenant_defaults v4 — corpo VIVO de 6 blocos (capturado 28/08/2026, idêntico ao
-- aplicado por 20260827120000) RE-BASEADO byte-a-byte + 7º bloco novo (tipos_insumo).
CREATE OR REPLACE FUNCTION public._seed_tenant_defaults(_tid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem) VALUES
    (_tid, 'Corte', 0), (_tid, 'Oficina', 1), (_tid, 'PL', 2)
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

  -- Categorias de fornecedor fixas (Aviamento/Insumo/Produto Acabado/Tecido/Produto Importado).
  INSERT INTO public.categorias_fornecedor (tenant_id, nome, fixa) VALUES
    (_tid, 'Aviamento', true),
    (_tid, 'Insumo', true),
    (_tid, 'Produto Acabado', true),
    (_tid, 'Tecido', true),
    (_tid, 'Produto Importado', true)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 7º BLOCO (D2): tipos de insumo iniciais — Cartão/Croqui/Etiqueta (protegido: não excluíveis).
  INSERT INTO public.tipos_insumo (tenant_id, nome, protegido) VALUES
    (_tid, 'Cartão', true),
    (_tid, 'Croqui', true),
    (_tid, 'Etiqueta', true)
  ON CONFLICT (tenant_id, nome) DO NOTHING;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._seed_tenant_defaults(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
