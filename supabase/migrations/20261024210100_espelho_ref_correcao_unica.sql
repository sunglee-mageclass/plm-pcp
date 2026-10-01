-- Achados MEDIOS, release R14, sku #18 - CORRECAO UNICA (OPCIONAL, SEPARADA) dos cards ja vinculados SEM a REF do produto.
-- Mesma regra do gatilho novo (20261024210000, P-88 A): card comprado (revenda/importado) com REF VAZIA, ainda NAO enviado
-- a Explosao (enviado_cad), vinculado (mesma loja) a um produto com REF, e nao travado pela Integracao com 'ref_sku' -> o
-- card recebe a REF do produto. REF manual/digitada nunca e tocada (so REF vazia).
-- Passo 0 de producao (01/out 11:06): SO f8e77ebe ("Cinto Teste", Loja Teste) - 1 card; copia 54422: 2 (d17ba971 "QA F3.4"
-- e f8e77ebe "Cinto Teste", Loja Teste). Teto de seguranca: mais de 5 candidatos -> P0001 e nada muda (conferir o Passo 0).
-- Guarda: exige a 20261024210000 aplicada e ATIVA (funcao com o texto da ida + os 2 gatilhos ligados) - a regra daqui pra
-- frente e a mesma desta correcao. Idempotente: rodar de novo = 0 cards. Imprime (NOTICE) a lista e a contagem.
-- Autor na auditoria (fn_audit) = quem roda (sem JWT = Sistema). Sem inverso automatico: REF revelada nao volta (inv. #11);
-- a lista impressa e o registro (desfazer = editar a REF do card a mao).
-- Travas: FOR UPDATE nas linhas de modelos afetadas (+ ShareRowExclusive implicita do UPDATE); nada em auth/storage.
-- Aplicar fora de transacao, DEPOIS da 20261024210000: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_espelho_ref_ao_vincular()') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_espelho_ref_ao_vincular()'))) IS DISTINCT FROM '6baf719f2041243c7e340e618e5489f0' THEN
    RAISE EXCEPTION 'medios_r14_sku18 (correcao): a 20261024210000 nao esta aplicada/ativa - aplicar a ida antes' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'trg_espelho_ref_ao_vincular' AND t.tgenabled = 'O'
        AND t.tgrelid IN (to_regclass('public.produtos_acabados'), to_regclass('public.produtos_importados'))) <> 2 THEN
    RAISE EXCEPTION 'medios_r14_sku18 (correcao): os 2 gatilhos trg_espelho_ref_ao_vincular nao estao ligados' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

DO $corrige$
DECLARE
  r record;
  v_n integer := 0;
  v_cand integer;
BEGIN
  -- tabela temporaria da transacao (IF NOT EXISTS + DELETE: reexecutar na mesma transacao tambem funciona)
  CREATE TEMP TABLE IF NOT EXISTS _r14_sku18_alvo (id uuid, tenant_id uuid, loja text, nome text, pref text) ON COMMIT DROP;
  DELETE FROM _r14_sku18_alvo;
  INSERT INTO _r14_sku18_alvo (id, tenant_id, loja, nome, pref)
    WITH prod AS (
      SELECT pa.modelo_id, pa.tenant_id, nullif(btrim(coalesce(pa.ref::text, '')), '') AS pref
        FROM public.produtos_acabados pa WHERE pa.modelo_id IS NOT NULL
      UNION ALL
      SELECT pi.modelo_id, pi.tenant_id, nullif(btrim(coalesce(pi.ref::text, '')), '')
        FROM public.produtos_importados pi WHERE pi.modelo_id IS NOT NULL)
    SELECT m.id, m.tenant_id, coalesce(tn.nome::text, '?') AS loja, m.nome::text AS nome, p.pref
      FROM public.modelos m
      JOIN prod p ON p.modelo_id = m.id AND p.tenant_id = m.tenant_id AND p.pref IS NOT NULL
      LEFT JOIN public.tenants tn ON tn.id = m.tenant_id
     WHERE coalesce(m.origem, 'interno') IN ('revenda', 'importado')
       AND coalesce(btrim(m.ref::text), '') = ''
       AND NOT coalesce(m.enviado_cad, false)
       AND NOT public._integracao_campo_travado(m.id, 'ref_sku');
  SELECT count(*) INTO v_cand FROM _r14_sku18_alvo;
  IF v_cand > 5 THEN
    RAISE EXCEPTION 'medios_r14_sku18 (correcao): % candidatos (esperado ate 5; producao 1) - conferir o Passo 0 antes', v_cand
      USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.modelos m WHERE m.id IN (SELECT a.id FROM _r14_sku18_alvo a) ORDER BY m.id FOR UPDATE;
  FOR r IN SELECT a.* FROM _r14_sku18_alvo a ORDER BY a.loja, a.id LOOP
    UPDATE public.modelos m SET ref = r.pref
     WHERE m.id = r.id AND coalesce(btrim(m.ref::text), '') = '' AND NOT coalesce(m.enviado_cad, false);
    IF FOUND THEN
      v_n := v_n + 1;
      RAISE NOTICE 'medios_r14_sku18 (correcao): % | % | % -> REF %', r.loja, r.id, r.nome, r.pref;
    END IF;
  END LOOP;
  RAISE NOTICE 'medios_r14_sku18 (correcao): % card(s) receberam a REF do produto', v_n;
END $corrige$;

DO $pos$
BEGIN
  IF EXISTS (
      SELECT 1 FROM public.modelos m
        JOIN (SELECT pa.modelo_id, pa.tenant_id, pa.ref FROM public.produtos_acabados pa WHERE pa.modelo_id IS NOT NULL
              UNION ALL
              SELECT pi.modelo_id, pi.tenant_id, pi.ref FROM public.produtos_importados pi WHERE pi.modelo_id IS NOT NULL) p
          ON p.modelo_id = m.id AND p.tenant_id = m.tenant_id AND nullif(btrim(coalesce(p.ref::text, '')), '') IS NOT NULL
       WHERE coalesce(m.origem, 'interno') IN ('revenda', 'importado')
         AND coalesce(btrim(m.ref::text), '') = ''
         AND NOT coalesce(m.enviado_cad, false)
         AND NOT public._integracao_campo_travado(m.id, 'ref_sku')) THEN
    RAISE EXCEPTION 'medios_r14_sku18 (correcao): pos-condicao falhou - ainda ha card candidato sem REF' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
