-- Inverso de 20261212100000_exportar_por_tipo: DROP das 6 funcoes NOVAS (objetos inertes; nenhum inverso antigo depende deles).
-- Aplicar ANTES de qualquer volta da 20261201130000 (que nao tem relacao de dependencia, mas a LIFO manda). SITE voltado antes (o site novo chama as RPCs).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
DROP FUNCTION IF EXISTS public.exportar_tecidos(text, text[], text[], integer);
DROP FUNCTION IF EXISTS public.exportar_aviamentos(text, text, text[], text[], integer);
DROP FUNCTION IF EXISTS public.exportar_insumos(text, text[], text[], integer);
DROP FUNCTION IF EXISTS public._exportar_tecidos_core(uuid, text, text[], text[], integer);
DROP FUNCTION IF EXISTS public._exportar_aviamentos_core(uuid, text, text, text[], text[], integer);
DROP FUNCTION IF EXISTS public._exportar_insumos_core(uuid, text, text[], text[], integer);
COMMIT;
