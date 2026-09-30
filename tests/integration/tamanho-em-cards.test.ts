/**
 * "Tamanho em" nos cards do Plan. Tecido, Produto Acabado e Importado (D2 do SKU, P-85 A; P-118 A, P-119 A) — Tarefas 1+2
 * do plano .superpowers/sdd/2026-09-29-tamanho-em/plan.md (com os rulings do G-plano). Migration
 * supabase/migrations/20261014100000_tamanho_em_cards.sql e inverso em supabase/rollback/ — GERADOS a partir do texto VIVO
 * da cópia por .superpowers/sdd/2026-09-29-tamanho-em/mig/gerar_sql.py (não editar à mão). Integração em BEGIN…ROLLBACK:
 * NADA é gravado.
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Fora dela os blocos de banco
 * PULAM; com TAMANHO_MIG_TXN=1 fora da cópia a suíte RECUSA já na coleta. NUNCA `\i` (o COMMIT do arquivo vazaria — 15/set).
 *  • TAMANHO_MIG_TXN=1 — cada teste aplica o arquivo DENTRO da txn (mig-txn.ts tira BEGIN/COMMIT; as 2 travas SET LOCAL
 *    saem antes — o transaction_timeout de 3 s derrubaria a txn do teste). Segura ACCESS EXCLUSIVE em plan_tecido_slots
 *    durante o teste (janela N3 — avisada no painel pelo controlador). O bloco "migration em txn" (diff, ACL, idempotência,
 *    inverso, guardas e o RED do repasse) só roda neste modo; se a cópia JÁ tiver a migration, ele volta ao "antes" pelo
 *    próprio inverso dentro da txn.
 *  • sem a variável — a migration JÁ aplicada na cópia (QA da Tarefa 8); sem ela os blocos de banco pulam.
 * O bloco "estático" (só os arquivos) roda sempre.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, dbUrl, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";
import { voltaPrecoVersaoSePreciso } from "./integracao-helpers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261014100000_tamanho_em_cards.sql";
const INV = "supabase/rollback/20261014100000_tamanho_em_cards_down.sql";
const TROCAS_JSON = ".superpowers/sdd/2026-09-29-tamanho-em/mig/trocas.json"; // NÃO versionado (confere se existir)
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.TAMANHO_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão
const T = TENANT_TESTE;
const MSG_INVALIDO = "tamanho_tipo invalido: use letra ou numero";

/** As 12 funções, na ORDEM das guardas do arquivo (a árvore — LANGUAGE sql — por último, depois da coluna). */
const FUNCS = [
  { arq: "fn_produto_tamanho_tipo_handover", sig: "fn_produto_tamanho_tipo_handover()", antes: "16f03fe8cce7f92a8bbe77ad0d2c7e5a", depois: "2712720482d94963ffda1b807fdf6931" },
  { arq: "_replicar_produtos_acabados_core", sig: "_replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])", antes: "bb39e1ce5681e944160e59b71a28d206", depois: "5aa4cf782687fe1dec96d18ef4d2923d" },
  { arq: "_replicar_produtos_importados_core", sig: "_replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])", antes: "150dbbca4cba9e4523427552bcd7e5c3", depois: "dc37b0adf427d1b2f6bca71a8d755ae0" },
  { arq: "_salvar_produto_acabado_core", sig: "_salvar_produto_acabado_core(uuid,jsonb,jsonb)", antes: "fd05edfc91464798639d761110607d30", depois: "20f8e442b95f8bb02bc8201b431c21b1" },
  { arq: "_salvar_produto_importado_core", sig: "_salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)", antes: "d29c80190739b780523a3a4d4a175f08", depois: "2f3a81d18248752c56a7bd386c8bfe69" },
  { arq: "_limpar_produto_acabado_core", sig: "_limpar_produto_acabado_core(uuid)", antes: "5e93aa82de5cf6f24faa25ba2d7891af", depois: "123ddc5a717d896bc38193806769ccae" },
  { arq: "_limpar_produto_importado_core", sig: "_limpar_produto_importado_core(uuid)", antes: "b1b89e0d2020d0de4c32b1448872ab08", depois: "5fe6e90f2a96881614f45f84f9865bdd" },
  { arq: "_salvar_plan_tecido_core", sig: "_salvar_plan_tecido_core(uuid,jsonb,integer)", antes: "58fcaddadee3c7ab8cac44c0597c9368", depois: "81a3606444a2cf68ee376937009b9bad" },
  { arq: "_plan_tecido_criar_card_core", sig: "_plan_tecido_criar_card_core(uuid,uuid,jsonb)", antes: "3a398cfecbfd8c434e998fc781a71f0b", depois: "fceac02c52bd0b29a33856dc9e0f9b11" },
  { arq: "_plan_tecido_snapshot", sig: "_plan_tecido_snapshot(uuid)", antes: "75d43c800b38b08c77831a645dcb4b3d", depois: "2c2ba1e79ab311b2c5ba8080cac958e9" },
  { arq: "_replicar_cards_plan_tecido_core", sig: "_replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)", antes: "cd89885741a32a63cbfa899d31ac0661", depois: "aaf3f2e4e4bd8eb14b99d53c79a653da" },
  { arq: "_plan_tecido_arvore_core", sig: "_plan_tecido_arvore_core(uuid)", antes: "137774116f4ec7fad102b6754a6decf3", depois: "5111f417c2679a4bb2157ad0df61f55a" },
] as const;

