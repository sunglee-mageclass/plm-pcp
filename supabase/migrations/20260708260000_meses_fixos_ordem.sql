-- Meses fixos (12), só renomeáveis, com ORDEM cronológica estável e independente do NOME.
--
-- Problema: hoje o nome do mês começa com o número ("01| Janeiro" ou "01"), e vários
-- lugares derivam o número/ordem do NOME:
--   • front: dropdowns fazem .order('mes') (só funciona porque o nome começa com 01..12);
--   • banco: _modelo_no_periodo faz split_part(mes,'|',1)::int (CRASHA se renomearem p/ "Jan").
-- O dono quer poder renomear a nomenclatura (01/Jan/JAN/Janeiro) mantendo a ordem certa.
-- Solução: coluna `ordem` (1..12) como fonte da ordem/numeração; nome vira só rótulo.

ALTER TABLE public.meses ADD COLUMN IF NOT EXISTS ordem smallint;

-- Backfill: número do mês pelo prefixo numérico do nome ("01| …"/"01"); se já renomearam
-- p/ só o nome ("Janeiro"), cai no match pelo nome PT (parte após o '|', ou o nome todo).
UPDATE public.meses m
   SET ordem = sub.ord
  FROM (
    SELECT id, COALESCE(
      NULLIF((regexp_match(mes, '^\s*0*(\d{1,2})'))[1], '')::smallint,
      CASE lower(trim(regexp_replace(mes, '^.*\|', '')))
        WHEN 'janeiro' THEN 1 WHEN 'fevereiro' THEN 2 WHEN 'março' THEN 3 WHEN 'marco' THEN 3
        WHEN 'abril' THEN 4 WHEN 'maio' THEN 5 WHEN 'junho' THEN 6 WHEN 'julho' THEN 7
        WHEN 'agosto' THEN 8 WHEN 'setembro' THEN 9 WHEN 'outubro' THEN 10
        WHEN 'novembro' THEN 11 WHEN 'dezembro' THEN 12 ELSE NULL END
    )::smallint AS ord
    FROM public.meses
  ) sub
 WHERE m.id = sub.id AND m.ordem IS NULL;

-- Salvaguarda: dado atual é limpo (3 tenants × 12 meses, prefixo 01..12). Se sobrar algo
-- sem número 1..12 derivável, a migração ABORTA — pra revisar antes em vez de gravar lixo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.meses WHERE ordem IS NULL OR ordem < 1 OR ordem > 12) THEN
    RAISE EXCEPTION 'meses.ordem: linha sem número 1..12 derivável do nome — revisar antes.';
  END IF;
END $$;

ALTER TABLE public.meses ALTER COLUMN ordem SET NOT NULL;
-- Um mês por posição por loja (impede duplicar e garante os 12 distintos).
CREATE UNIQUE INDEX IF NOT EXISTS meses_tenant_ordem_key ON public.meses(tenant_id, ordem);

-- Loja nova nasce com os 12 meses (padrão "0N| Nome"; nomenclatura editável depois),
-- espelhando o que o trigger já faz com Corte/Oficina. A ordem é fixa pela coluna `ordem`.
CREATE OR REPLACE FUNCTION public.criar_tenant_config_padrao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem)
  VALUES (NEW.id, 'Corte', 0), (NEW.id, 'Oficina', 1)
  ON CONFLICT (tenant_id, nome) DO NOTHING;
  INSERT INTO public.meses (tenant_id, mes, ordem) VALUES
    (NEW.id, '01| Janeiro', 1), (NEW.id, '02| Fevereiro', 2), (NEW.id, '03| Março', 3),
    (NEW.id, '04| Abril', 4), (NEW.id, '05| Maio', 5), (NEW.id, '06| Junho', 6),
    (NEW.id, '07| Julho', 7), (NEW.id, '08| Agosto', 8), (NEW.id, '09| Setembro', 9),
    (NEW.id, '10| Outubro', 10), (NEW.id, '11| Novembro', 11), (NEW.id, '12| Dezembro', 12)
  ON CONFLICT (tenant_id, mes) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Filtro de período dos dashboards: usar meses.ordem (número do mês) em vez de derivar
-- do nome — que agora é editável e pode não ter mais o prefixo numérico.
CREATE OR REPLACE FUNCTION public._modelo_no_periodo(p_mes_id uuid, p_ano_id uuid, p_inicio date, p_fim date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT (p_inicio IS NULL AND p_fim IS NULL)
    OR EXISTS (
      SELECT 1 FROM meses mm, anos aa
      WHERE mm.id = p_mes_id AND aa.id = p_ano_id
        AND (p_inicio IS NULL OR make_date(aa.ano::int, mm.ordem::int, 1) >= date_trunc('month', p_inicio)::date)
        AND (p_fim    IS NULL OR make_date(aa.ano::int, mm.ordem::int, 1) <= date_trunc('month', p_fim)::date)
    );
$function$;
