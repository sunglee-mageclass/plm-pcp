-- Persiste o DESTRINCHAMENTO planejado de rolos por item da OC (modo Só Rolo). Antes
-- o split (+rolo) no encomendado era só estado local: salvar e reabrir o encomendado
-- perdia os rolos digitados. Agora o planejamento fica no item; ao receber, os rolos
-- reais (ocs_tecido is_rolo) são criados a partir dele. Formato: jsonb [{ "qtd": n }].
ALTER TABLE public.ocs_tecido_itens
  ADD COLUMN IF NOT EXISTS rolos_planejados jsonb;
