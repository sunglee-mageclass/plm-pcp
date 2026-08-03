-- Código automático do Rolo — novo formato (dono, ago/2026):
--   R{sigla}{YYMMDD}{seq 10 díg}
-- sigla = 2 iniciais do NOME DO TECIDO (artigos.nome): multi-palavra → inicial das 2 primeiras
--         palavras (ALFAIATARIA FLAT→AF, MALHA LUNE→ML); 1 palavra → 2 primeiras letras (ANGELIM→AN).
--         (mesma convenção da sigla da REF do modelo.)
-- data  = YYMMDD (ano/mês/dia), fuso America/Sao_Paulo (como o formato anterior).
-- seq   = contador GLOBAL por loja (rolo_counters, o mesmo de antes), agora com 10 dígitos.
-- Antes: R{seq 4}{1ª letra da categoria}{YYMMDD} (ex.: R0006L260625). O front (Rolos.tsx) só
-- exibe o que a RPC devolve — nenhuma mudança de front.
CREATE OR REPLACE FUNCTION public.proximo_codigo_rolo(_artigo_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_nome text := '';
  v_palavras text[];
  v_sigla text := '';
  v_seq int;
BEGIN
  IF v_tenant IS NULL THEN RETURN ''; END IF;
  IF _artigo_id IS NOT NULL THEN
    SELECT UPPER(TRIM(COALESCE(a.nome, ''))) INTO v_nome FROM public.artigos a WHERE a.id = _artigo_id;
  END IF;
  -- Sigla: inicial das 2 primeiras palavras; se só 1 palavra, 2 primeiras letras dela.
  v_palavras := regexp_split_to_array(v_nome, '\s+');
  IF COALESCE(array_length(v_palavras, 1), 0) >= 2 AND v_palavras[2] <> '' THEN
    v_sigla := LEFT(v_palavras[1], 1) || LEFT(v_palavras[2], 1);
  ELSE
    v_sigla := LEFT(v_nome, 2);
  END IF;

  INSERT INTO public.rolo_counters (tenant_id, seq) VALUES (v_tenant, 1)
  ON CONFLICT (tenant_id) DO UPDATE SET seq = public.rolo_counters.seq + 1
  RETURNING seq INTO v_seq;

  RETURN 'R' || v_sigla
         || to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYMMDD')
         || LPAD(v_seq::text, 10, '0');
END;
$function$;
