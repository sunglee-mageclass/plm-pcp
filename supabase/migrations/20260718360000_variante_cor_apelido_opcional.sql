-- Cor apelido virou OPCIONAL ao adicionar variante de tecido (a coluna já é nullable). O índice
-- único existente (uq_variantes_tecido_artigo_cor_apelido) só cobre (artigo,cor,apelido) quando
-- AMBOS são não-nulos. Adiciona um parcial p/ barrar duplicar a mesma cor SEM apelido no mesmo
-- tecido (o front já barra via jaExiste; isto é a garantia no banco). Seguro: não havia variantes
-- com apelido nulo até agora (apelido era obrigatório).
CREATE UNIQUE INDEX IF NOT EXISTS uq_variantes_tecido_artigo_cor_sem_apelido
  ON public.variantes_tecido (artigo_id, cor_id)
  WHERE cor_id IS NOT NULL AND cor_apelido_id IS NULL;
