#!/usr/bin/env bash
# T0 Modularidade (P-257 A). Cria/atualiza (idempotente) a loja 'QA Modularidade (local)' com usuarios, cadastro minimo, OTB e 3 cards.
# Guarda dura: NAO le DATABASE_URL/PG*; fala SO com a copia local 127.0.0.1:54422 (URL fixa abaixo). O .sql repete a guarda
# (system_identifier da copia + sem supautils). Nunca aponte para producao.
set -euo pipefail
unset DATABASE_URL PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSERVICEFILE PGPASSFILE PGOPTIONS PGSSLMODE PGSYSCONFDIR
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
if [ "$#" -ne 0 ]; then echo "uso: $(basename "$0")  (sem argumentos)" >&2; exit 2; fi
exec psql -X -v ON_ERROR_STOP=1 "$URL" -f "$DIR/loja-qa.sql"
