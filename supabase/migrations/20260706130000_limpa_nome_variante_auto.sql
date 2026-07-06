-- nome_variante virou um NOME COMERCIAL opcional (ex.: "Malha") — o rótulo da variante
-- em toda tela é montado por nome + cor + apelido (helper src/lib/variante.ts). Portanto
-- zera os nome_variante que eram só o auto-placeholder "{artigo} - ..." (ex.:
-- "Linho - Amarelo", "Entretela Fina - Branco", "31321 - Amarelo"), preservando os nomes
-- comerciais reais ("Malha", "Botânica", "Caffè Latte", "Duna"…) que NÃO começam com o
-- nome do artigo + " - ".
update public.variantes_tecido v
set nome_variante = null
from public.artigos a
where a.id = v.artigo_id
  and v.nome_variante is not null
  and v.nome_variante like (a.nome || ' - %');