// Trocas EXATAS (âncora 1× no texto de antes → texto novo) — TRANSCRITAS aqui, independentes do gerador (molde TROCAS_DIST de
// distribuicao-produto.test.ts: o trocas.json do gerador não é versionado; quando existe, a suíte confere que bate).
const TROCAS: Record<string, [string, string][]> = {
  fn_produto_tamanho_tipo_handover: [
    ["       AND m.tamanho_tipo IS NULL;\n",
     "       -- [tamanho-em v1] o produto manda (P-85 A): troca o do modelo espelho sempre que DIFERE (antes: só se o modelo\n       -- não tinha, e o default 'letra' do modelo fazia o valor do produto se perder). Modelo integravel/integrado\n       -- recusa com 42501 via trg_zz_integracao_trava (invariante #14) — o Salvar do produto aborta inteiro.\n       AND m.tamanho_tipo IS DISTINCT FROM NEW.tamanho_tipo;\n"],
  ],
  _replicar_produtos_acabados_core: [
    ["      colecao_id, subcolecao, semana, ref, linha_id, modelo_base_id, versao\n    )\n    select _tenant, o.nome, 'revenda', o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,\n           _destino_colecao_id, v_sub_nome, o.semana, pa.ref, null, v_root, v_versao\n",
     "      colecao_id, subcolecao, semana, ref, linha_id, modelo_base_id, versao, tamanho_tipo\n    )\n    select _tenant, o.nome, 'revenda', o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,\n           _destino_colecao_id, v_sub_nome, o.semana, pa.ref, null, v_root, v_versao,\n           coalesce(om.tamanho_tipo, 'letra')  -- [tamanho-em v1] a réplica leva o \"Tamanho em\" do card de origem\n"],
  ],
  _replicar_produtos_importados_core: [
    ["      colecao_id, subcolecao, semana, ref, linha_id, modelo_base_id, versao\n    )\n    select _tenant, o.nome, 'importado', o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,\n           _destino_colecao_id, v_sub_nome, o.semana, pi.ref, null, v_root, v_versao\n",
     "      colecao_id, subcolecao, semana, ref, linha_id, modelo_base_id, versao, tamanho_tipo\n    )\n    select _tenant, o.nome, 'importado', o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,\n           _destino_colecao_id, v_sub_nome, o.semana, pi.ref, null, v_root, v_versao,\n           coalesce(om.tamanho_tipo, 'letra')  -- [tamanho-em v1] a réplica leva o \"Tamanho em\" do card de origem\n"],
  ],
  _salvar_produto_acabado_core: [
    ["  v_tem_oc boolean;\n",
     "  v_tem_oc boolean;\n  v_tt text;  -- [tamanho-em v1]\n"],
    ["    raise exception 'O markup precisa ser maior que zero.' using errcode = 'P0001';\n  end if;\n",
     "    raise exception 'O markup precisa ser maior que zero.' using errcode = 'P0001';\n  end if;\n\n  -- [tamanho-em v1] \"Tamanho em\" (P-85 A): só quando a chave vem no _dados (a tela manda só se mudou). Com card, o\n  -- gatilho do produto (fn_produto_tamanho_tipo_handover) leva o valor ao modelo espelho e limpa o do produto.\n  if _dados ? 'tamanho_tipo' then\n    v_tt := nullif(_dados->>'tamanho_tipo', '');\n    if v_tt is null or v_tt not in ('letra', 'numero') then\n      raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';\n    end if;\n  end if;\n"],
    ["      markup_atacado, markup_varejo, foto_url\n    ) values (\n",
     "      markup_atacado, markup_varejo, foto_url, tamanho_tipo\n    ) values (\n"],
    ["      v_markup_atacado, v_markup_varejo, nullif(_dados->>'foto_url', '')\n    ) returning id into v_id;\n",
     "      v_markup_atacado, v_markup_varejo, nullif(_dados->>'foto_url', ''), v_tt  -- [tamanho-em v1]\n    ) returning id into v_id;\n"],
    ["      foto_url = nullif(_dados->>'foto_url', ''),\n      updated_at = now()\n",
     "      foto_url = nullif(_dados->>'foto_url', ''),\n      tamanho_tipo = case when _dados ? 'tamanho_tipo' then v_tt else tamanho_tipo end,  -- [tamanho-em v1]\n      updated_at = now()\n"],
  ],
  _salvar_produto_importado_core: [
    ["  v_ord int;\n",
     "  v_ord int;\n  v_tt text;  -- [tamanho-em v1]\n"],
    ["    raise exception 'A soma das etapas de frete (%) precisa fechar 100%%.', round(v_soma_frete,2) using errcode = 'P0001';\n  end if;\n",
     "    raise exception 'A soma das etapas de frete (%) precisa fechar 100%%.', round(v_soma_frete,2) using errcode = 'P0001';\n  end if;\n\n  -- [tamanho-em v1] \"Tamanho em\" (P-85 A): só quando a chave vem no _dados (a tela manda só se mudou). Com card, o\n  -- gatilho do produto (fn_produto_tamanho_tipo_handover) leva o valor ao modelo espelho e limpa o do produto.\n  if _dados ? 'tamanho_tipo' then\n    v_tt := nullif(_dados->>'tamanho_tipo', '');\n    if v_tt is null or v_tt not in ('letra', 'numero') then\n      raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';\n    end if;\n  end if;\n"],
    ["      desconto_pct, cotacao_final, markup_atacado, markup_varejo\n    ) values (\n",
     "      desconto_pct, cotacao_final, markup_atacado, markup_varejo, tamanho_tipo\n    ) values (\n"],
    ["      nullif(_dados->>'markup_atacado','')::numeric, nullif(_dados->>'markup_varejo','')::numeric\n    ) returning id into v_id;\n",
     "      nullif(_dados->>'markup_atacado','')::numeric, nullif(_dados->>'markup_varejo','')::numeric,\n      v_tt  -- [tamanho-em v1]\n    ) returning id into v_id;\n"],
    ["      markup_varejo = nullif(_dados->>'markup_varejo','')::numeric,\n      updated_at = now()\n",
     "      markup_varejo = nullif(_dados->>'markup_varejo','')::numeric,\n      tamanho_tipo = case when _dados ? 'tamanho_tipo' then v_tt else tamanho_tipo end,  -- [tamanho-em v1]\n      updated_at = now()\n"],
  ],
  _limpar_produto_acabado_core: [
    ["    insumos_total = 0, markup_atacado = null, markup_varejo = null,\n    updated_at = now()\n",
     "    insumos_total = 0, markup_atacado = null, markup_varejo = null,\n    tamanho_tipo = null,  -- [tamanho-em v1]\n    updated_at = now()\n"],
  ],
  _limpar_produto_importado_core: [
    ["    desconto_pct = 0, cotacao_final = 0, markup_atacado = null, markup_varejo = null,\n    updated_at = now()\n",
     "    desconto_pct = 0, cotacao_final = 0, markup_atacado = null, markup_varejo = null,\n    tamanho_tipo = null,  -- [tamanho-em v1]\n    updated_at = now()\n"],
  ],
  _salvar_plan_tecido_core: [
    ["  v_slot_oc jsonb;\n",
     "  v_slot_oc jsonb;\n  v_tt text;  -- [tamanho-em v1]\n"],
    ["      for v_slot in select * from jsonb_array_elements(coalesce(v_ln->'slots','[]'::jsonb)) loop\n",
     "      for v_slot in select * from jsonb_array_elements(coalesce(v_ln->'slots','[]'::jsonb)) loop\n        -- [tamanho-em v1] \"Tamanho em\" (P-119 A): a vaga SEM card guarda a escolha; com card ele mora no modelo.\n        -- Valida SÓ onde o valor é gravado (vaga sem card; o \"tocado\" valida abaixo): na vaga COM card sem a marca o\n        -- valor é descartado — um legado fora do domínio no modelo (CHECK NOT VALID) não pode travar o Salvar inteiro.\n        v_tt := nullif(v_slot->>'tamanho_tipo', '');\n        if v_tt is not null and v_tt not in ('letra', 'numero') and nullif(v_slot->>'modelo_id','') is null then\n          raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';\n        end if;\n"],
    ["          categoria_tecido_id, mix_id, referencia_paths)\n",
     "          categoria_tecido_id, mix_id, referencia_paths, tamanho_tipo)\n"],
    ["            coalesce((select array_agg(t.x) from jsonb_array_elements_text(coalesce(v_slot->'referencia_paths','[]'::jsonb)) t(x)), '{}'))\n          returning id into v_slot_id;\n",
     "            coalesce((select array_agg(t.x) from jsonb_array_elements_text(coalesce(v_slot->'referencia_paths','[]'::jsonb)) t(x)), '{}'),\n            case when nullif(v_slot->>'modelo_id','') is null then v_tt end)  -- [tamanho-em v1] com card: NULL\n          returning id into v_slot_id;\n        -- [tamanho-em v1] vaga COM card: grava no modelo SÓ quando a tela marca tamanho_tipo_tocado (a pessoa trocou).\n        -- Filtro loja + coleção + interno fecha o IDOR do modelo_id vindo do cliente (fora dele: ignorado) e espelha a\n        -- tela (o toggle só existe no interno). Card integravel/integrado recusa 42501 via trg_zz_integracao_trava.\n        if nullif(v_slot->>'modelo_id','') is not null and coalesce(v_slot->>'tamanho_tipo_tocado', '') = 'true' then\n          if v_tt is null or v_tt not in ('letra', 'numero') then\n            raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';\n          end if;\n          update public.modelos m set tamanho_tipo = v_tt\n           where m.id = (v_slot->>'modelo_id')::uuid\n             and m.tenant_id = (select c.tenant_id from public.colecoes c where c.id = _colecao_id)\n             and m.colecao_id = _colecao_id\n             and coalesce(m.origem, 'interno') = 'interno'\n             and m.tamanho_tipo is distinct from v_tt;\n        end if;\n"],
  ],
  _plan_tecido_criar_card_core: [
    ["declare v_mid uuid; v_mes uuid; v_ano uuid; v_sub text;\n",
     "declare v_mid uuid; v_mes uuid; v_ano uuid; v_sub text;\n  v_tt text;  -- [tamanho-em v1]\n"],
    ["  insert into modelos (tenant_id, nome, colecao_id, subcolecao, linha_id, categoria_principal_id,\n",
     "  -- [tamanho-em v1] \"Tamanho em\" do card = o da VAGA SALVA (P-119 A); sem vaga salva com valor, o do payload\n  -- (validado); senão Letra.\n  v_tt := nullif(_slot->>'tamanho_tipo', '');\n  if v_tt is not null and v_tt not in ('letra', 'numero') then\n    raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';\n  end if;\n  if nullif(_slot->>'slot_id','') is not null then\n    v_tt := coalesce((select sl.tamanho_tipo from plan_tecido_slots sl\n                       where sl.id = (_slot->>'slot_id')::uuid and sl.tenant_id = _tenant), v_tt);\n  end if;\n\n  insert into modelos (tenant_id, nome, colecao_id, subcolecao, linha_id, categoria_principal_id,\n"],
    ["                       origem, status_planejamento, mix_id)\n",
     "                       origem, status_planejamento, mix_id, tamanho_tipo)\n"],
    ["          nullif(_slot->>'mix_id','')::uuid)   -- herda o mix reservado pela vaga (decisão 9)\n",
     "          nullif(_slot->>'mix_id','')::uuid,   -- herda o mix reservado pela vaga (decisão 9)\n          coalesce(v_tt, 'letra'))  -- [tamanho-em v1]\n"],
    ["    update plan_tecido_slots set modelo_id = v_mid\n",
     "    update plan_tecido_slots set modelo_id = v_mid, tamanho_tipo = null  -- [tamanho-em v1] com card, a vaga fica NULL\n"],
  ],
  _plan_tecido_snapshot: [
    ["              'proporcoes', sl.proporcoes, 'categoria_tecido_id', sl.categoria_tecido_id,\n",
     "              'proporcoes', sl.proporcoes, 'categoria_tecido_id', sl.categoria_tecido_id,\n              'tamanho_tipo', sl.tamanho_tipo,  -- [tamanho-em v1]\n"],
  ],
  _replicar_cards_plan_tecido_core: [
    ["      update plan_tecido_slots set modelo_id = v_novo where id = v_slot;\n",
     "      -- [tamanho-em v1] vaga livre reaproveitada: com card ela fica NULL (o valor mora no modelo, copiado da origem).\n      update plan_tecido_slots set modelo_id = v_novo, tamanho_tipo = null where id = v_slot;\n"],
  ],
  _plan_tecido_arvore_core: [
    ["                'categoria_id', sl.categoria_id, 'categoria_tecido_id', sl.categoria_tecido_id, 'mix_id', case when sl.modelo_id is not null then m.mix_id else sl.mix_id end,\n",
     "                'categoria_id', sl.categoria_id, 'categoria_tecido_id', sl.categoria_tecido_id, 'mix_id', case when sl.modelo_id is not null then m.mix_id else sl.mix_id end,\n                'tamanho_tipo', case when sl.modelo_id is not null then m.tamanho_tipo else sl.tamanho_tipo end,  -- [tamanho-em v1]\n"],
  ],
};

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL; achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
const aplicaTexto = (c: Client, sql: string, nome: string) => aplicarSql(c, semTravas(sql, nome), nome);
const aplica = (c: Client, rel: string) => aplicaTexto(c, ler(rel), rel);
/** Texto da função no arquivo: de "CREATE OR REPLACE FUNCTION public.<nome>(" até o 2º "$function$". */
function corpo(rel: string, nome: string): string {
  const t = ler(rel);
  const inicio = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = t.indexOf(inicio);
  expect(t.indexOf(inicio, i + 1), `${rel}: ${nome} 2x`).toBe(-1);
  const a = i < 0 ? -1 : t.indexOf("$function$", i);
  const f = a < 0 ? -1 : t.indexOf("$function$", a + 10);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo de ${nome} não achado`);
  return t.slice(i, f + 10);
}
function aplicaTrocas(antes: string, trocas: [string, string][], rotulo: string): string {
  let out = antes;
  for (const [velho, novo] of trocas) {
    expect(out.split(velho).length - 1, `${rotulo}: âncora ausente/duplicada: ${velho.slice(0, 60)}`).toBe(1);
    out = out.split(velho).join(novo);
  }
  return out;
}
const def = async (c: Client, sig: string) =>
  (await um<{ d: string | null }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [`public.${sig}`])).d;
const md5Vivo = async (c: Client, sig: string) =>
  (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [`public.${sig}`])).m;

async function jaAplicada(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false; // fora da cópia: nem conecta
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    const r = await c.query(
      "SELECT md5(pg_get_functiondef('public.fn_produto_tamanho_tipo_handover()'::regprocedure)) = $1 AS ok",
      [FUNCS[0].depois],
    );
    return r.rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = hasDb && LOCAL && (MIG_TXN || (await jaAplicada()));

async function timeouts(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
}
/** Estado de DEPOIS: com TAMANHO_MIG_TXN aplica o arquivo na txn (idempotente — vale com a cópia antes ou depois). */
async function prepara(c: Client): Promise<void> {
  await timeouts(c);
  // LIFO: a 20261018100000 (Preço anterior/Título por versão) redefine o _replicar_cards_plan_tecido_core POR CIMA desta — no
  // modo txn volta-a (e a 20261018110000) antes de reaplicar esta (a guarda daqui recusaria o texto dela).
  if (MIG_TXN) await voltaPrecoVersaoSePreciso(c);
  if (MIG_TXN) await aplica(c, MIG);
  expect(await md5Vivo(c, FUNCS[0].sig), "migration 20261014100000 ausente").toBe(FUNCS[0].depois);
}
/** Estado de ANTES (só no modo txn): se a cópia já tem a migration, volta pelo próprio inverso DENTRO da txn. */
async function preparaAntes(c: Client): Promise<void> {
  await timeouts(c);
  await voltaPrecoVersaoSePreciso(c); // LIFO: a guarda do inverso daqui exige o _replicar aaf3f2e4… (20261018 volta antes)
  if ((await md5Vivo(c, FUNCS[0].sig)) === FUNCS[0].depois) {
    await c.query("SET LOCAL app.tamanho_em_drop_ok = 'sim'");
    await aplica(c, INV);
    await c.query("SET LOCAL app.tamanho_em_drop_ok = ''");
  }
  for (const f of FUNCS) expect(await md5Vivo(c, f.sig), `${f.arq} (antes)`).toBe(f.antes);
}

/** Roda e ESPERA erro; volta ao savepoint (a txn segue usável). */
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT tam_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT tam_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT tam_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}

// ─────────────────────────────── fixtures (Loja Teste, dentro da txn) ───────────────────────────────
const idDe = async (c: Client, sql: string, p: unknown[] = []) => (await um<{ id: string }>(c, sql, p)).id;
const tipoModelo = async (c: Client, id: string) =>
  (await um<{ t: string | null }>(c, "SELECT tamanho_tipo AS t FROM public.modelos WHERE id = $1", [id])).t;
const revModelo = async (c: Client, id: string) =>
  (await um<{ r: number }>(c, "SELECT rev AS r FROM public.modelos WHERE id = $1", [id])).r;
const tipoPa = async (c: Client, id: string) =>
  (await um<{ t: string | null }>(c, "SELECT tamanho_tipo AS t FROM public.produtos_acabados WHERE id = $1", [id])).t;
const tipoPi = async (c: Client, id: string) =>
  (await um<{ t: string | null }>(c, "SELECT tamanho_tipo AS t FROM public.produtos_importados WHERE id = $1", [id])).t;
const novoPa = (c: Client, nome: string, tipo: string | null) =>
  idDe(c, "INSERT INTO public.produtos_acabados (tenant_id, nome, ref, tamanho_tipo) VALUES ($1, $2, $3, $4) RETURNING id",
    [T, nome, `TAMPA${nome.replace(/\W/g, "").slice(-6)}`, tipo]);
const novoPi = (c: Client, nome: string, tipo: string | null) =>
  idDe(c, "INSERT INTO public.produtos_importados (tenant_id, nome, ref, tamanho_tipo) VALUES ($1, $2, $3, $4) RETURNING id",
    [T, nome, `TAMPI${nome.replace(/\W/g, "").slice(-6)}`, tipo]);
const modeloDe = async (c: Client, tabela: "produtos_acabados" | "produtos_importados", id: string) =>
  (await um<{ m: string | null }>(c, `SELECT modelo_id AS m FROM public.${tabela} WHERE id = $1`, [id])).m;
const colecao = (c: Client, nome: string) =>
  idDe(c, "INSERT INTO public.colecoes (nome, status) VALUES ($1, 'rascunho') RETURNING id", [nome]);
const internoNa = (c: Client, col: string | null, nome: string, tipo = "letra", origem = "interno") =>
  idDe(c, "INSERT INTO public.modelos (tenant_id, nome, origem, colecao_id, tamanho_tipo) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [T, nome, origem, col, tipo]);
async function travaIntegracao(c: Client, modeloId: string): Promise<void> {
  await c.query(
    "INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos) VALUES ($1, $2, 'integravel', ARRAY['nome'])",
    [T, modeloId],
  );
}
const salvarPa = (c: Client, id: string, dados: Record<string, unknown>, variantes: unknown[] = []) =>
  c.query("SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, $3::jsonb)", [id, JSON.stringify(dados), JSON.stringify(variantes)]);
const salvarPi = (c: Client, id: string, dados: Record<string, unknown>) =>
  c.query("SELECT public._salvar_produto_importado_core($1::uuid, $2::jsonb, '[]'::jsonb, '[]'::jsonb)", [id, JSON.stringify(dados)]);

// Plan. Tecido
type Slot = Record<string, unknown> & { slot_index: number };
const arvore = (slots: Slot[]) => ({
  subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots }] }],
});
const salvarArvore = (c: Client, col: string, slots: Slot[]) =>
  c.query("SELECT public._salvar_plan_tecido_core($1::uuid, $2::jsonb, NULL::integer)", [col, JSON.stringify(arvore(slots))]);
async function slotsVivos(c: Client, col: string): Promise<any[]> {
  const a = (await um<{ a: any }>(c, "SELECT public._plan_tecido_arvore_core($1) AS a", [col])).a;
  return a?.subcolecoes?.[0]?.linhas?.[0]?.slots ?? [];
}
const tipoSlot = async (c: Client, slotId: string) =>
  (await um<{ t: string | null }>(c, "SELECT tamanho_tipo AS t FROM public.plan_tecido_slots WHERE id = $1", [slotId])).t;
async function artVar(c: Client): Promise<{ art: string; var: string }> {
  const r = await um<{ art: string; var: string }>(c,
    "SELECT a.id AS art, v.id AS var FROM public.variantes_tecido v JOIN public.artigos a ON a.id = v.artigo_id WHERE a.tenant_id = $1 ORDER BY v.id LIMIT 1", [T]);
  expect(r, "a cópia precisa de 1 variante de tecido na Loja Teste").toBeTruthy();
  return r;
}

// ─────────────────────────────── estático (sem banco) ───────────────────────────────
describe("Tamanho em — arquivos (estático, sem banco)", () => {
  it("migration: encoding ANTES do BEGIN, 2 travas logo depois, NOTIFY + COMMIT no fim; 12 funções = inverso (texto vivo) + SÓ as trocas; md5 de guarda/pós; REVOKE dos 3", () => {
    const m = ler(MIG);
    expect(m.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith(
      "SET client_encoding = 'UTF8';\nBEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL transaction_timeout = '3s';\n")).toBe(true);
    expect(m.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
    if (existsSync(ROOT + TROCAS_JSON)) {
      expect(JSON.parse(ler(TROCAS_JSON)), "trocas.json (quando presente) = TROCAS transcrita").toEqual(TROCAS);
    }
    expect(Object.keys(TROCAS).sort()).toEqual(FUNCS.map((f) => f.arq).sort());
    for (const f of FUNCS) {
      const antes = corpo(INV, f.arq), depois = corpo(MIG, f.arq);
      expect(md5(antes + "\n"), `${f.arq} antes`).toBe(f.antes);
      expect(md5(depois + "\n"), `${f.arq} depois`).toBe(f.depois);
      expect(aplicaTrocas(antes, TROCAS[f.arq], f.arq), f.arq).toBe(depois);
      expect(depois, f.arq).toContain("[tamanho-em v1]");
      expect(antes, f.arq).not.toContain("[tamanho-em v1]");
      // guarda aceita ANTES ou DEPOIS; pós-condição exige DEPOIS
      expect(m, f.arq).toContain(`md5(pg_get_functiondef('public.${f.sig}'::regprocedure));\n  IF v_md5 NOT IN ('${f.antes}', '${f.depois}') THEN`);
      expect(m, f.arq).toContain(`md5(pg_get_functiondef(to_regprocedure('public.${f.sig}')));\n  IF v_md5 IS DISTINCT FROM '${f.depois}' THEN`);
      const acl = f.sig.replace(/,/g, ", ");
      expect(m, f.arq).toContain(`REVOKE EXECUTE ON FUNCTION public.${acl} FROM PUBLIC, anon, authenticated;`);
    }
    // ordem: plpgsql → coluna/CHECK/COMMENT → árvore (LANGUAGE sql valida a coluna no CREATE) → REVOKE → $pos$
    const iAlter = m.indexOf("ALTER TABLE public.plan_tecido_slots ADD COLUMN IF NOT EXISTS tamanho_tipo text;");
    const iArv = m.indexOf("CREATE OR REPLACE FUNCTION public._plan_tecido_arvore_core(");
    const iUltPl = m.indexOf("CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(");
    expect(iAlter).toBeGreaterThan(iUltPl);
    expect(iArv).toBeGreaterThan(iAlter);
    expect(m.indexOf("\nREVOKE EXECUTE ON FUNCTION")).toBeGreaterThan(iArv);
    expect(m.indexOf("DO $pos$")).toBeGreaterThan(m.lastIndexOf("\nREVOKE EXECUTE ON FUNCTION"));
    expect(m).toContain("ADD CONSTRAINT plan_tecido_slots_tamanho_tipo_chk CHECK (tamanho_tipo IN ('letra', 'numero')) NOT VALID;");
    expect(m).toContain("IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_tecido_slots_tamanho_tipo_chk'");
  });

  it("inverso: exige app.tamanho_em_drop_ok, trava plan_tecido_slots, guarda = md5 de DEPOIS EXATO (recusa o resto), pós = md5 de ANTES; cabeçalho com a ordem da volta", () => {
    const v = ler(INV);
    expect(v.replace(/^--[^\n]*\n/gm, "").trimStart().startsWith(
      "SET client_encoding = 'UTF8';\nBEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL transaction_timeout = '3s';\n" +
      "LOCK TABLE public.plan_tecido_slots IN ACCESS EXCLUSIVE MODE;\n")).toBe(true);
    expect(v).toContain("IF coalesce(current_setting('app.tamanho_em_drop_ok', true), '') <> 'sim' THEN");
    for (const f of FUNCS) {
      expect(v, f.arq).toContain(`md5(pg_get_functiondef('public.${f.sig}'::regprocedure));\n  IF v_md5 IS DISTINCT FROM '${f.depois}' THEN`);
      expect(v, f.arq).toContain(`md5(pg_get_functiondef(to_regprocedure('public.${f.sig}')));\n  IF v_md5 IS DISTINCT FROM '${f.antes}' THEN`);
    }
    // a árvore volta ANTES das outras e do DROP COLUMN
    expect(v.indexOf("CREATE OR REPLACE FUNCTION public._plan_tecido_arvore_core(")).toBeLessThan(
      v.indexOf("CREATE OR REPLACE FUNCTION public.fn_produto_tamanho_tipo_handover("));
    expect(v.indexOf("DROP COLUMN IF EXISTS tamanho_tipo")).toBeGreaterThan(
      v.indexOf("CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core("));
    const cab = v.slice(0, v.indexOf("SET client_encoding"));
    expect(cab).toMatch(/o FRONT volta ANTES do banco/);
    expect(cab).toMatch(/20261007140000/);
    expect(cab).toMatch(/20261006100000/);
    expect(cab).toMatch(/volta da F3\.5a NÃO tem guarda md5/);
    expect(cab).toMatch(/EXPORTAR as vagas com valor antes/);
    expect(v).not.toMatch(/^\s*\\/m); // nenhum meta-comando psql
  });

  it("comentários de cabeçalho sem tag $…$ (o harness mig-txn.ts pareia as tags e veria o END do bloco como controle de txn)", () => {
    for (const rel of [MIG, INV]) {
      const cab = ler(rel).slice(0, ler(rel).indexOf("SET client_encoding"));
      expect(cab, rel).not.toMatch(/\$[A-Za-z_]*\$/);
    }
  });

  it("RAISE novos (migration e inverso) só com mensagem ASCII; P0001", () => {
    for (const rel of [MIG, INV]) {
      const msgs = [...ler(rel).matchAll(/raise exception '((?:[^']|'')*)'/gi)].map((r) => r[1]);
      const novos = msgs.filter((s) => s.startsWith("tamanho_em") || s.startsWith("tamanho_tipo invalido"));
      expect(novos.length, rel).toBeGreaterThan(0);
      for (const s of novos) expect(/^[\x20-\x7e]*$/.test(s), `${rel}: ${s}`).toBe(true);
    }
    expect(ler(MIG).split(`'${MSG_INVALIDO}' using errcode = 'P0001'`).length - 1).toBe(5); // PA, PI, slot, tocado, criar card
  });
});

// ─────────────────────────────── (1) criação REAL do card ───────────────────────────────
describe.skipIf(!PRONTO)("Tamanho em — Produto Acabado/Importado", () => {
  it("(1) criar card REAL (PA/PI e os 2 _lote_core): o card nasce com o 'Tamanho em' do produto; o produto fica NULL", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const pa = await novoPa(c, "TAM-T PA1", "numero");
      const mPa = await idDe(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pa]);
      expect(await tipoModelo(c, mPa)).toBe("numero");
      expect(await tipoPa(c, pa)).toBeNull();
      const pi = await novoPi(c, "TAM-T PI1", "numero");
      const mPi = await idDe(c, "SELECT public._criar_card_produto_importado_core($1) AS id", [pi]);
      expect(await tipoModelo(c, mPi)).toBe("numero");
      expect(await tipoPi(c, pi)).toBeNull();
      // lote
      const pa2 = await novoPa(c, "TAM-T PA2", "numero");
      const pa3 = await novoPa(c, "TAM-T PA3", null); // sem escolha: o card fica no default (letra)
      await c.query("SELECT public._criar_cards_produto_acabado_lote_core(ARRAY[$1, $2]::uuid[])", [pa2, pa3]);
      expect(await tipoModelo(c, (await modeloDe(c, "produtos_acabados", pa2))!)).toBe("numero");
      expect(await tipoModelo(c, (await modeloDe(c, "produtos_acabados", pa3))!)).toBe("letra");
      expect([await tipoPa(c, pa2), await tipoPa(c, pa3)]).toEqual([null, null]);
      const pi2 = await novoPi(c, "TAM-T PI2", "numero");
      await c.query("SELECT public._criar_cards_produto_importado_lote_core(ARRAY[$1]::uuid[])", [pi2]);
      expect(await tipoModelo(c, (await modeloDe(c, "produtos_importados", pi2))!)).toBe("numero");
      expect(await tipoPi(c, pi2)).toBeNull();
    });
  });

  it("(2) depois do card: salvar PA com tamanho_tipo troca o modelo (rev sobe); sem a chave nada muda; inválido/NULL = P0001 ASCII; produto sem card guarda (INSERT e UPDATE)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const pa = await novoPa(c, "TAM-T PA4", null);
      const m = await idDe(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pa]);
      expect(await tipoModelo(c, m)).toBe("letra");
      const rev0 = await revModelo(c, m);
      await salvarPa(c, pa, { nome: "TAM-T PA4", qtd_total: 0, tamanho_tipo: "numero" });
      expect(await tipoModelo(c, m)).toBe("numero");
      expect(await tipoPa(c, pa)).toBeNull();
      expect(await revModelo(c, m)).toBeGreaterThan(rev0);
      await salvarPa(c, pa, { nome: "TAM-T PA4", qtd_total: 0 }); // sem a chave: o modelo não muda
      expect(await tipoModelo(c, m)).toBe("numero");
      await salvarPa(c, pa, { nome: "TAM-T PA4", qtd_total: 0, tamanho_tipo: "numero" }); // mesmo valor: passa, nada muda
      expect(await tipoModelo(c, m)).toBe("numero");
      for (const ruim of ["grande", "", null, "Letra"]) {
        const e = await falha(c, "SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb)",
          [pa, JSON.stringify({ nome: "TAM-T PA4", qtd_total: 0, tamanho_tipo: ruim })]);
        expect(e, String(ruim)).toEqual({ code: "P0001", message: MSG_INVALIDO });
      }
      expect(await tipoModelo(c, m)).toBe("numero");
      // produto SEM card: o valor fica no produto (UPDATE) e nasce nele (INSERT)
      const solto = await novoPa(c, "TAM-T PA5", null);
      await salvarPa(c, solto, { nome: "TAM-T PA5", qtd_total: 0, tamanho_tipo: "numero" });
      expect(await tipoPa(c, solto)).toBe("numero");
      await salvarPa(c, solto, { nome: "TAM-T PA5", qtd_total: 0 });
      expect(await tipoPa(c, solto)).toBe("numero"); // sem a chave: mantém
      const g = await um<{ g: string; k: string }>(c,
        "SELECT (SELECT id FROM public.grupos_produto WHERE tenant_id = $1 ORDER BY id LIMIT 1) AS g, (SELECT id FROM public.categorias_produto WHERE tenant_id = $1 ORDER BY id LIMIT 1) AS k", [T]);
      expect(g.g && g.k, "a cópia precisa de 1 grupo e 1 categoria de produto na Loja Teste").toBeTruthy();
      const novo = await idDe(c, "SELECT public._salvar_produto_acabado_core(NULL, $1::jsonb, '[]'::jsonb) AS id",
        [JSON.stringify({ nome: "TAM-T PA6", grupo_id: g.g, categoria_id: g.k, qtd_total: 0, tamanho_tipo: "numero" })]);
      expect(await tipoPa(c, novo)).toBe("numero");
      const semChave = await idDe(c, "SELECT public._salvar_produto_acabado_core(NULL, $1::jsonb, '[]'::jsonb) AS id",
        [JSON.stringify({ nome: "TAM-T PA7", grupo_id: g.g, categoria_id: g.k, qtd_total: 0 })]);
      expect(await tipoPa(c, semChave)).toBeNull();
    });
  });

  it("(2) Importado: mesma regra; o preço FIXO do bloco [integracao v1] segue gravando no mesmo Salvar", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const pi = await novoPi(c, "TAM-T PI3", null);
      const m = await idDe(c, "SELECT public._criar_card_produto_importado_core($1) AS id", [pi]);
      expect(await tipoModelo(c, m)).toBe("letra");
      await c.query("UPDATE public.produtos_importados SET markup_varejo = 3 WHERE id = $1", [pi]);
      await salvarPi(c, pi, { nome: "TAM-T PI3", tamanho_tipo: "numero", preco_varejo_fixo: 199.9 });
      expect(await tipoModelo(c, m)).toBe("numero");
      expect(await tipoPi(c, pi)).toBeNull();
      const p = await um<{ vf: string | null; vm: string | null }>(c,
        "SELECT preco_varejo_fixo AS vf, markup_varejo AS vm FROM public.produtos_importados WHERE id = $1", [pi]);
      expect([Number(p.vf), p.vm]).toEqual([199.9, null]);
      await salvarPi(c, pi, { nome: "TAM-T PI3" });
      expect(await tipoModelo(c, m)).toBe("numero");
      const e = await falha(c, "SELECT public._salvar_produto_importado_core($1::uuid, $2::jsonb, '[]'::jsonb, '[]'::jsonb)",
        [pi, JSON.stringify({ nome: "TAM-T PI3", tamanho_tipo: "tamanho" })]);
      expect(e).toEqual({ code: "P0001", message: MSG_INVALIDO });
      const solto = await novoPi(c, "TAM-T PI4", null);
      await salvarPi(c, solto, { nome: "TAM-T PI4", tamanho_tipo: "numero" });
      expect(await tipoPi(c, solto)).toBe("numero");
    });
  });

  it("(3) trava da Integração: produto integrável não troca o 'Tamanho em' (42501, nada gravado); o MESMO valor passa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const pa = await novoPa(c, "TAM-T PA8", null);
      const m = await idDe(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pa]);
      await travaIntegracao(c, m);
      const nomeAntes = (await um<{ n: string }>(c, "SELECT composicao AS n FROM public.produtos_acabados WHERE id = $1", [pa])).n;
      const e = await falha(c, "SELECT public._salvar_produto_acabado_core($1::uuid, $2::jsonb, '[]'::jsonb)",
        [pa, JSON.stringify({ nome: "TAM-T PA8", qtd_total: 0, composicao: "mudou junto", tamanho_tipo: "numero" })]);
      expect(e).toEqual({ code: "42501", message: "integracao_travado: tamanho_tipo" });
      expect(await tipoModelo(c, m)).toBe("letra");
      expect((await um<{ n: string }>(c, "SELECT composicao AS n FROM public.produtos_acabados WHERE id = $1", [pa])).n).toBe(nomeAntes);
      await salvarPa(c, pa, { nome: "TAM-T PA8", qtd_total: 0, tamanho_tipo: "letra" }); // mesmo valor passa
      expect(await tipoModelo(c, m)).toBe("letra");
      // importado idem
      const pi = await novoPi(c, "TAM-T PI5", null);
      const mi = await idDe(c, "SELECT public._criar_card_produto_importado_core($1) AS id", [pi]);
      await travaIntegracao(c, mi);
      expect(await falha(c, "SELECT public._salvar_produto_importado_core($1::uuid, $2::jsonb, '[]'::jsonb, '[]'::jsonb)",
        [pi, JSON.stringify({ nome: "TAM-T PI5", tamanho_tipo: "numero" })])).toEqual({ code: "42501", message: "integracao_travado: tamanho_tipo" });
      expect(await tipoModelo(c, mi)).toBe("letra");
      await salvarPi(c, pi, { nome: "TAM-T PI5", tamanho_tipo: "letra" });
    });
  });

  it("(4) loja cruzada: vincular produto a modelo de OUTRA loja = P0001 do trg_*_modelo_tenant (antes do repasse); o modelo alheio fica intocado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const alheio = await um<{ id: string; t: string | null; rev: number }>(c,
        "SELECT id, tamanho_tipo AS t, rev FROM public.modelos WHERE tenant_id <> $1 ORDER BY id LIMIT 1", [T]);
      expect(alheio?.id, "a cópia precisa de 1 modelo de outra loja").toBeTruthy();
      const outro = alheio.t === "numero" ? "letra" : "numero";
      for (const tabela of ["produtos_importados", "produtos_acabados"] as const) {
        const p = tabela === "produtos_importados" ? await novoPi(c, "TAM-T PI6", outro) : await novoPa(c, "TAM-T PA9", outro);
        const e = await falha(c, `UPDATE public.${tabela} SET modelo_id = $1 WHERE id = $2`, [alheio.id, p]);
        expect(e).toEqual({ code: "P0001", message: "Modelo de outra loja não pode ser vinculado aqui." });
        const depois = await um<{ t: string | null; rev: number }>(c, "SELECT tamanho_tipo AS t, rev FROM public.modelos WHERE id = $1", [alheio.id]);
        expect(depois).toEqual({ t: alheio.t, rev: alheio.rev });
      }
    });
  });

  it("(5) Replicar PA e PI: a réplica leva o 'Tamanho em' do card de origem", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const destino = await colecao(c, "TAM-T Destino");
      const pa = await novoPa(c, "TAM-T PA10", "numero");
      const mPa = await idDe(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pa]);
      expect(await tipoModelo(c, mPa)).toBe("numero");
      const rPa = (await um<{ r: any[] }>(c, "SELECT public._replicar_produtos_acabados_core($1, $2, NULL, ARRAY[$3]::uuid[]) AS r", [T, destino, pa])).r;
      expect(rPa).toHaveLength(1);
      expect(await tipoModelo(c, rPa[0].novo_modelo_id)).toBe("numero");
      expect(await tipoPa(c, rPa[0].novo_produto_id)).toBeNull();
      const pi = await novoPi(c, "TAM-T PI7", "numero");
      const mPi = await idDe(c, "SELECT public._criar_card_produto_importado_core($1) AS id", [pi]);
      expect(await tipoModelo(c, mPi)).toBe("numero");
      const rPi = (await um<{ r: any[] }>(c, "SELECT public._replicar_produtos_importados_core($1, $2, NULL, ARRAY[$3]::uuid[]) AS r", [T, destino, pi])).r;
      expect(await tipoModelo(c, rPi[0].novo_modelo_id)).toBe("numero");
      // origem em letra → réplica em letra (não é só o default)
      await c.query("UPDATE public.modelos SET tamanho_tipo = 'letra' WHERE id = $1", [mPa]);
      const rPa2 = (await um<{ r: any[] }>(c, "SELECT public._replicar_produtos_acabados_core($1, $2, NULL, ARRAY[$3]::uuid[]) AS r", [T, destino, pa])).r;
      expect(await tipoModelo(c, rPa2[0].novo_modelo_id)).toBe("letra");
    });
  });

  it("_limpar_produto_*: o rascunho limpo zera o 'Tamanho em'", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const pa = await novoPa(c, "TAM-T PA11", "numero");
      await c.query("SELECT public._limpar_produto_acabado_core($1)", [pa]);
      expect(await tipoPa(c, pa)).toBeNull();
      const pi = await novoPi(c, "TAM-T PI8", "numero");
      await c.query("SELECT public._limpar_produto_importado_core($1)", [pi]);
      expect(await tipoPi(c, pi)).toBeNull();
    });
  });

  it("(7) SKU: gerado em Letra, trocar pelo PRODUTO não mexe em modelo_skus; skus_modelo passa a dizer 'divergente' (N a regerar)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      await c.query(
        "UPDATE public.tenant_config SET sku_config = $2::jsonb, tamanhos_sku = $3::jsonb, tamanhos_grade = $4::jsonb WHERE tenant_id = $1",
        [T, JSON.stringify({ partes: ["ref", "cor_base", "tamanho"], separadores: { "ref|cor_base": "-", "cor_base|tamanho": "-" } }),
          JSON.stringify({ "34": "34", "36": "36", PPP: "PPP", PP: "PP" }), JSON.stringify(["34|PPP", "36|PP"])]);
      const cor = await idDe(c, "INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, 'TAM-T Verde', 'TV') RETURNING id", [T]);
      const pa = await novoPa(c, "TAM-T PA12", null);
      await c.query("UPDATE public.produtos_acabados SET ref = 'TAMSKU1', qtd_total = 3 WHERE id = $1", [pa]);
      const variantes = [{ ordem: 1, cor_id: cor, cor_apelido_id: null, peso: 1, qtd: 3 }];
      await c.query("INSERT INTO public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, peso, qtd) VALUES ($1, $2, 1, $3, 1, 3)", [T, pa, cor]);
      const m = await idDe(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pa]);
      await c.query("DELETE FROM public.modelo_grades WHERE modelo_id = $1", [m]);
      await c.query("INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, 1, $2::jsonb, 3)",
        [m, JSON.stringify({ "34|PPP": 1, "36|PP": 2 })]);
      expect(await tipoModelo(c, m)).toBe("letra");
      const g = (await um<{ v: any }>(c, "SELECT public.gerar_skus_modelo($1, false) AS v", [m])).v;
      expect(g.criados).toBe(2);
      const skus = async () => (await c.query("SELECT variante_key, tamanho_key, sku, manual, rev FROM public.modelo_skus WHERE modelo_id = $1 ORDER BY sku", [m])).rows;
      const antes = await skus();
      expect(antes.map((s) => s.sku)).toEqual(["TAMSKU1-TV-PP", "TAMSKU1-TV-PPP"]);
      await salvarPa(c, pa, { nome: "TAM-T PA12", qtd_total: 3, tamanho_tipo: "numero" }, variantes);
      expect(await tipoModelo(c, m)).toBe("numero");
      expect(await skus()).toEqual(antes); // SKU já gerado não muda
      const mz = (await um<{ v: any }>(c, "SELECT public.skus_modelo($1) AS v", [m])).v;
      expect(mz.tamanho_tipo).toBe("numero");
      expect((mz.linhas as any[]).map((l) => [l.sku, l.sku_previsto, l.estado]).sort()).toEqual([
        ["TAMSKU1-TV-PP", "TAMSKU1-TV-36", "divergente"],
        ["TAMSKU1-TV-PPP", "TAMSKU1-TV-34", "divergente"],
      ]);
    });
  });
});

// ─────────────────────────────── (3)/(6) Plan. Tecido ───────────────────────────────
describe.skipIf(!PRONTO)("Tamanho em — Plan. Tecido", () => {
  it("(6) vaga SEM card guarda a escolha → árvore devolve → criar card leva ao modelo e zera a vaga; snapshot tem a chave; inválido = P0001", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const col = await colecao(c, "TAM-T Plan");
      await salvarArvore(c, col, [
        { modelo_id: null, slot_index: 0, nome: "Vaga N", tamanho_tipo: "numero", materiais: [] },
        { modelo_id: null, slot_index: 1, nome: "Vaga L", tamanho_tipo: "letra", materiais: [] },
        { modelo_id: null, slot_index: 2, nome: "Vaga vazia", materiais: [] },
      ]);
      let s = await slotsVivos(c, col);
      expect(s.map((x) => x.tamanho_tipo)).toEqual(["numero", "letra", null]);
      // criar card pela vaga SALVA (payload sem a chave)
      const m0 = await idDe(c, "SELECT public._plan_tecido_criar_card_core($1, $2, $3::jsonb) AS id",
        [T, col, JSON.stringify({ slot_id: s[0].id, nome: "Vaga N", materiais: [] })]);
      expect(await tipoModelo(c, m0)).toBe("numero");
      expect(await tipoSlot(c, s[0].id)).toBeNull();
      // a vaga salva manda sobre o payload; sem nada = letra; payload vale quando a vaga não tem
      const m1 = await idDe(c, "SELECT public._plan_tecido_criar_card_core($1, $2, $3::jsonb) AS id",
        [T, col, JSON.stringify({ slot_id: s[1].id, nome: "Vaga L", tamanho_tipo: "numero", materiais: [] })]);
      expect(await tipoModelo(c, m1)).toBe("letra");
      const m2 = await idDe(c, "SELECT public._plan_tecido_criar_card_core($1, $2, $3::jsonb) AS id",
        [T, col, JSON.stringify({ slot_id: s[2].id, nome: "Vaga vazia", tamanho_tipo: "numero", materiais: [] })]);
      expect(await tipoModelo(c, m2)).toBe("numero");
      const m3 = await idDe(c, "SELECT public._plan_tecido_criar_card_core($1, $2, $3::jsonb) AS id",
        [T, col, JSON.stringify({ nome: "Sem vaga", materiais: [] })]);
      expect(await tipoModelo(c, m3)).toBe("letra");
      expect(await falha(c, "SELECT public._plan_tecido_criar_card_core($1, $2, $3::jsonb)",
        [T, col, JSON.stringify({ nome: "Ruim", tamanho_tipo: "g", materiais: [] })])).toEqual({ code: "P0001", message: MSG_INVALIDO });
      // árvore: com card, o valor é o do MODELO
      s = await slotsVivos(c, col);
      expect(s.map((x) => [x.modelo_id, x.tamanho_tipo])).toEqual([[m0, "numero"], [m1, "letra"], [m2, "numero"]]);
      // salvar de novo com o valor do rascunho em vaga COM card e sem a marca: o modelo NÃO muda e a vaga fica NULL
      await salvarArvore(c, col, s.map((x, i) => ({ id: x.id, modelo_id: x.modelo_id, slot_index: i, tamanho_tipo: "letra", materiais: [] })));
      expect([await tipoModelo(c, m0), await tipoModelo(c, m2)]).toEqual(["numero", "numero"]);
      expect((await c.query("SELECT tamanho_tipo FROM public.plan_tecido_slots WHERE id = ANY($1::uuid[])", [s.map((x) => x.id)])).rows
        .map((r) => r.tamanho_tipo)).toEqual([null, null, null]);
      // snapshot do estado anterior leva a chave
      const snap = (await um<{ p: any }>(c,
        "SELECT ps.payload AS p FROM public.plan_tecido_snapshots ps JOIN public.plan_tecido pt ON pt.id = ps.plan_id WHERE pt.colecao_id = $1 ORDER BY ps.created_at DESC, ps.id DESC LIMIT 1", [col])).p;
      const sl = snap.arvore.subcolecoes[0].linhas[0].slots;
      expect(sl.every((x: any) => Object.prototype.hasOwnProperty.call(x, "tamanho_tipo"))).toBe(true);
      // valor inválido na vaga = P0001 (não cai no CHECK 23514)
      expect(await falha(c, "SELECT public._salvar_plan_tecido_core($1::uuid, $2::jsonb, NULL::integer)",
        [col, JSON.stringify(arvore([{ modelo_id: null, slot_index: 0, tamanho_tipo: "tamanho", materiais: [] }]))]))
        .toEqual({ code: "P0001", message: MSG_INVALIDO });
    });
  });

  it("(6) vaga COM card + tamanho_tipo_tocado: atualiza o modelo interno da MESMA loja e coleção; fora disso (outra coleção/loja, comprado) fica intocado; tocado sem valor válido = P0001", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const col = await colecao(c, "TAM-T Tocado");
      const outraCol = await colecao(c, "TAM-T Outra");
      const meu = await internoNa(c, col, "TAM-T Meu");
      const deOutraCol = await internoNa(c, outraCol, "TAM-T OutraCol");
      const comprado = await internoNa(c, col, "TAM-T Comprado", "letra", "revenda");
      const alheio = await um<{ id: string; t: string | null; rev: number }>(c,
        "SELECT id, tamanho_tipo AS t, rev FROM public.modelos WHERE tenant_id <> $1 ORDER BY id LIMIT 1", [T]);
      const slots: Slot[] = [
        { modelo_id: meu, slot_index: 0, tamanho_tipo: "numero", tamanho_tipo_tocado: true, materiais: [] },
        { modelo_id: deOutraCol, slot_index: 1, tamanho_tipo: "numero", tamanho_tipo_tocado: true, materiais: [] },
        { modelo_id: comprado, slot_index: 2, tamanho_tipo: "numero", tamanho_tipo_tocado: true, materiais: [] },
        { modelo_id: alheio.id, slot_index: 3, tamanho_tipo: alheio.t === "numero" ? "letra" : "numero", tamanho_tipo_tocado: true, materiais: [] },
      ];
      const rev0 = await revModelo(c, meu);
      await salvarArvore(c, col, slots);
      expect(await tipoModelo(c, meu)).toBe("numero");
      expect(await revModelo(c, meu)).toBeGreaterThan(rev0);
      expect([await tipoModelo(c, deOutraCol), await tipoModelo(c, comprado)]).toEqual(["letra", "letra"]);
      expect(await um(c, "SELECT tamanho_tipo AS t, rev FROM public.modelos WHERE id = $1", [alheio.id])).toEqual({ t: alheio.t, rev: alheio.rev });
      // sem a marca: intocado
      const vivos = await slotsVivos(c, col);
      await salvarArvore(c, col, vivos.map((x, i) => ({ id: x.id, modelo_id: x.modelo_id, slot_index: i, tamanho_tipo: "letra", materiais: [] })));
      expect(await tipoModelo(c, meu)).toBe("numero");
      // marca "true" em string/qualquer outro valor não conta; true com valor ausente/ruim = P0001
      await salvarArvore(c, col, [{ id: vivos[0].id, modelo_id: meu, slot_index: 0, tamanho_tipo: "letra", tamanho_tipo_tocado: "sim", materiais: [] }]);
      expect(await tipoModelo(c, meu)).toBe("numero");
      for (const ruim of [null, "", "g", "Letra"]) {
        expect(await falha(c, "SELECT public._salvar_plan_tecido_core($1::uuid, $2::jsonb, NULL::integer)",
          [col, JSON.stringify(arvore([{ modelo_id: meu, slot_index: 0, tamanho_tipo: ruim, tamanho_tipo_tocado: true, materiais: [] }]))]),
        String(ruim)).toEqual({ code: "P0001", message: MSG_INVALIDO });
      }
      expect(await tipoModelo(c, meu)).toBe("numero");
    });
  });

  it("(3)+(6) card TRAVADO: 'tocado' recusa 42501 com a árvore intacta; o MESMO slot sem a marca salva inteiro (materiais, distribuição, atende e slot_oc preservados — ruling #1)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const av = await artVar(c);
      const col = await colecao(c, "TAM-T Travado");
      const m = await internoNa(c, col, "TAM-T Travado");
      const loja = "00000000-0000-4000-8000-00000000abcd";
      const dist = { [loja]: { base: 10, grades: { "38|P": 4 }, manuais: {} } };
      const materiais = [
        { artigo_id: av.art, tipo: "tecido", numero: 1, consumo: 1.2, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: av.var, ordem: 1, multiplicador: 1, grades: { "38|P": 4 }, grade_total: 4, distribuicao: dist }] },
        { artigo_id: av.art, tipo: "tecido", numero: 2, consumo: 0.3, loss_percent: 0, ordem: 1,
          variantes: [{ variante_tecido_id: av.var, ordem: 1, multiplicador: 1, grades: {}, grade_total: 0, atende: [av.var] }] },
      ];
      await salvarArvore(c, col, [{ modelo_id: m, slot_index: 0, nome: "Travado", materiais }]);
      const sid = (await slotsVivos(c, col))[0].id;
      const oc = await um<{ id: string }>(c, "SELECT id FROM public.ocs_tecido WHERE tenant_id = $1 ORDER BY id LIMIT 1", [T]);
      expect(oc?.id, "a cópia precisa de 1 OC de tecido na Loja Teste").toBeTruthy();
      await c.query("INSERT INTO public.plan_tecido_slot_oc (colecao_id, slot_id, oc_tecido_id) VALUES ($1, $2, $3)", [col, sid, oc.id]);
      await travaIntegracao(c, m);
      const retrato = async () => ({
        arv: await slotsVivos(c, col),
        oc: (await c.query("SELECT slot_id, oc_tecido_id FROM public.plan_tecido_slot_oc WHERE colecao_id = $1", [col])).rows,
      });
      const antes = await retrato();
      expect(antes.arv[0].materiais[0].variantes[0].distribuicao).toEqual(dist);
      expect(antes.arv[0].materiais[1].variantes[0].atende).toEqual([av.var]);
      // tocado num card travado: recusa (nunca silêncio) e nada muda
      const e = await falha(c, "SELECT public._salvar_plan_tecido_core($1::uuid, $2::jsonb, NULL::integer)",
        [col, JSON.stringify(arvore([{ id: sid, modelo_id: m, slot_index: 0, nome: "Travado", tamanho_tipo: "numero", tamanho_tipo_tocado: true, materiais }]))]);
      expect(e).toEqual({ code: "42501", message: "integracao_travado: tamanho_tipo" });
      expect(await tipoModelo(c, m)).toBe("letra");
      expect(await retrato()).toEqual(antes);
      // L5 (revisão): "tocado" com o MESMO valor num card travado passa (UPDATE com IS DISTINCT FROM = 0 linhas), sem mexer no rev
      const revTravado = await revModelo(c, m);
      await salvarArvore(c, col, [{ id: sid, modelo_id: m, slot_index: 0, nome: "Travado", tamanho_tipo: "letra", tamanho_tipo_tocado: true, materiais }]);
      expect(await tipoModelo(c, m)).toBe("letra");
      expect(await revModelo(c, m)).toBe(revTravado);
      expect((await retrato()).oc).toEqual(antes.oc);
      // ruling #1: o slot CONTINUA no payload, só sem a marca — salva inteiro, modelo intocado
      await salvarArvore(c, col, [{ id: sid, modelo_id: m, slot_index: 0, nome: "Travado", tamanho_tipo: "letra", materiais }]);
      expect(await tipoModelo(c, m)).toBe("letra");
      const depois = await retrato();
      expect(depois.oc).toEqual(antes.oc);
      expect(depois.arv[0].id).toBe(sid);
      expect(depois.arv[0].materiais.map((x: any) => [x.tipo, x.numero])).toEqual([["tecido", 1], ["tecido", 2]]);
      expect(depois.arv[0].materiais[0].variantes[0].distribuicao).toEqual(dist);
      expect(depois.arv[0].materiais[1].variantes[0].atende).toEqual([av.var]);
    });
  });

  it("M1 (revisão): vaga COM card e sem a marca não valida o valor (é descartado) — legado fora do domínio não trava o Salvar; vaga SEM card segue P0001", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const col = await colecao(c, "TAM-T Legado");
      const m = await internoNa(c, col, "TAM-T Legado");
      const rev0 = await revModelo(c, m);
      // payload como o front manda (valor do modelo) — fora do domínio, sem a marca: passa e nada muda
      await salvarArvore(c, col, [{ modelo_id: m, slot_index: 0, nome: "Legado", tamanho_tipo: "Letra", materiais: [] }]);
      expect(await tipoModelo(c, m)).toBe("letra");
      expect(await revModelo(c, m)).toBe(rev0);
      const sid = (await slotsVivos(c, col))[0].id;
      expect(await tipoSlot(c, sid)).toBeNull();
      // mesma palavra numa vaga SEM card (seria gravada) = P0001
      expect(await falha(c, "SELECT public._salvar_plan_tecido_core($1::uuid, $2::jsonb, NULL::integer)",
        [col, JSON.stringify(arvore([{ modelo_id: null, slot_index: 0, tamanho_tipo: "Letra", materiais: [] }]))]))
        .toEqual({ code: "P0001", message: MSG_INVALIDO });
      if (MIG_TXN) {
        // legado REAL no modelo (o CHECK é NOT VALID; aqui ele sai e volta DENTRO da txn revertida — só no modo txn/N3):
        // a árvore devolve o valor legado, a tela o reenvia e o Salvar passa
        await c.query("ALTER TABLE public.modelos DROP CONSTRAINT modelos_tamanho_tipo_chk");
        await c.query("UPDATE public.modelos SET tamanho_tipo = 'unico' WHERE id = $1", [m]);
        await c.query("ALTER TABLE public.modelos ADD CONSTRAINT modelos_tamanho_tipo_chk CHECK (tamanho_tipo IN ('letra', 'numero')) NOT VALID");
        const vivos = await slotsVivos(c, col);
        expect(vivos[0].tamanho_tipo).toBe("unico");
        await salvarArvore(c, col, vivos.map((x, i) => ({ id: x.id, modelo_id: x.modelo_id, slot_index: i, nome: x.nome, tamanho_tipo: x.tamanho_tipo, materiais: [] })));
        expect(await tipoModelo(c, m)).toBe("unico");
        // trocar de verdade (tocado) sai do legado
        await salvarArvore(c, col, vivos.map((x, i) => ({ id: x.id, modelo_id: x.modelo_id, slot_index: i, nome: x.nome, tamanho_tipo: "numero", tamanho_tipo_tocado: true, materiais: [] })));
        expect(await tipoModelo(c, m)).toBe("numero");
      }
    });
  });

  it("L5 (revisão): criar cards em LOTE (_plan_tecido_criar_cards_core) leva o valor da vaga SALVA e zera a vaga", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const col = await colecao(c, "TAM-T Lote");
      await salvarArvore(c, col, [
        { modelo_id: null, slot_index: 0, nome: "Lote N", tamanho_tipo: "numero", materiais: [] },
        { modelo_id: null, slot_index: 1, nome: "Lote vazio", materiais: [] },
      ]);
      const s = await slotsVivos(c, col);
      const r = (await um<{ r: any[] }>(c, "SELECT public._plan_tecido_criar_cards_core($1, $2, $3::jsonb) AS r", [T, col, JSON.stringify([
        { slot_id: s[0].id, nome: "Lote N", materiais: [] },
        { slot_id: s[1].id, nome: "Lote vazio", materiais: [] },
      ])])).r;
      expect(r).toHaveLength(2);
      const porSlot = Object.fromEntries(r.map((x) => [x.slot_id, x.modelo_id]));
      expect(await tipoModelo(c, porSlot[s[0].id])).toBe("numero");
      expect(await tipoModelo(c, porSlot[s[1].id])).toBe("letra");
      expect([await tipoSlot(c, s[0].id), await tipoSlot(c, s[1].id)]).toEqual([null, null]);
    });
  });

  it("_replicar_cards_plan_tecido_core (12º objeto): a vaga livre reaproveitada fica NULL e o card novo leva o 'Tamanho em' da origem", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const origem = await colecao(c, "TAM-T Origem");
      const destino = await colecao(c, "TAM-T Destino PT");
      const m = await internoNa(c, origem, "TAM-T Origem", "numero");
      await salvarArvore(c, origem, [{ modelo_id: m, slot_index: 0, materiais: [] }]);
      await salvarArvore(c, destino, [{ modelo_id: null, slot_index: 0, nome: "Livre", tamanho_tipo: "letra", materiais: [] }]);
      const livre = (await slotsVivos(c, destino))[0].id;
      expect(await tipoSlot(c, livre)).toBe("letra");
      const r = (await um<{ r: any[] }>(c, "SELECT public._replicar_cards_plan_tecido_core($1, $2, NULL, ARRAY[$3]::uuid[], NULL) AS r", [T, destino, m])).r;
      expect(r).toHaveLength(1);
      expect(r[0].slot_id).toBe(livre); // reaproveitou a vaga livre
      expect(await tipoSlot(c, livre)).toBeNull();
      expect(await tipoModelo(c, r[0].novo_modelo_id)).toBe("numero");
      expect((await slotsVivos(c, destino))[0]).toMatchObject({ id: livre, modelo_id: r[0].novo_modelo_id, tamanho_tipo: "numero" });
    });
  });
});

// ─────────────────────────────── (8) migration em txn: diff, ACL, idempotência, inverso, guardas, RED ───────────────────────────────
describe.skipIf(!PRONTO || !MIG_TXN)("Tamanho em — migration em txn (TAMANHO_MIG_TXN=1)", () => {
  it("(8) depois = antes + SÓ as trocas (texto VIVO) nas 12; reaplicar = no-op; ACL revogada dos 3; coluna text nullable sem default + CHECK NOT VALID", async () => {
    await withTx(async (c) => {
      await preparaAntes(c);
      const antes: Record<string, string> = {};
      for (const f of FUNCS) antes[f.arq] = (await def(c, f.sig))!;
      expect((await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.plan_tecido_slots'::regclass AND attname = 'tamanho_tipo' AND NOT attisdropped")).n).toBe(0);
      await aplica(c, MIG);
      for (const f of FUNCS) {
        const depois = (await def(c, f.sig))!;
        expect(depois, f.arq).toBe(aplicaTrocas(antes[f.arq], TROCAS[f.arq], f.arq));
        expect(md5(depois), f.arq).toBe(f.depois);
      }
      await aplica(c, MIG); // 2ª vez: idempotente
      for (const f of FUNCS) expect(await md5Vivo(c, f.sig), f.arq).toBe(f.depois);
      for (const f of FUNCS) {
        const acl = await um<{ p: boolean; a: boolean; u: boolean; secdef: boolean; cfg: string[] }>(c,
          `SELECT has_function_privilege('public', to_regprocedure($1), 'EXECUTE') AS p,
                  has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') AS a,
                  has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') AS u,
                  prosecdef AS secdef, proconfig AS cfg FROM pg_proc WHERE oid = to_regprocedure($1)`, [`public.${f.sig}`]);
        expect(acl, f.arq).toEqual({ p: false, a: false, u: false, secdef: true, cfg: ["search_path=public"] });
      }
      const col = await um(c,
        `SELECT format_type(atttypid, atttypmod) AS tipo, attnotnull AS nn, atthasdef AS def FROM pg_attribute
          WHERE attrelid = 'public.plan_tecido_slots'::regclass AND attname = 'tamanho_tipo' AND NOT attisdropped`);
      expect(col).toEqual({ tipo: "text", nn: false, def: false });
      const ck = await um(c, "SELECT pg_get_constraintdef(oid) AS d, convalidated AS v FROM pg_constraint WHERE conname = 'plan_tecido_slots_tamanho_tipo_chk'");
      expect(ck).toEqual({ d: "CHECK ((tamanho_tipo = ANY (ARRAY['letra'::text, 'numero'::text]))) NOT VALID", v: false });
    });
  });

  it("(8) inverso: recusa sem a confirmação; com ela devolve os 12 textos de ANTES, tira coluna/CHECK e mantém a ACL; 2ª volta recusa", async () => {
    await withTx(async (c) => {
      await preparaAntes(c);
      await aplica(c, MIG);
      await expect(aplica(c, INV)).rejects.toThrow(/tamanho_em \(volta\): o DROP COLUMN apaga o Tamanho em das vagas sem card/);
      for (const f of FUNCS) expect(await md5Vivo(c, f.sig), f.arq).toBe(f.depois); // recusou inteiro
      await c.query("SET LOCAL app.tamanho_em_drop_ok = 'sim'");
      await aplica(c, INV);
      for (const f of FUNCS) expect(await md5Vivo(c, f.sig), f.arq).toBe(f.antes);
      expect((await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.plan_tecido_slots'::regclass AND attname = 'tamanho_tipo' AND NOT attisdropped")).n).toBe(0);
      expect((await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'plan_tecido_slots_tamanho_tipo_chk'")).n).toBe(0);
      for (const f of FUNCS) {
        expect((await um<{ ok: boolean }>(c,
          `SELECT NOT (has_function_privilege('public', to_regprocedure($1), 'EXECUTE') OR has_function_privilege('anon', to_regprocedure($1), 'EXECUTE')
                   OR has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE')) AS ok`, [`public.${f.sig}`])).ok, f.arq).toBe(true);
      }
      await expect(aplica(c, INV)).rejects.toThrow(/nao esta no texto da migration/);
    });
  });

  it("(8) guardas: a migration recusa texto estranho (P0001) e o inverso recusa se outra frente mexeu DEPOIS", async () => {
    await withTx(async (c) => {
      await preparaAntes(c);
      const txt = (await def(c, FUNCS[7].sig))!; // _salvar_plan_tecido_core
      const mexida = txt.replace("-- trava otimista (spec 2026-08-03)", "-- trava otimista (spec 2026-08-03) [outra frente]");
      expect(mexida).not.toBe(txt);
      await c.query(mexida);
      await expect(aplica(c, MIG)).rejects.toThrow(/tamanho_em: _salvar_plan_tecido_core mudou desde o planejamento/);
      await c.query(txt); // volta
      await aplica(c, MIG);
      const depois = (await def(c, FUNCS[3].sig))!; // _salvar_produto_acabado_core
      await c.query(depois.replace("  v_tt text;  -- [tamanho-em v1]\n", "  v_tt text;  -- [tamanho-em v1] (outra frente)\n"));
      await c.query("SET LOCAL app.tamanho_em_drop_ok = 'sim'");
      await expect(aplica(c, INV)).rejects.toThrow(/tamanho_em \(volta\): _salvar_produto_acabado_core nao esta no texto da migration/);
    });
  });

  it("(8) RED do repasse: SEM a migration o card nasce 'letra' e a escolha do produto some; COM ela nasce 'numero'", async () => {
    await withTx(async (c) => {
      await preparaAntes(c);
      await comoUsuario(c);
      const pa = await novoPa(c, "TAM-T RED", "numero");
      await c.query("SAVEPOINT red");
      const mAntes = await idDe(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pa]);
      expect(await tipoModelo(c, mAntes)).toBe("letra"); // o bug: IS NULL nunca casa com o default 'letra'
      expect(await tipoPa(c, pa)).toBeNull(); // ... e o valor do produto é apagado
      await c.query("ROLLBACK TO SAVEPOINT red");
      await aplica(c, MIG);
      const m = await idDe(c, "SELECT public._criar_card_produto_acabado_core($1) AS id", [pa]);
      expect(await tipoModelo(c, m)).toBe("numero");
    });
  });
});
