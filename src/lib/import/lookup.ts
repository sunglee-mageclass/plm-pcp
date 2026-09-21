// Carrega as tabelas de apoio (lookup) e monta Map<nomeNorm, id>.
//
// Todas são tenant-scoped por RLS — o SELECT já vem filtrado pela loja do usuário.
// `normalizeCat` (sem acento/minúsculo/trim) casa "Azul"/"azul "/"AZUL".
// Casos especiais:
//  - cores_apelido: chave composta `${cor_base_id}::${nomeNorm}` (o apelido pertence a uma cor base).
//  - empresas (fornecedor): SEM unique(tenant,nome) → Map<nomeNorm, id[]> (homônimo = aviso).

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCat } from "@/lib/fornecedor-categoria";
import type { LookupSpec, LookupMaps } from "./types";

/** Carrega UM lookup e devolve o Map (simples ou de arrays quando semUnique). */
async function carregarUm(
  sb: SupabaseClient,
  spec: LookupSpec,
): Promise<Map<string, string> | Map<string, string[]>> {
  const nameCol = spec.nameCol ?? "nome";
  const cols = ["id", nameCol, ...(spec.extraCols ?? [])].join(", ");
  const { data, error } = await sb.from(spec.table).select(cols);
  if (error) throw new Error(`Falha ao carregar ${spec.table}: ${error.message}`);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  if (spec.apelidoDeCorBase) {
    const m = new Map<string, string>();
    for (const r of rows) {
      const base = r["cor_base_id"] as string | null;
      const nome = normalizeCat(r[nameCol] as string);
      if (base && nome) m.set(`${base}::${nome}`, r["id"] as string);
    }
    return m;
  }

  if (spec.semUnique) {
    const m = new Map<string, string[]>();
    for (const r of rows) {
      const nome = normalizeCat(r[nameCol] as string);
      if (!nome) continue;
      const arr = m.get(nome) ?? [];
      arr.push(r["id"] as string);
      m.set(nome, arr);
    }
    return m;
  }

  const m = new Map<string, string>();
  for (const r of rows) {
    const nome = normalizeCat(r[nameCol] as string);
    if (nome) m.set(nome, r["id"] as string);
  }
  return m;
}

/** Carrega todos os lookups de um descritor em paralelo → LookupMaps (por spec.id). */
export async function carregarLookups(
  sb: SupabaseClient,
  specs: LookupSpec[],
): Promise<LookupMaps> {
  const entradas = await Promise.all(
    specs.map(async (s) => [s.id, await carregarUm(sb, s)] as const),
  );
  return Object.fromEntries(entradas);
}
