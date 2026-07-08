-- Endereçamento de tecido (Fase 0 — fundação): tabela dedicada como fonte do endereço.
--
-- Hoje o endereço é AGREGADO na variante (variantes_tecido.enderecos jsonb), editável só no
-- Cadastro, sem vínculo com OC/quantidade — mente quando a mesma cor chega em 2 OCs pra 2
-- vãos. Passa a morar no FÍSICO: no lote (item de OC recebido) e no rolo. Neste MVP o
-- endereço do ROLO continua nas colunas ocs_tecido.rolo_* (não mexo no criar_rolo, área
-- sensível); a tabela cobre manual (variante) + por-OC-item; o Cadastro/Estoque viram
-- consolidado (união tabela + colunas do rolo). Sem quantidade por vão (coluna criada, NULL,
-- p/ evolução futura). Rolo full-fold + quantidade = Fase 2.

CREATE TABLE IF NOT EXISTS public.enderecamento_tecido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  variante_tecido_id uuid NOT NULL REFERENCES public.variantes_tecido(id) ON DELETE CASCADE,
  oc_tecido_item_id uuid REFERENCES public.ocs_tecido_itens(id) ON DELETE CASCADE,
  rolo_id uuid REFERENCES public.ocs_tecido(id) ON DELETE CASCADE,  -- Fase 2; MVP não popula
  rua text,
  prateleira text,
  quantidade numeric,  -- Fase 2 (quanto por vão); MVP não popula
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  -- origem exclusiva: no máx. um de (oc_tecido_item_id, rolo_id). Ambos nulos = manual (variante).
  CONSTRAINT enderecamento_tecido_origem_unica CHECK (NOT (oc_tecido_item_id IS NOT NULL AND rolo_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_endtec_tenant   ON public.enderecamento_tecido(tenant_id);
CREATE INDEX IF NOT EXISTS idx_endtec_variante ON public.enderecamento_tecido(variante_tecido_id);
CREATE INDEX IF NOT EXISTS idx_endtec_item     ON public.enderecamento_tecido(oc_tecido_item_id);
CREATE INDEX IF NOT EXISTS idx_endtec_rolo     ON public.enderecamento_tecido(rolo_id);

ALTER TABLE public.enderecamento_tecido ENABLE ROW LEVEL SECURITY;

CREATE POLICY endtec_sel ON public.enderecamento_tecido FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY endtec_ins ON public.enderecamento_tecido FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY endtec_upd ON public.enderecamento_tecido FOR UPDATE USING (tenant_id = get_user_tenant_id()) WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY endtec_del ON public.enderecamento_tecido FOR DELETE USING (tenant_id = get_user_tenant_id());

CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.enderecamento_tecido
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.enderecamento_tecido TO authenticated;

-- Migração dos endereços manuais existentes (variantes_tecido.enderecos jsonb) → linhas manuais
-- (oc_tecido_item_id e rolo_id nulos). tenant_id explícito (trigger só preenche se nulo).
INSERT INTO public.enderecamento_tecido (tenant_id, variante_tecido_id, rua, prateleira)
SELECT v.tenant_id, v.id, NULLIF(e->>'rua', ''), NULLIF(e->>'prateleira', '')
FROM public.variantes_tecido v
CROSS JOIN LATERAL jsonb_array_elements(v.enderecos) e
WHERE jsonb_typeof(v.enderecos) = 'array'
  AND v.enderecos <> '[]'::jsonb
  AND (COALESCE(e->>'rua', '') <> '' OR COALESCE(e->>'prateleira', '') <> '');
