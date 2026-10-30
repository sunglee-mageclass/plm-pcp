-- R13 Passo 0 (SO LEITURA) — 1 linha por loja. Rodar ANTES da ida.
--   docker exec -i supabase_db_banco-local psql -U postgres -d copia4 -f supabase/consultas/urg_r13_passo0.sql
-- PARE se: produto em >1 OC (pa_dup/pi_dup > 0), ponteiro de outra loja (pa_ptr_outra/pi_ptr_outra > 0),
--   tabelas de itens JA existem (itens_ja_existem > 0), md5 das 4 funcoes != "antes" (md5_divergente > 0).
-- Avisos ao dono: OCs encomendadas (pa_enc/pi_enc) seguem como OC de 1 produto.
WITH
md5_antes AS (
  SELECT count(*) AS md5_divergente FROM (VALUES
    ('public.fn_oc_p_acabado_numero()','23493539af3e477595c10fa882a9be38'),
    ('public.fn_oc_importado_numero()','d9cd6c78b13ab8661771d969ba905d2e'),
    ('public.enforce_oc_pa_vinculo_unico()','f5c10226397ed541f671072d987137c0'),
    ('public.enforce_oc_importado_vinculo_unico()','20ca3892d8a8fb66a96f226c2d5c33b0')
  ) v(f, m)
  WHERE md5(pg_get_functiondef(to_regprocedure(v.f))) IS DISTINCT FROM v.m
),
tab AS (
  SELECT (to_regclass('public.ocs_p_acabado_itens') IS NOT NULL)::int
       + (to_regclass('public.ocs_importado_itens') IS NOT NULL)::int AS itens_ja_existem
)
SELECT t.id AS tenant_id, t.nome,
  (SELECT count(*) FROM public.ocs_p_acabado o WHERE o.tenant_id = t.id) AS pa_ocs,
  (SELECT count(*) FROM public.ocs_p_acabado o WHERE o.tenant_id = t.id AND o.status = 'encomendado') AS pa_enc,
  (SELECT count(*) FROM public.ocs_p_acabado o WHERE o.tenant_id = t.id AND o.produto_acabado_id IS NULL) AS pa_avulsas,
  (SELECT count(*) FROM (SELECT produto_acabado_id FROM public.ocs_p_acabado WHERE tenant_id = t.id AND produto_acabado_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d) AS pa_dup,
  (SELECT count(*) FROM public.ocs_p_acabado o JOIN public.produtos_acabados p ON p.id = o.produto_acabado_id WHERE o.tenant_id = t.id AND p.tenant_id IS DISTINCT FROM o.tenant_id) AS pa_ptr_outra,
  (SELECT count(*) FROM public.ocs_importado o WHERE o.tenant_id = t.id) AS pi_ocs,
  (SELECT count(*) FROM public.ocs_importado o WHERE o.tenant_id = t.id AND o.status = 'encomendado') AS pi_enc,
  (SELECT count(*) FROM public.ocs_importado o WHERE o.tenant_id = t.id AND o.produto_importado_id IS NULL) AS pi_avulsas,
  (SELECT count(*) FROM (SELECT produto_importado_id FROM public.ocs_importado WHERE tenant_id = t.id AND produto_importado_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d) AS pi_dup,
  (SELECT count(*) FROM public.ocs_importado o JOIN public.produtos_importados p ON p.id = o.produto_importado_id WHERE o.tenant_id = t.id AND p.tenant_id IS DISTINCT FROM o.tenant_id) AS pi_ptr_outra,
  (SELECT md5(coalesce(string_agg(pa.id::text || '|' || coalesce(pa.numero_parcela::text,'') || '|' || coalesce(pa.valor::text,''), '' ORDER BY pa.id),'')) FROM public.parcelas pa WHERE pa.tenant_id = t.id AND pa.tipo_oc = 'p_acabado') AS pa_parcelas_md5,
  (SELECT md5(coalesce(string_agg(pa.id::text || '|' || coalesce(pa.numero_parcela::text,'') || '|' || coalesce(pa.valor::text,''), '' ORDER BY pa.id),'')) FROM public.parcelas pa WHERE pa.tenant_id = t.id AND pa.tipo_oc = 'p_importado') AS pi_parcelas_md5,
  (SELECT md5_divergente FROM md5_antes) AS md5_divergente,
  (SELECT itens_ja_existem FROM tab) AS itens_ja_existem
FROM public.tenants t
ORDER BY t.nome;
