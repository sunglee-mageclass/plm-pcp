#!/usr/bin/env bash
# T0 Modularidade (P-257 A). Troca os modulos da loja de QA para uma combinacao nomeada (salvar_loja como o super admin teste@teste.com).
# Guarda dura: NAO le DATABASE_URL/PG*; fala SO com a copia local 127.0.0.1:54422 (URL fixa abaixo). O .sql repete a guarda
# (system_identifier da copia + sem supautils). Nunca aponte para producao.
set -euo pipefail
unset DATABASE_URL PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSERVICEFILE PGPASSFILE PGOPTIONS PGSSLMODE PGSYSCONFDIR
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
if [ "$#" -ne 1 ]; then echo "uso: $(basename "$0") <combo>   (so-estoque | estoque-fin | cria-sem-producao | cria-sem-es | sem-otb | sem-dashboard | pa-sem-producao | completo | modulos:chave1,chave2,...)" >&2; exit 2; fi
case "$1" in *[!a-z0-9:,_-]*|"") echo "combo invalido: $1" >&2; exit 2;; esac
exec psql -X -v ON_ERROR_STOP=1 -v "combo=$1" "$URL" -f "$DIR/combo.sql"
