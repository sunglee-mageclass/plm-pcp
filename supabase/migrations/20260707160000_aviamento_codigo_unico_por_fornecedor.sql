-- Aviamento: o código PODE repetir entre fornecedores diferentes (são itens diferentes), mas
-- NÃO pode repetir o mesmo código no MESMO fornecedor (duplicata real). Índice único por
-- (tenant, código normalizado [minúsculo+trim], fornecedor).
-- NULLS NOT DISTINCT: "sem fornecedor" (empresa_id NULL) passa a contar como um valor só —
-- assim dois aviamentos com o mesmo código e ambos SEM fornecedor também colidem.
-- (Verificado: 0 duplicatas hoje sob essa chave, então o índice constrói limpo.)
create unique index if not exists uq_aviamento_codigo_fornecedor
  on public.aviamentos (tenant_id, lower(trim(codigo_nome)), empresa_id)
  nulls not distinct;

select pg_notify('pgrst', 'reload schema');
