-- Higiene do review (FIX WAVE, H2): `ocs_p_acabado.numero` virou EDITÁVEL na onda 2
-- (20260811160000_ocpa_numero_editavel.sql) mas nada impedia duas OCs da mesma loja
-- ficarem com o mesmo número (auto-gerado por `fn_oc_p_acabado_numero` só evita colisão
-- NA GERAÇÃO — editar depois pra um valor já usado por outra OC passava direto).
--
-- `numero` não é FK nem coluna embedada por nenhum consumidor PostgREST (é só texto
-- exibido/buscado) — então um UNIQUE index é seguro aqui (não corre o risco documentado
-- em "O que NÃO fazer" do CLAUDE.md sobre UNIQUE em coluna FK embedada, que é sobre
-- relacionamento 1:1, não sobre um campo de texto). `WHERE numero IS NOT NULL` porque
-- a coluna é NULLABLE durante o INSERT (a trigger gera o valor levemente depois, dentro
-- do mesmo BEFORE INSERT — nunca fica NULL de fato após o INSERT, mas o guard é honesto
-- sobre o tipo da coluna) e pra não colidir OCs antigas sem número (não deveria haver,
-- mas não custa a robustez).
create unique index if not exists ux_ocs_p_acabado_tenant_numero
  on public.ocs_p_acabado (tenant_id, numero)
  where numero is not null;
