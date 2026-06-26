-- Mais dados da EMPRESA no cadastro de Representante, auto-preenchidos pelo CNPJ
-- (BrasilAPI/Receita). Pedido do dono: situação cadastral, telefone+e-mail da empresa
-- (separados do "Contato" do representante) e endereço estruturado (CEP/município/UF).
-- `logradouro` (já existente) passa a guardar só a rua/número/bairro.

ALTER TABLE public.representantes
  ADD COLUMN IF NOT EXISTS situacao_cadastral text,
  ADD COLUMN IF NOT EXISTS telefone          text,
  ADD COLUMN IF NOT EXISTS email             text,
  ADD COLUMN IF NOT EXISTS cep               text,
  ADD COLUMN IF NOT EXISTS municipio         text,
  ADD COLUMN IF NOT EXISTS uf                text;
