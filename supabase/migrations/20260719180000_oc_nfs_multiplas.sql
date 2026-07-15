-- OC Tecido/Aviamento: várias Notas Fiscais por OC (lista), no lugar do modelo
-- "NF atual + histórico arquivado" (que confundia). `nfs` = jsonb array de {url, data}.
-- `nf_url` continua sendo a NF "primária" (= primeira da lista) p/ compat com quem lê
-- nf_url (gate de recebimento, impressões). Backfill idempotente a partir de nf_url +
-- nf_historico (tecido).

BEGIN;

ALTER TABLE public.ocs_tecido    ADD COLUMN IF NOT EXISTS nfs jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.ocs_aviamento ADD COLUMN IF NOT EXISTS nfs jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill Tecido: [NF atual] ++ histórico (só onde ainda vazio).
UPDATE public.ocs_tecido
SET nfs = (
  CASE WHEN nf_url IS NOT NULL AND btrim(nf_url) <> ''
       THEN jsonb_build_array(jsonb_build_object('url', nf_url,
              'data', to_char(COALESCE(data_entrega, created_at::date), 'YYYY-MM-DD')))
       ELSE '[]'::jsonb END
  || COALESCE(nf_historico, '[]'::jsonb)
)
WHERE nfs = '[]'::jsonb
  AND ((nf_url IS NOT NULL AND btrim(nf_url) <> '') OR COALESCE(jsonb_array_length(nf_historico), 0) > 0);

-- Backfill Aviamento: [NF atual].
UPDATE public.ocs_aviamento
SET nfs = jsonb_build_array(jsonb_build_object('url', nf_url,
            'data', to_char(COALESCE(data_entrega, created_at::date), 'YYYY-MM-DD')))
WHERE nfs = '[]'::jsonb AND nf_url IS NOT NULL AND btrim(nf_url) <> '';

COMMIT;

select pg_notify('pgrst','reload schema');
