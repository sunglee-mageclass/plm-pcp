-- ============================================================================
-- Variantes de AVIAMENTO — espelha o modelo de variante do TECIDO (variantes_tecido)
-- ----------------------------------------------------------------------------
-- Hoje um aviamento guarda UMA cor (aviamentos.cor_id + cor_apelido_id, single).
-- O dono quer o MESMO modelo do tecido: 1 aviamento (container) -> N variantes,
-- cada uma cor base (cor_id) + cor apelido (cor_apelido_id). Esta migração é a
-- FUNDAÇÃO (item 1): tabela + índices únicos parciais + RLS + triggers + colunas
-- de propagação (inertes) nas 4 tabelas downstream + RPC de gravação atômica +
-- RPC/guarda de exclusão contando uso, tudo espelhando variantes_tecido/excluir_variante_tecido.
--
-- COEXISTÊNCIA / migração (NÃO perde dado): as colunas legadas aviamentos.cor_id /
-- cor_apelido_id são MANTIDAS (drop só numa rodada destrutiva futura) e a cor única
-- de cada aviamento é copiada p/ uma PRIMEIRA variante (backfill idempotente). O front
-- passa a ler cor a partir das variantes; as colunas legadas ficam inertes (não são mais
-- escritas pela UI). As colunas variante_aviamento_id nas tabelas downstream nascem
-- NULL e inertes — os itens 2-5 (Dev, Explosão, OC, PCP) é que passam a gravá-las.
--
-- Idempotente (guards IF [NOT] EXISTS) e transacional (backfill = mutação de dado).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tabela variantes_aviamento (espelha variantes_tecido; sem rua/prateleira/enderecos
--    — aviamento não tem endereçamento).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.variantes_aviamento (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid REFERENCES public.tenants(id),
  aviamento_id      uuid REFERENCES public.aviamentos(id) ON DELETE CASCADE,
  cor_id            uuid REFERENCES public.cores(id),
  cor_apelido_id    uuid REFERENCES public.cores_apelido(id),
  nome_variante     varchar,
  codigo_variante   varchar,
  foto_url          text,
  preco             numeric,
  historico_precos  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2) Índices — únicos PARCIAIS anti-duplicata (espelham variantes_tecido).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_variantes_aviamento_cor_apelido
  ON public.variantes_aviamento (aviamento_id, cor_id, cor_apelido_id)
  WHERE (cor_id IS NOT NULL AND cor_apelido_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_variantes_aviamento_cor_sem_apelido
  ON public.variantes_aviamento (aviamento_id, cor_id)
  WHERE (cor_id IS NOT NULL AND cor_apelido_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_variantes_aviamento_aviamento
  ON public.variantes_aviamento (aviamento_id);

CREATE INDEX IF NOT EXISTS idx_variantes_aviamento_cor_apelido
  ON public.variantes_aviamento (cor_apelido_id);

-- ---------------------------------------------------------------------------
-- 3) RLS — 4 policies tenant-scoped, idênticas a variantes_tecido.
-- ---------------------------------------------------------------------------
ALTER TABLE public.variantes_aviamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.variantes_aviamento;
CREATE POLICY tenant_select ON public.variantes_aviamento
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS tenant_insert ON public.variantes_aviamento;
CREATE POLICY tenant_insert ON public.variantes_aviamento
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_update ON public.variantes_aviamento;
CREATE POLICY tenant_update ON public.variantes_aviamento
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS tenant_delete ON public.variantes_aviamento;
CREATE POLICY tenant_delete ON public.variantes_aviamento
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- ---------------------------------------------------------------------------
-- 4) Triggers — tenant default + log de preço (REUSA variantes_tecido_log_preco,
--    que é genérico: só toca NEW.preco/NEW.historico_precos).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.variantes_aviamento;
CREATE TRIGGER set_tenant_id_trg
  BEFORE INSERT ON public.variantes_aviamento
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

