/**
 * Frente Backend (plano .superpowers/sdd/2026-10-05-backend/plan.md §2 B1 e §13) — os blocos de migration da frente, aplicados
 * DENTRO da transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado pelos testes bk-*.test.ts, pelo
 * gancho `BK_TXN=1` de `db.ts` e pela cadeia da Modularidade (`voltaMod`/`voltaModSePreciso` chamam `voltaBkSePreciso` PRIMEIRO:
 * LIFO — o Backend roda DEPOIS da Modularidade 131000 no kit; a T5 200000, que roda depois do Backend no kit, não toca nenhuma
 * função desta frente, GC 17).
 *
 * Registro por `existsSync`: cada bloco só entra se o 1º arquivo de migration existir — as tarefas B2..B5/F2 NÃO editam este arquivo.
 * Contrato do `tests/integration/bk-N-dados.ts` GERADO por cada `gerar-bkN.mjs` (B1, B2, F2.3, B3, B5):
 *   export const BK_MD5: Record<"public.f(args)", { antes: string; depois: string }>;  // funções redefinidas
 *   export const BK_SENTINELA: string;                                                // uma chave de BK_MD5 (bloco vivo?)
 * B4 (índice) e F2.1 (RPC nova) são objetos novos escritos à mão: o `_down` deles é no-op documentado (só o `_down_drop` remove),
 * então `voltaBk*` NÃO os desfaz dentro da txn (`downs: []`); "vivo" = `vivaSql`. A F2.1 PODE trazer um `bk-f21-dados.ts` com o
 * mesmo contrato (BK_MD5 com `antes: ""` e o md5 da IDA em `depois`): se existir, "vivo" = md5 da sentinela = IDA; senão, a função
 * existe. Sentinelas NUNCA são funções que a Camada (160000..199999) possa redefinir (GC 18).
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// Camada intermediária (camada-helpers): roda DEPOIS desta frente no kit (C1 160000/161000, antes da T5). Import dinâmico tolerante
// a ausência: `voltaBk*` tira a Camada PRIMEIRO (LIFO) e `md5BkSucessor` continua a cadeia nos "depois" da Camada.
type Camada = {
  voltaCamadaSePreciso: (c: Client) => Promise<void>;
  md5CamadaSucessor: (sig: string, pinado?: string) => string[];
};
const CAMADA: Camada | null = existsSync(`${ROOT}tests/integration/camada-helpers.ts`)
  ? ((await import(/* @vite-ignore */ "./camada-helpers.ts")) as Camada)
  : null;

type Dados = { BK_MD5: Record<string, { antes: string; depois: string }>; BK_SENTINELA: string };
export type BlocoBk = {
  id: "B1" | "B2" | "B4" | "F21" | "F23" | "B3" | "B5";
  idas: string[];
  /** inversos NEUTROS na ordem em que rodam (vazio = nada a desfazer dentro da txn: o objeto novo fica inerte). */
  downs: string[];
  /** arquivo de dados gerado (md5). */
  dados?: string;
  /** como saber se o bloco está vivo sem dados (B4, F2.1 sem dados). */
  vivaSql?: string;
};

const MIG = (id: string) => `supabase/migrations/${id}.sql`;
const DOWN = (id: string) => `supabase/rollback/${id}_down.sql`;

/** Os 7 blocos previstos NA ORDEM de aplicação (plano §1/§13.1; ordem do kit: 140000 → 141000 → 143000 → 145000 → 146000 → 147000 → 148000). */
const TODOS: BlocoBk[] = [
  {
    id: "B1",
    idas: [MIG("20261103140000_bk_lancado_protegido")],
    downs: [DOWN("20261103140000_bk_lancado_protegido")],
    dados: "bk-1-dados",
  },
  {
    id: "B2",
    idas: [MIG("20261103141000_bk_rev_uma_vez_raizes")],
    downs: [DOWN("20261103141000_bk_rev_uma_vez_raizes")],
    dados: "bk-2-dados",
  },
  {
    id: "B4",
    idas: [MIG("20261103143000_bk_integracao_produto_unico")],
    downs: [],
    vivaSql: `SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.integracao_linhas_produto_unico')
                AND indisunique AND indisvalid) AS v`,
  },
  {
    id: "F21",
    idas: [MIG("20261103145000_bk_opcoes_colecao")],
    downs: [],
    dados: "bk-f21-dados",
    vivaSql: `SELECT to_regprocedure('public.opcoes_colecao_modelos()') IS NOT NULL AS v`,
  },
  {
    id: "F23",
    idas: [MIG("20261103146000_bk_rotulo_inlinavel")],
    downs: [DOWN("20261103146000_bk_rotulo_inlinavel")],
    dados: "bk-23-dados",
  },
  {
    id: "B3",
    idas: [MIG("20261103147000_bk_p0002_ascii")],
    downs: [DOWN("20261103147000_bk_p0002_ascii")],
    dados: "bk-3-dados",
  },
  {
    id: "B5",
    idas: [MIG("20261103148000_bk_otb_pagina")],
    downs: [DOWN("20261103148000_bk_otb_pagina")],
    dados: "bk-5-dados",
  },
];

