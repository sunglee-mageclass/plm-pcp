-- Toggle POR LOJA "Análise de markup por faixa" — oculta/mostra os 2 blocos da Markup Fase B no
-- Sheet do Planejamento ("Preço por faixa de markup" + "M.O. que cabe por faixa"). Opt-in, default
-- OFF (nem toda loja usa análise avançada de custo). Coluna booleana simples em tenant_config,
-- mesmo padrão de usa_pl/corte_interno/oficina_interna. Aditiva/idempotente. A Fase A (faixas
-- mín/ideal/máx no bloco "Markup", só leitura) NÃO é controlada por este flag.

BEGIN;

ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS markup_analise_faixa boolean NOT NULL DEFAULT false;

COMMIT;

select pg_notify('pgrst','reload schema');
