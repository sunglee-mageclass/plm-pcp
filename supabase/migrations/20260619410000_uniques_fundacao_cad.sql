-- P0-7: UNIQUEs de fundação.
-- Todo o fluxo de produção (gates JS sobre embeds cad(...), RPCs com LIMIT 1,
-- leituras cad[0]) assume as invariantes "1 CAD por modelo" e "1 registro por
-- cad_id" em cad_grades/controle_qualidade/producao_oficina/lancamentos. O banco
-- não garantia isso: uma corrida (dois editores, double-click) poderia inserir
-- duplicata e quebrar gate/#Erro silenciosamente, escolhendo o registro errado.
-- enviar_modelo_para_cad já recusa um 2o CAD na lógica; isto blinda no banco.
--
-- Verificado antes de aplicar: 0 duplicatas e 0 nulos em cad_id nas 5 tabelas.
-- cad_grades já é a chave (cad_id, variante_numero).

ALTER TABLE public.cad
  ADD CONSTRAINT cad_modelo_id_key UNIQUE (modelo_id);

ALTER TABLE public.cad_grades
  ADD CONSTRAINT cad_grades_cad_variante_key UNIQUE (cad_id, variante_numero);

ALTER TABLE public.controle_qualidade
  ADD CONSTRAINT controle_qualidade_cad_key UNIQUE (cad_id);

ALTER TABLE public.producao_oficina
  ADD CONSTRAINT producao_oficina_cad_key UNIQUE (cad_id);

ALTER TABLE public.lancamentos
  ADD CONSTRAINT lancamentos_cad_key UNIQUE (cad_id);