/** Blocos cujo 1º arquivo de migration existe no repositório (na ordem de aplicação). */
export const BK_MIGS: BlocoBk[] = TODOS.filter((b) => existsSync(ROOT + b.idas[0]));

// Dados gerados de cada bloco (import dinâmico tolerante a ausência; carregados uma vez).
const DADOS: Partial<Record<BlocoBk["id"], Dados>> = {};
for (const b of BK_MIGS) {
  if (b.dados && existsSync(`${ROOT}tests/integration/${b.dados}.ts`)) {
    DADOS[b.id] = (await import(/* @vite-ignore */ `./${b.dados}.ts`)) as Dados;
  }
}

async function zeraTimeouts(c: Client): Promise<void> {
  // As migrations fazem SET LOCAL transaction_timeout (vale para a txn INTEIRA do teste) — devolve ao normal do teste.
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

const bloco = (id: BlocoBk["id"]): BlocoBk | undefined => BK_MIGS.find((b) => b.id === id);

/** O bloco está vivo NESTA txn? Pelo md5 da sentinela (= "depois") ou pelo `vivaSql`. Bloco sem arquivo = false. */
export async function bkViva(c: Client, id: BlocoBk["id"]): Promise<boolean> {
  const b = bloco(id);
  if (!b) return false;
  const d = DADOS[id];
  if (d) {
    const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      d.BK_SENTINELA,
    ]);
    return r.rows[0]?.m === d.BK_MD5[d.BK_SENTINELA]?.depois;
  }
  if (b.vivaSql) return !!(await c.query(b.vivaSql)).rows[0]?.v;
  // migration presente, dados gerados ausentes e sem vivaSql: "vivo" seria false para sempre e voltaBk nunca desfaria o bloco
  // (os _down antigos recusariam por md5 sem pista). Falha alto (B1 review M2).
  if (b.dados)
    throw new Error(
      `bk-helpers: ${b.id} sem tests/integration/${b.dados}.ts — rode o gerador do bloco`,
    );
  return false;
}

/** Aplica os blocos que existem e ainda não estão vivos, NA ORDEM (idempotente); `ate` = último bloco a aplicar. */
export async function aplicaBk(c: Client, ate?: BlocoBk["id"]): Promise<void> {
  exigeBancoLocal();
  for (const b of BK_MIGS) {
    if (!(await bkViva(c, b.id))) for (const m of b.idas) await aplicarArquivo(c, m);
    if (b.id === ate) break;
  }
  await zeraTimeouts(c);
}

/** Volta TODOS os blocos vivos, LIFO, pelos `_down` neutros (B4/F2.1 ficam: o `_down` deles é no-op). */
export async function voltaBk(c: Client): Promise<void> {
  exigeBancoLocal();
  if (CAMADA) await CAMADA.voltaCamadaSePreciso(c); // LIFO: a Camada (por cima desta frente) sai antes
  for (const b of [...BK_MIGS].reverse()) {
    if (!b.downs.length || !(await bkViva(c, b.id))) continue;
    for (const d of b.downs) await aplicarArquivo(c, d);
  }
  await zeraTimeouts(c);
}

/** LIFO: quem volta (ou reaplica) a Modularidade ou qualquer release anterior dentro da txn tira esta frente antes. */
export async function voltaBkSePreciso(c: Client): Promise<void> {
  if (CAMADA) await CAMADA.voltaCamadaSePreciso(c); // LIFO: a Camada sai antes, mesmo que nenhum bloco desta frente esteja vivo
  let viva = false;
  for (const b of BK_MIGS) if (b.downs.length && (await bkViva(c, b.id))) viva = true;
  if (!viva) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0]
    .v as string;
  await voltaBk(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/**
 * md5 pinado por suíte antiga: devolve o pinado + os "depois" desta frente que o sucedem (cadeia pelos blocos, na ordem: um bloco
 * só entra se o "antes" dele já está na lista). Sem `pinado`: todos os "depois" da função nos blocos existentes.
 * `md5ModSucessor` (mod-helpers) acrescenta isto ao fim da cadeia dela (Mod → Backend).
 */
export function md5BkSucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  for (const b of BK_MIGS) {
    const s = DADOS[b.id]?.BK_MD5[k];
    if (!s) continue;
    if (!pinado || out.includes(s.antes)) out.push(s.depois);
  }
  // cadeia Backend → Camada: o "depois" da Camada que sucede o último texto desta cadeia
  if (CAMADA) {
    const ultimo = out.length ? out[out.length - 1] : undefined;
    for (const m of CAMADA.md5CamadaSucessor(k, ultimo)) if (!out.includes(m)) out.push(m);
  }
  return out;
}
