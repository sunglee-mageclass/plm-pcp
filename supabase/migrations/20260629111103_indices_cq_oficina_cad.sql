-- Índices faltantes em controle_qualidade(cad_id) e producao_oficina(cad_id).
-- O embed-fix (20260619430000) dropou os UNIQUE(cad_id) dessas tabelas e levou junto
-- o índice implícito; a reposição plana foi feita p/ cad/lancamentos mas esquecida
-- aqui. enforce_unique_fk (EXISTS por cad_id) e os embeds cad→cq/oficina faziam seq
-- scan. Aditivo e seguro (não muda schema da API; sem NOTIFY pgrst).
CREATE INDEX IF NOT EXISTS idx_cq_cad ON public.controle_qualidade(cad_id);
CREATE INDEX IF NOT EXISTS idx_oficina_cad ON public.producao_oficina(cad_id);
