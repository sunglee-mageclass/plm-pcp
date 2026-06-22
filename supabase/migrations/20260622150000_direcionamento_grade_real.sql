-- Item 12 (Fase 2): Direcionamento guarda só ecommerce/loja_fisica, não o `real`
-- (grades_reais do CAD) usado no cálculo loja_fisica = max(0, real - ecommerce).
-- Se a grade real mudar depois (CQ reconfirmado), o loja_fisica salvo fica
-- defasado e não há como detectar. Persistimos o `real` usado, tornando o
-- registro autocontido e permitindo detectar divergência no front.

ALTER TABLE public.direcionamento
  ADD COLUMN IF NOT EXISTS real jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS grade_real_total integer DEFAULT 0;
