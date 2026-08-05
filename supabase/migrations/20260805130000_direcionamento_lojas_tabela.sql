-- Direcionamento multi-lojas — fase 2/3: a tabela de linhas + backfill do legado.
-- A tabela `direcionamento` (ecommerce/loja_fisica por variante) fica INERTE (não dropar —
-- rodada destrutiva futura). Backfill: E-commerce ← ecommerce, Loja Física ← loja_fisica.
-- Trigger fn_rebaixa_direcionamento_grade v2: o gate do rebaixe passa a olhar as 2 tabelas.
BEGIN;

CREATE TABLE IF NOT EXISTS public.direcionamento_lojas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  cad_id uuid NOT NULL REFERENCES public.cad(id) ON DELETE CASCADE,
  -- NO ACTION de propósito: excluir loja com histórico deve FALHAR (RPC dá a mensagem PT).
  loja_id uuid NOT NULL REFERENCES public.lojas_direcionamento(id),
  variante_numero int NOT NULL,
  grades jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direcionamento_lojas_cad_loja_var_uk UNIQUE (cad_id, loja_id, variante_numero)
);

CREATE INDEX IF NOT EXISTS idx_dir_lojas_cad    ON public.direcionamento_lojas(cad_id);
CREATE INDEX IF NOT EXISTS idx_dir_lojas_loja   ON public.direcionamento_lojas(loja_id);
CREATE INDEX IF NOT EXISTS idx_dir_lojas_tenant ON public.direcionamento_lojas(tenant_id);

ALTER TABLE public.direcionamento_lojas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dirlojas_sel ON public.direcionamento_lojas;
DROP POLICY IF EXISTS dirlojas_ins ON public.direcionamento_lojas;
DROP POLICY IF EXISTS dirlojas_upd ON public.direcionamento_lojas;
DROP POLICY IF EXISTS dirlojas_del ON public.direcionamento_lojas;
CREATE POLICY dirlojas_sel ON public.direcionamento_lojas FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY dirlojas_ins ON public.direcionamento_lojas FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY dirlojas_upd ON public.direcionamento_lojas FOR UPDATE
  USING (tenant_id = get_user_tenant_id()) WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY dirlojas_del ON public.direcionamento_lojas FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Modgate do módulo producao (espelha a tabela legada `direcionamento`).
DROP POLICY IF EXISTS modgate_ins ON public.direcionamento_lojas;
DROP POLICY IF EXISTS modgate_upd ON public.direcionamento_lojas;
DROP POLICY IF EXISTS modgate_del ON public.direcionamento_lojas;
CREATE POLICY modgate_ins ON public.direcionamento_lojas AS RESTRICTIVE FOR INSERT
  WITH CHECK (tenant_module_enabled('producao'::text));
CREATE POLICY modgate_upd ON public.direcionamento_lojas AS RESTRICTIVE FOR UPDATE
  USING (tenant_module_enabled('producao'::text));
CREATE POLICY modgate_del ON public.direcionamento_lojas AS RESTRICTIVE FOR DELETE
  USING (tenant_module_enabled('producao'::text));

DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.direcionamento_lojas;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.direcionamento_lojas
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
DROP TRIGGER IF EXISTS audit_direcionamento_lojas ON public.direcionamento_lojas;
CREATE TRIGGER audit_direcionamento_lojas AFTER INSERT OR DELETE OR UPDATE ON public.direcionamento_lojas
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.direcionamento_lojas TO authenticated;

-- Backfill do legado (idempotente). E-commerce = a loja default do tenant (acabou de ser
-- semeada na fase 1 — nomes ainda intocados); Loja Física = por nome semeado.
INSERT INTO public.direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
SELECT d.tenant_id, d.cad_id, l.id, d.variante_numero, COALESCE(d.ecommerce, '{}'::jsonb)
FROM public.direcionamento d
JOIN public.lojas_direcionamento l ON l.tenant_id = d.tenant_id AND l.is_default
ON CONFLICT (cad_id, loja_id, variante_numero) DO NOTHING;

INSERT INTO public.direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
SELECT d.tenant_id, d.cad_id, l.id, d.variante_numero, COALESCE(d.loja_fisica, '{}'::jsonb)
FROM public.direcionamento d
JOIN public.lojas_direcionamento l ON l.tenant_id = d.tenant_id AND l.nome = 'Loja Física'
ON CONFLICT (cad_id, loja_id, variante_numero) DO NOTHING;