DROP TRIGGER IF EXISTS trg_variantes_aviamento_log_preco ON public.variantes_aviamento;
CREATE TRIGGER trg_variantes_aviamento_log_preco
  BEFORE INSERT OR UPDATE ON public.variantes_aviamento
  FOR EACH ROW EXECUTE FUNCTION public.variantes_tecido_log_preco();

-- ---------------------------------------------------------------------------
-- 5) Colunas de propagação (INERTES nesta rodada) nas 4 tabelas downstream.
--    FK NO ACTION de propósito (espelha estoque_tecido_baixas.variante_tecido_id —
--    invariante #4: nunca CASCADE numa coluna que alimenta ledger/consumo).
-- ---------------------------------------------------------------------------
ALTER TABLE public.modelo_aviamentos
  ADD COLUMN IF NOT EXISTS variante_aviamento_id uuid REFERENCES public.variantes_aviamento(id);
CREATE INDEX IF NOT EXISTS idx_modelo_aviamentos_variante
  ON public.modelo_aviamentos (variante_aviamento_id);

ALTER TABLE public.ocs_aviamento_itens
  ADD COLUMN IF NOT EXISTS variante_aviamento_id uuid REFERENCES public.variantes_aviamento(id);
CREATE INDEX IF NOT EXISTS idx_ocs_aviamento_itens_variante
  ON public.ocs_aviamento_itens (variante_aviamento_id);

ALTER TABLE public.cad_aviamentos
  ADD COLUMN IF NOT EXISTS variante_aviamento_id uuid REFERENCES public.variantes_aviamento(id);
CREATE INDEX IF NOT EXISTS idx_cad_aviamentos_variante
  ON public.cad_aviamentos (variante_aviamento_id);

ALTER TABLE public.ordens_saida_aviamento_itens
  ADD COLUMN IF NOT EXISTS variante_aviamento_id uuid REFERENCES public.variantes_aviamento(id);
CREATE INDEX IF NOT EXISTS idx_ordens_saida_aviamento_itens_variante
  ON public.ordens_saida_aviamento_itens (variante_aviamento_id);

-- ---------------------------------------------------------------------------
-- 6) Helper interno: conta uso de uma variante nas tabelas downstream (padrão
--    excluir_variante_tecido). EXECUTE revogado dos TRÊS (invariante #9).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._variante_aviamento_em_uso(_variante_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (SELECT count(*) FROM modelo_aviamentos             WHERE variante_aviamento_id = _variante_id)
  + (SELECT count(*) FROM ocs_aviamento_itens           WHERE variante_aviamento_id = _variante_id)
  + (SELECT count(*) FROM cad_aviamentos                WHERE variante_aviamento_id = _variante_id)
  + (SELECT count(*) FROM ordens_saida_aviamento_itens  WHERE variante_aviamento_id = _variante_id);
$$;
REVOKE EXECUTE ON FUNCTION public._variante_aviamento_em_uso(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) RPC guarda de exclusão — espelha excluir_variante_tecido.
--    Bloqueia se a cor estiver em uso; senão apaga e devolve foto_url p/ limpar storage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_variante_aviamento(_variante_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_aviamento uuid; v_foto text; v_n bigint;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT aviamento_id, foto_url INTO v_aviamento, v_foto
    FROM variantes_aviamento WHERE id = _variante_id AND tenant_id = v_tenant;
  IF v_aviamento IS NULL THEN RAISE EXCEPTION 'Variante não encontrada'; END IF;

  v_n := public._variante_aviamento_em_uso(_variante_id);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Não é possível excluir esta cor: ela está em uso em % registro(s) (OCs, modelos, CAD ou ordens de saída). Zere/estorne o uso antes.', v_n;
  END IF;

  DELETE FROM variantes_aviamento WHERE id = _variante_id AND tenant_id = v_tenant;
  RETURN jsonb_build_object('foto_url', v_foto);
END $$;
REVOKE EXECUTE ON FUNCTION public.excluir_variante_aviamento(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.excluir_variante_aviamento(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) RPC de gravação ATÔMICA do conjunto de variantes de um aviamento.
--    Diff por id (delete-não-mantido [guardado], update mantido, insert novo) numa txn.
--    Usada pelo diálogo "+ Novo" (bulk após criar o aviamento) e disponível p/ o Sheet.
--    _variantes = [{id?, cor_id, cor_apelido_id?, nome_variante?, codigo_variante?, preco?}]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvar_variantes_aviamento(_aviamento_id uuid, _variantes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_keep uuid[];
  v_del uuid;
  r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  -- Aviamento tem de ser da loja (fecha IDOR por payload forjado).
  IF NOT EXISTS (SELECT 1 FROM aviamentos a
                 WHERE a.id = _aviamento_id AND (a.tenant_id = v_tenant OR public.is_super_admin())) THEN
    RAISE EXCEPTION 'Aviamento não encontrado ou sem permissão';
  END IF;

  -- Apelido (se informado) tem de pertencer à cor base escolhida (espelha o vínculo do front).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_variantes, '[]'::jsonb)) e
    JOIN cores_apelido ca ON ca.id = (e->>'cor_apelido_id')::uuid
    WHERE e->>'cor_apelido_id' IS NOT NULL
      AND ca.cor_base_id IS DISTINCT FROM (e->>'cor_id')::uuid
  ) THEN
    RAISE EXCEPTION 'Cor apelido não pertence à cor base informada.';
  END IF;

  -- ids mantidos (linhas existentes reenviadas).
  v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
                  WHERE e->>'id' IS NOT NULL);

  -- Deletes (linhas some do payload) — guardado por uso downstream.
  FOR v_del IN
    SELECT id FROM variantes_aviamento
    WHERE aviamento_id = _aviamento_id AND tenant_id = v_tenant
      AND NOT (id = ANY(v_keep))
  LOOP
    IF public._variante_aviamento_em_uso(v_del) > 0 THEN
      RAISE EXCEPTION 'Não é possível remover uma cor em uso (OCs, modelos, CAD ou ordens de saída). Zere/estorne o uso antes.';
    END IF;
    DELETE FROM variantes_aviamento WHERE id = v_del;
  END LOOP;

  -- Updates (linhas existentes) e inserts (novas).
  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
           WHERE e->>'cor_id' IS NOT NULL
  LOOP
    IF (r->>'id') IS NOT NULL AND (r->>'id')::uuid = ANY(v_keep) THEN
      UPDATE variantes_aviamento SET
        cor_id          = (r->>'cor_id')::uuid,
        cor_apelido_id  = NULLIF(r->>'cor_apelido_id','')::uuid,
        nome_variante   = NULLIF(r->>'nome_variante',''),
        codigo_variante = NULLIF(r->>'codigo_variante',''),
        preco           = NULLIF(r->>'preco','')::numeric
      WHERE id = (r->>'id')::uuid AND aviamento_id = _aviamento_id AND tenant_id = v_tenant;
    ELSE
      INSERT INTO variantes_aviamento
        (id, tenant_id, aviamento_id, cor_id, cor_apelido_id, nome_variante, codigo_variante, preco)
      VALUES
        (COALESCE(NULLIF(r->>'id','')::uuid, gen_random_uuid()), v_tenant, _aviamento_id,
         (r->>'cor_id')::uuid, NULLIF(r->>'cor_apelido_id','')::uuid,
         NULLIF(r->>'nome_variante',''), NULLIF(r->>'codigo_variante',''), NULLIF(r->>'preco','')::numeric);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('aviamento_id', _aviamento_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.salvar_variantes_aviamento(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_variantes_aviamento(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9) Backfill idempotente: cada aviamento COM cor vira uma primeira variante.
--    (o log de preço grava historico_precos automaticamente quando preco não é nulo)
-- ---------------------------------------------------------------------------
INSERT INTO public.variantes_aviamento (tenant_id, aviamento_id, cor_id, cor_apelido_id, preco)
SELECT a.tenant_id, a.id, a.cor_id, a.cor_apelido_id, a.preco
FROM public.aviamentos a
WHERE a.cor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.variantes_aviamento va WHERE va.aviamento_id = a.id);

COMMIT;
