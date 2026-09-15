-- Foto do card de Produto Acabado/Importado = FOTO DO MODELO (fotos_modelo do espelho).
--
-- Bug (meu): a foto anexada no card era gravada só em produtos_(acabados|importados).foto_url
-- (path no bucket "oc-tecido", por eu ter reusado o uploadFile daquele módulo) e NUNCA propagada
-- p/ modelos.fotos_modelo — que é o que o Planejamento lê (bucket "modelos"). Resultado: a foto não
-- aparecia no Planejamento e o dono tinha de re-anexar.
--
-- Correção (2 partes coordenadas — esta migração + o front):
--   • FRONT (fora daqui): o card passa a SUBIR a foto no bucket "modelos" (uploadFile de
--     planejamento/modelo-shared, prefix fotos_modelo). Assim o path em foto_url já é válido lá.
--   • BANCO (aqui): um TRIGGER em produtos_acabados/produtos_importados propaga foto_url →
--     modelos.fotos_modelo do espelho como CAPA (posição 0), PRESERVANDO as demais fotos que o dono
--     tenha adicionado no Planejamento. Escolhi trigger (e não editar as 4 RPCs de save/criar-card
--     byte-a-byte) por ser MENOS arriscado — cobre save, criar-card e qualquer writer futuro, sem
--     tocar o corpo vivo das RPCs. foto_url NULL/'' NÃO mexe em fotos_modelo (não apaga a do modelo).
--
-- Regra da capa (não-destrutiva): fotos_modelo := [foto_url] || (resto atual sem a capa, dedup).
-- Só reescreve se o resultado DIFERE do atual (evita bump/escrita à toa e recursão).

BEGIN;

-- Helper puro: monta fotos_modelo com a capa (foto do produto) na posição 0, preservando o resto.
CREATE OR REPLACE FUNCTION public._foto_modelo_com_capa(_atual text[], _capa text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  select case
    when coalesce(_capa, '') = '' then coalesce(_atual, '{}')  -- sem capa → não mexe
    else array[_capa] || coalesce(
      array(select x from unnest(coalesce(_atual, '{}')) x where x is distinct from _capa),
      '{}'
    )
  end;
$$;

-- Trigger genérico (serve p/ acabado e importado): ao mudar foto_url OU modelo_id, propaga a foto
-- p/ o modelo espelho como capa. SECURITY DEFINER — o dono do trigger (postgres) escreve modelos;
-- a autorização já foi feita na RPC que disparou o INSERT/UPDATE do produto.
CREATE OR REPLACE FUNCTION public._sync_foto_modelo_do_produto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_atual text[];
  v_novo  text[];
begin
  -- Sem espelho ou sem foto: nada a fazer (foto NULL não apaga a do modelo).
  if NEW.modelo_id is null or coalesce(NEW.foto_url, '') = '' then
    return NEW;
  end if;
  select fotos_modelo into v_atual from public.modelos where id = NEW.modelo_id;
  v_novo := public._foto_modelo_com_capa(v_atual, NEW.foto_url);
  -- Só escreve se mudou (evita UPDATE/bump à toa).
  if v_novo is distinct from coalesce(v_atual, '{}') then
    update public.modelos set fotos_modelo = v_novo where id = NEW.modelo_id;
  end if;
  return NEW;
end;
$$;

REVOKE EXECUTE ON FUNCTION public._sync_foto_modelo_do_produto() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._foto_modelo_com_capa(text[], text) FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_foto_modelo_acabado ON public.produtos_acabados;
CREATE TRIGGER trg_sync_foto_modelo_acabado
  AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public._sync_foto_modelo_do_produto();

DROP TRIGGER IF EXISTS trg_sync_foto_modelo_importado ON public.produtos_importados;
CREATE TRIGGER trg_sync_foto_modelo_importado
  AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_importados
  FOR EACH ROW EXECUTE FUNCTION public._sync_foto_modelo_do_produto();

COMMIT;
