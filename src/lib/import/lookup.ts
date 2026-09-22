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
  // GRADE de tamanhos (não é tabela): lê tenant_config.tamanhos_grade e casa TOLERANTE — o
  // número ("34") E a letra ("PPP") apontam p/ a chave completa ("34|PPP"). O "id" é a própria chave.
  if (spec.gradeTamanhos) {
    const { data } = await sb.from("tenant_config").select("tamanhos_grade").maybeSingle();
    const arr = ((data as { tamanhos_grade?: string[] } | null)?.tamanhos_grade ?? []) as string[];
    const grade = arr.length ? arr : ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
    const m = new Map<string, string>();
    for (const chave of grade) {
      m.set(normalizeCat(chave), chave); // "34|ppp" → "34|PPP" (a chave completa também casa)
      const [num, sigla] = chave.split("|");
      if (num) m.set(normalizeCat(num), chave);      // "34" → "34|PPP"
      if (sigla) m.set(normalizeCat(sigla), chave);  // "ppp" → "34|PPP"
    }
    return m;
  }

  // VARIANTE DE TECIDO: não tem nome — a chave é `${artigo_id}::${cor_id}::${apelido||""}`, que
  // o MODELO usa p/ resolver o BOM de tecidos por artigo+cor+apelido → variante_tecido_id.
  if (spec.varianteTecido) {
    const { data, error } = await sb.from("variantes_tecido").select("id, artigo_id, cor_id, cor_apelido_id");
    if (error) throw new Error(`Falha ao carregar variantes_tecido: ${error.message}`);
    const m = new Map<string, string>();
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const chave = `${r.artigo_id ?? ""}::${r.cor_id ?? ""}::${r.cor_apelido_id ?? ""}`;
      m.set(chave, r.id as string);
    }
    return m;
  }

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

// Opção de dropdown (id + nome exibível). Para apelidos, `corBaseId` permite filtrar pela cor base.
export type OpcaoLookup = { id: string; nome: string; corBaseId?: string };
export type OpcoesLookup = Record<string, OpcaoLookup[]>;

/** Carrega as LISTAS (id+nome) de cada lookup, p/ preencher os dropdowns da tabela editável. */
export async function carregarOpcoes(sb: SupabaseClient, specs: LookupSpec[]): Promise<OpcoesLookup> {
  const entradas = await Promise.all(
    specs.map(async (s) => {
      if (s.gradeTamanhos) {
        const { data } = await sb.from("tenant_config").select("tamanhos_grade").maybeSingle();
        const arr = ((data as { tamanhos_grade?: string[] } | null)?.tamanhos_grade ?? []) as string[];
        const grade = arr.length ? arr : ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
        return [s.id, grade.map((k) => ({ id: k, nome: k.replace("|", " · ") }))] as const;
      }
      // variante de tecido não é dropdown na tabela de análise (resolvida por artigo+cor no BOM).
      if (s.varianteTecido) return [s.id, []] as const;
      const nameCol = s.nameCol ?? "nome";
      const cols = ["id", nameCol, ...(s.extraCols ?? [])].join(", ");
      const { data, error } = await sb.from(s.table).select(cols).order(nameCol);
      if (error) return [s.id, []] as const;
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      const opts: OpcaoLookup[] = rows.map((r) => ({
        id: r["id"] as string,
        nome: String(r[nameCol] ?? ""),
        corBaseId: s.apelidoDeCorBase ? (r["cor_base_id"] as string | undefined) : undefined,
      }));
      return [s.id, opts] as const;
    }),
  );
  return Object.fromEntries(entradas);
}