-- fn_rebaixa_direcionamento_grade v2: idêntico ao corpo vivo, MUDANDO SÓ o gate do rebaixe
-- (EXISTS legado OU EXISTS direcionamento_lojas) — sem isso, cads salvos só no modelo novo
-- não seriam rebaixados quando a grade real muda. O bloco de re-derivação do snapshot legado
-- permanece (age só sobre linhas legadas; no modelo novo o rodapé vivo cobre a divergência).
CREATE OR REPLACE FUNCTION public.fn_rebaixa_direcionamento_grade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_real jsonb;
  v_ec_old jsonb;
  v_ec jsonb := '{}'::jsonb;
  v_lf jsonb := '{}'::jsonb;
  v_ec_t int := 0; v_lf_t int := 0; v_r_t int := 0;
  t text; v_rt int; v_et int; v_ecv int;
BEGIN
  -- Só age em mudança REAL da grade real (UPDATE). Re-inserção (DELETE+INSERT do
  -- salvar_cad_completo) não é mudança de grade → não rebaixa nem re-deriva.
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.grades_reais IS NOT DISTINCT FROM OLD.grades_reais THEN
    RETURN NEW;
  END IF;

  -- Rebaixa o status quando estava 'separado' (grade real mudou → split defasado).
  -- v2: o gate olha o modelo NOVO (direcionamento_lojas) E o legado (direcionamento).
  IF EXISTS (
    SELECT 1 FROM public.cad c
     WHERE c.id = NEW.cad_id
       AND c.direcionamento_status = 'separado'
       AND (
         EXISTS (SELECT 1 FROM public.direcionamento d WHERE d.cad_id = NEW.cad_id)
         OR EXISTS (SELECT 1 FROM public.direcionamento_lojas dl WHERE dl.cad_id = NEW.cad_id)
       )
  ) THEN
    UPDATE public.cad
       SET direcionamento_status = 'pendente', direcionamento_confirmado_at = NULL
     WHERE id = NEW.cad_id AND direcionamento_status = 'separado';
    UPDATE public.modelos
       SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) || '{"direcionamento": true}'::jsonb
     WHERE id = (SELECT modelo_id FROM public.cad WHERE id = NEW.cad_id);
  END IF;

  -- Re-deriva o SNAPSHOT armazenado desta variante a partir da grade real nova (clampa ec ≤ real).
  IF EXISTS (SELECT 1 FROM public.direcionamento d
              WHERE d.cad_id = NEW.cad_id AND d.variante_numero = NEW.variante_numero) THEN
    v_real := COALESCE(NEW.grades_reais, '{}'::jsonb);
    SELECT COALESCE(ecommerce, '{}'::jsonb) INTO v_ec_old
      FROM public.direcionamento
     WHERE cad_id = NEW.cad_id AND variante_numero = NEW.variante_numero;
    v_ec_old := COALESCE(v_ec_old, '{}'::jsonb);

    FOR t IN SELECT jsonb_object_keys(v_real) LOOP
      v_rt := COALESCE((v_real->>t)::int, 0);
      v_et := COALESCE((v_ec_old->>t)::int, 0);
      IF v_et < 0 THEN v_et := 0; END IF;
      v_ecv := LEAST(v_et, v_rt);
      v_ec := v_ec || jsonb_build_object(t, v_ecv);
      v_lf := v_lf || jsonb_build_object(t, v_rt - v_ecv);
      v_ec_t := v_ec_t + v_ecv;
      v_lf_t := v_lf_t + (v_rt - v_ecv);
      v_r_t := v_r_t + v_rt;
    END LOOP;

    UPDATE public.direcionamento
       SET real = v_real, grade_real_total = v_r_t,
           ecommerce = v_ec, ecommerce_total = v_ec_t,
           loja_fisica = v_lf, loja_fisica_total = v_lf_t
     WHERE cad_id = NEW.cad_id AND variante_numero = NEW.variante_numero;
  END IF;

  RETURN NEW;
END;
$function$;

-- Excluir loja com guarda (padrão excluir_tecido): default não sai; com histórico não sai
-- (desativar é o caminho); livre sai.
CREATE OR REPLACE FUNCTION public.excluir_loja_direcionamento(_loja_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_nome text; v_default boolean; v_n int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT nome, is_default INTO v_nome, v_default
    FROM public.lojas_direcionamento WHERE id = _loja_id AND tenant_id = v_tenant;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Loja não encontrada'; END IF;
  IF v_default THEN
    RAISE EXCEPTION 'A loja padrão ("%") não pode ser excluída — renomeie ou desative-a.', v_nome;
  END IF;
  SELECT count(*) INTO v_n FROM public.direcionamento_lojas WHERE loja_id = _loja_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Não é possível excluir a loja "%": ela tem % linha(s) de direcionamento. Desative-a para escondê-la de novos direcionamentos.', v_nome, v_n;
  END IF;
  DELETE FROM public.lojas_direcionamento WHERE id = _loja_id AND tenant_id = v_tenant;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.excluir_loja_direcionamento(uuid) FROM anon;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
