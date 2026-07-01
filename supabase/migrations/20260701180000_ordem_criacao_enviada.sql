-- Gate explícito Planejamento -> Desenvolvimento: um botão "Enviar Ordem de Criação"
-- (em vez do status 'planejado' mandar automático pro Dev).
ALTER TABLE public.modelos
  ADD COLUMN IF NOT EXISTS ordem_criacao_enviada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ordem_criacao_enviada_at timestamptz;
-- Backfill: modelos que já estão 'planejado' continuam no Desenvolvimento (senão sumiriam).
UPDATE public.modelos
   SET ordem_criacao_enviada = true, ordem_criacao_enviada_at = now()
 WHERE status_planejamento = 'planejado';
