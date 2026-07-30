-- Meses: o prefixo de ordenação "NN|" vazava no NOME exibido (ex.: "02| Fevereiro") —
-- resquício de quando a ordem vinha do nome; hoje a ordem é a coluna `ordem` (1..12).
-- (Laudo do time de lentes UX, jul/2026 — aba OTB; aparece em toda tela que mostra mês.)
-- 1) limpa o dado existente (sem colisão: verificado UNIQUE(tenant_id, mes) pós-strip);
-- 2) re-semeia a função de defaults com nomes limpos (novas lojas/reset nascem certos).
-- Front tem strip defensivo em @/lib/format.mesLimpo p/ loja que renomear com prefixo.
BEGIN;

UPDATE public.meses
   SET mes = regexp_replace(mes, '^\d+\|\s*', '')
 WHERE mes ~ '^\d+\|';

CREATE OR REPLACE FUNCTION public._seed_tenant_defaults(_tid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem)
  VALUES (_tid, 'Corte', 0), (_tid, 'Oficina', 1)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 12 meses FIXOS (ordem 1..12) — a UI não deixa criar (atributo `fixed`), então precisam
  -- existir sempre; senão o dropdown de Mês (Planejamento/CAD/CQ/OTB/Lançamentos) fica vazio.
  INSERT INTO public.meses (tenant_id, mes, ordem) VALUES
    (_tid, 'Janeiro', 1), (_tid, 'Fevereiro', 2), (_tid, 'Março', 3),
    (_tid, 'Abril', 4), (_tid, 'Maio', 5), (_tid, 'Junho', 6),
    (_tid, 'Julho', 7), (_tid, 'Agosto', 8), (_tid, 'Setembro', 9),
    (_tid, 'Outubro', 10), (_tid, 'Novembro', 11), (_tid, 'Dezembro', 12)
  ON CONFLICT (tenant_id, mes) DO NOTHING;

  -- Ano corrente + próximo, p/ a loja já posicionar modelos no calendário ao abrir/resetar.
  INSERT INTO public.anos (tenant_id, ano) VALUES
    (_tid, EXTRACT(YEAR FROM CURRENT_DATE)::int::text),
    (_tid, (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text)
  ON CONFLICT (tenant_id, ano) DO NOTHING;
END;
$function$;

COMMIT;
