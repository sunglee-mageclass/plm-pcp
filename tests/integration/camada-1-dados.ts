// GERADO por .superpowers/sdd/2026-10-05-camada/mig/gerar-c1.mjs (nunca editar a mao; rode o gerador de novo).
// Camada C1 - md5 de ANTES e DEPOIS dos 6 wrappers de estado completo (trava do "salvar vazio", P-77 A; + a lista do
// servico com parcela paga no salvar_terceirizados, P-268 A) e da funcao do gatilho novo (P-268 A em todo caminho).
// Contrato igual ao de bk-helpers.ts: CAMADA_MD5 + CAMADA_SENTINELA.
export const CAMADA_MIG = "supabase/migrations/20261103160000_camada_estado_vazio.sql";
export const CAMADA_DOWN = "supabase/rollback/20261103160000_camada_estado_vazio_down.sql";
export const CAMADA_MIG_GAT = "supabase/migrations/20261103161000_camada_parcela_paga.sql";
export const CAMADA_DOWN_GAT = "supabase/rollback/20261103161000_camada_parcela_paga_down.sql";
export const CAMADA_DROP_GAT = "supabase/rollback/20261103161000_camada_parcela_paga_down_drop.sql";
export const CAMADA_SENTINELA = "public.salvar_terceirizados(uuid,jsonb,text,jsonb)";
export const CAMADA_MD5: Record<string, { antes: string; depois: string }> = {
  "public.salvar_terceirizados(uuid,jsonb,text,jsonb)": { antes: "7199a05fac6716ac110bfa637944c2e9", depois: "8f62269d795eb29e942d089c1c44e698" },
  "public.salvar_direcionamento(uuid,jsonb,jsonb)": { antes: "7f5e84c87bcfe7f14d123053063da1d0", depois: "602b905c36f1ea1b4c7aa3a85aa0010d" },
  "public.confirmar_direcionamento(uuid,jsonb,jsonb)": { antes: "ae30cec520c8a1cc436e500b3b976396", depois: "c9b194ed5f4b2f8bf889adc2f0c1c003" },
  "public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)": { antes: "26c656169b6f9ef826e5b93932b15fe9", depois: "c68f8dca982d5bab85c9f1eda1771672" },
  "public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)": { antes: "ffb1f2c87801362f9f9895be07d71dc0", depois: "1fee21683a10b936d0667800073b7873" },
  "public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)": { antes: "5bfa12603078c4c57fbc5abc6a2b7969", depois: "ad6c775a57fedcc38fb6711af63237c8" },
};
/** entidade no RAISE 'estado_vazio_recusado: <entidade> <n>' de cada wrapper. */
export const CAMADA_ENTIDADE: Record<string, string> = {
  "public.salvar_terceirizados(uuid,jsonb,text,jsonb)": "servicos",
  "public.salvar_direcionamento(uuid,jsonb,jsonb)": "direcionamento",
  "public.confirmar_direcionamento(uuid,jsonb,jsonb)": "direcionamento",
  "public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)": "itens_oc",
  "public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)": "itens_oc",
  "public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)": "itens_oc",
};
/** proacl::text de antes (= depois: CREATE OR REPLACE preserva). */
export const CAMADA_ACL: Record<string, string> = {
  "public.salvar_terceirizados(uuid,jsonb,text,jsonb)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.salvar_direcionamento(uuid,jsonb,jsonb)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.confirmar_direcionamento(uuid,jsonb,jsonb)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
  "public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)": "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
};
export const CAMADA_GAT = {
  fn: "public.fn_servico_parcela_paga_bloqueia_delete()",
  ida: "8e5618da90c83c2e788e0c9f6f8794ad",
  neutro: "7a6dd9a7e13c300569c162808081bf7f",
  nome: "trg_servico_parcela_paga_bloqueia_delete",
  tabela: "public.producao_terceirizados",
  tgtype: 11,
};
