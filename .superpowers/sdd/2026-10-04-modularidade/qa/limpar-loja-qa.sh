#!/usr/bin/env bash
# T0 Modularidade (P-257 A). APAGA tudo o que loja-qa.sh criou (loja, usuarios, dados). --dry-run = ensaio com ROLLBACK.
# Guarda dura: NAO le DATABASE_URL/PG*; fala SO com a copia local 127.0.0.1:54422 (URL fixa abaixo). O .sql repete a guarda
# (system_identifier da copia + sem supautils). Nunca aponte para producao.
set -euo pipefail
unset DATABASE_URL PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSERVICEFILE PGPASSFILE PGOPTIONS PGSSLMODE PGSYSCONFDIR
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
# Sem argumento = apaga de verdade (COMMIT). Unico argumento aceito: --dry-run (faz tudo e termina em ROLLBACK).
DRY=0
if [ "$#" -eq 1 ] && [ "$1" = "--dry-run" ]; then DRY=1
elif [ "$#" -ne 0 ]; then echo "uso: $(basename "$0") [--dry-run]" >&2; exit 2; fi
exec psql -X -v ON_ERROR_STOP=1 -v "dry=$DRY" "$URL" -f "$DIR/limpar-loja-qa.sql"
