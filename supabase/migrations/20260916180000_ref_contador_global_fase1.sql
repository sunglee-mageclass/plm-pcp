-- REF unificada — FASE 1: contador GLOBAL por loja, que SÓ SOBE (acaba com a colisão entre famílias).
--
-- Problema: hoje `_modelo_ref_next_num`, `_produto_acabado_ref_next` e `_produto_importado_ref_next`
-- contam CADA um só a própria tabela, com locks diferentes; os de produto começam em 1 (7 díg). Dois
-- produtos de famílias diferentes acabam com a MESMA REF (colisão real: ONV0000001 em modelos,
-- produtos_acabados E produtos_importados do mesmo tenant).
--
-- Correção: um contador ÚNICO por loja que **só sobe** (guarda o maior número JÁ EMITIDO numa tabela
-- de sequência), imune a exclusão — nunca reusa, nem o número de um produto excluído (decisão do
-- dono). Os 3 next-num existentes viram wrappers que delegam a ele, então os 3 triggers NÃO mudam
-- nesta fase e o `lpad(...,N,'0')` dos produtos é inofensivo (um número maior que N dígitos passa
-- intacto — lpad só completa à esquerda, nunca corta).
--
-- Largura (nº de dígitos) e piso ("começar em") são PARÂMETROS com default (8 díg / piso 10000000 =
-- comportamento atual do modelo interno). A Fase 2 passa os valores configurados por loja; sem
-- config, o default preserva o de hoje.
--
-- "Congelar antigas" sai de graça: o seed inicial da sequência (Fase 4) parte do MAX existente das 3
-- tabelas, e o piso 10000000 fica acima dos números antigos de produto (≤ 9999999, 7 díg) — o pool
-- novo nunca reencontra um número antigo. Nada de UPDATE em REF existente.

BEGIN;

-- ── Tabela de sequência por loja (o "maior já emitido") ───────────────────────
CREATE TABLE IF NOT EXISTS public.ref_sequencia (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  ultimo    bigint NOT NULL DEFAULT 0,   -- maior número JÁ EMITIDO (0 = nada emitido ainda)
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ref_sequencia ENABLE ROW LEVEL SECURITY;
-- Sem policy de leitura/escrita p/ authenticated: a tabela é tocada SÓ pela função DEFINER abaixo
-- (o cliente nunca lê nem escreve direto). RLS ligada + zero policy = ninguém acessa via REST.

-- ── Seed inicial: parte do MAX existente das 3 tabelas (idempotente) ───────────
-- Garante que uma loja que já tem REFs não recomece — o contador nasce no maior número já usado.
-- Regex GULOSO `([0-9]+)$` (todo o bloco final de dígitos), não {7}/{8} fixo — pega os dois formatos.
INSERT INTO public.ref_sequencia (tenant_id, ultimo)
SELECT t.id, COALESCE((
  SELECT max(n) FROM (
    SELECT substring(m.ref_auto from '([0-9]+)$')::bigint AS n
      FROM public.modelos m WHERE m.tenant_id = t.id AND m.ref_auto ~ '[0-9]+$'
    UNION ALL
    SELECT substring(m.ref from '([0-9]+)$')::bigint
      FROM public.modelos m WHERE m.tenant_id = t.id AND m.ref ~ '[0-9]+$'
    UNION ALL
    SELECT substring(pa.ref from '([0-9]+)$')::bigint
      FROM public.produtos_acabados pa WHERE pa.tenant_id = t.id AND pa.ref ~ '[0-9]+$'
    UNION ALL
    SELECT substring(pi.ref from '([0-9]+)$')::bigint
      FROM public.produtos_importados pi WHERE pi.tenant_id = t.id AND pi.ref ~ '[0-9]+$'
  ) x
), 0)
FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;   -- reaplicar não zera o que já avançou

-- ── Contador GLOBAL que só sobe ───────────────────────────────────────────────
-- _piso: menor valor aceitável (o "começar em" da loja; default 10000000 = comportamento atual).
--        Age só quando a loja ainda não passou dele. NUNCA faz o contador VOLTAR.
CREATE OR REPLACE FUNCTION public._ref_next_global(_tenant uuid, _piso bigint DEFAULT 10000000)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE v bigint;
BEGIN
  -- lock ÚNICO por loja (unifica os 3 antigos) — serializa a emissão entre as famílias.
  PERFORM pg_advisory_xact_lock(hashtext('ref_global:' || _tenant::text));
  -- Garante a linha da sequência (loja criada depois desta migração).
  INSERT INTO public.ref_sequencia (tenant_id, ultimo) VALUES (_tenant, 0)
    ON CONFLICT (tenant_id) DO NOTHING;
  -- Incrementa: próximo = max(ultimo + 1, piso). O GREATEST aplica o piso SÓ quando ainda não
  -- passou dele; se `ultimo` já é maior, o piso é inócuo (nunca faz voltar).
  UPDATE public.ref_sequencia
    SET ultimo = GREATEST(ultimo + 1, _piso), updated_at = now()
    WHERE tenant_id = _tenant
    RETURNING ultimo INTO v;
  RETURN v;
END $function$;

REVOKE EXECUTE ON FUNCTION public._ref_next_global(uuid, bigint) FROM public, anon, authenticated;

-- ── Os 3 next-num viram WRAPPERS que delegam ao global (triggers ficam intactos) ──
-- Passam o piso default (10000000) — a Fase 2 troca por leitura da config por loja.
CREATE OR REPLACE FUNCTION public._modelo_ref_next_num(_tenant uuid)
 RETURNS bigint LANGUAGE sql
AS $function$ SELECT public._ref_next_global(_tenant, 10000000); $function$;

CREATE OR REPLACE FUNCTION public._produto_acabado_ref_next(_tenant uuid)
 RETURNS bigint LANGUAGE sql
AS $function$ SELECT public._ref_next_global(_tenant, 10000000); $function$;

CREATE OR REPLACE FUNCTION public._produto_importado_ref_next(_tenant uuid)
 RETURNS bigint LANGUAGE sql
AS $function$ SELECT public._ref_next_global(_tenant, 10000000); $function$;

-- Mantém o REVOKE dos 3 (invariante #9 — só as triggers DEFINER chamam).
REVOKE EXECUTE ON FUNCTION public._modelo_ref_next_num(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._produto_acabado_ref_next(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._produto_importado_ref_next(uuid) FROM public, anon, authenticated;

COMMIT;
