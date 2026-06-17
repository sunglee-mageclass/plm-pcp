-- Status CAD: consolida para apenas "pendente" e "enviado".
-- Antes existiam "em_corte" e "pronto" (este último nunca era gravado).
-- Linhas já enviadas ao corte passam a usar "enviado".
UPDATE public.cad
SET status_corte = 'enviado'
WHERE status_corte IN ('em_corte', 'pronto');
