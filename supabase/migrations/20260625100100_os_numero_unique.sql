-- Unicidade do número da OS por loja. O número é editável e, em branco, faz
-- auto-incremento (max(numero)+1) FORA de transação — sem constraint, dois usuários
-- simultâneos (ou edição manual com número já usado) geram OS duplicada sem alerta.
-- numero é só rótulo legível/busca (nunca FK), então a colisão causava ambiguidade,
-- não corrupção. Índice único composto por loja (tabelas separadas = por tipo).
-- Verificado antes de aplicar: 0 duplicatas (tenant_id, numero) em ambas as tabelas.
CREATE UNIQUE INDEX IF NOT EXISTS ordens_saida_tecido_tenant_numero_uidx
  ON public.ordens_saida_tecido (tenant_id, numero);

CREATE UNIQUE INDEX IF NOT EXISTS ordens_saida_aviamento_tenant_numero_uidx
  ON public.ordens_saida_aviamento (tenant_id, numero);
