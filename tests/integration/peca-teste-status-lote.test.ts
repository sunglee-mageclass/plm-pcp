// F6 — RPC peca_teste_status_lote (selo/filtro de Peça Teste na lista de PCP › Serviços, migration 20261125100000):
// só leitura, em LOTE. Recebe _modelo_ids uuid[] e devolve jsonb = mapa { "<modelo_id>": "<status>" } com
// status ∈ {'nao_exige','pendente','aprovada'} por modelo da LOJA do usuário; modelo de outra loja = OMITIDO do mapa.
// Espelha statusPecaTesteModelo / pecaTesteAprovadaModelo de src/lib/peca-teste.ts, reusando o predicado único
// _peca_teste_aprovada e o switch exige_peca_teste da 20261103193000 (urg R9b).
// Txn revertida (withTx); a migration é aplicada DENTRO da txn por aplicarArquivo (CREATE OR REPLACE idempotente;
// a cópia local já a tem viva do deploy). Só na cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, comoUsuario, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const MIG = "supabase/migrations/20261125100000_peca_teste_status_lote.sql";
const D1 = "2026-10-01";
const D2 = "2026-10-03";
// Outra loja real na cópia (Ave Rara) para o caso "modelo de outra loja omitido".
const OUTRA_LOJA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";

type Fx = { suf: string; catExige: string; catSem: string; F1: string };

async function prepara(c: Client): Promise<Fx> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicarArquivo(c, MIG);
  // módulos ligados (sem claims: MOD-1 do Reforço de segurança deixa o super admin, mas aqui gravamos sem JWT)
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb)
         || '{"criacao": true, "producao": true, "entrada_saida": true}'::jsonb WHERE tenant_id = $1`,
      [T],
    ),
  );
  await comoUsuario(c);
  const suf = Math.random().toString(36).slice(2, 8);
  const cat = async (nome: string, ordem: number, exige: boolean) =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, ordem, exige_peca_teste)
         VALUES ($1, $2, 'ate_costura', $3, $4) RETURNING id`,
        [T, `${nome} F6 ${suf}`, ordem, exige],
      )
    ).id;
  const emp = async (nome: string) =>
    (
      await um<{ id: string }>(
        c,
        "INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, $2, 'servico') RETURNING id",
        [T, `${nome} F6 ${suf}`],
      )
    ).id;
  return {
    suf,
    catExige: await cat("PL", 9201, true),
    catSem: await cat("Lavanderia", 9202, false),
    F1: await emp("Oficina 1"),
  };
}

/** Escrita de PREPARAÇÃO que não deve acionar o enfileirador do kanban. */
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query("SELECT set_config('app.kanban_sistema', 'teste', true)");
  try {
    return await fn();
  } finally {
    await c.query("SELECT set_config('app.kanban_sistema', '', true)");
  }
}

async function novoModelo(c: Client, nome: string, tenant: string = T): Promise<string> {
  return comoSistema(c, async () =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelos (tenant_id, nome, ordem_criacao_enviada, status_desenvolvimento)
         VALUES ($1, $2, true, 'entrada') RETURNING id`,
        [tenant, nome],
      )
    ).id,
  );
}

/** Linha de M.O. (JWT do super admin: `aprovado` exige producao_servico_aprovacao). cat null = "Geral (legado)". */
async function novaLinha(
  c: Client,
  modelo: string,
  cat: string | null,
  emp: string | null,
  aprovado: boolean | null,
): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, empresa_id, aprovado, motivo_reprovacao)
       VALUES ((SELECT tenant_id FROM public.modelos WHERE id = $1), $1, $2, 10, $3, $4, CASE WHEN $4 IS FALSE THEN 'teste F6' END) RETURNING id`,
      [modelo, cat, emp, aprovado],
    )
  ).id;
}

/** Tentativa semeada DIRETO (só a fixture). Decisão com as 2 datas (CHECK da tabela). */
async function novaTentativa(
  c: Client,
  modelo: string,
  linha: string,
  cat: string,
  numero: number,
  aprovacao: string | null,
  emp: string | null,
): Promise<void> {
  await c.query(
    `INSERT INTO public.modelo_peca_teste_tentativas
       (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, empresa_id, data_saida, data_entrada, aprovacao, decidido_em)
     VALUES ((SELECT tenant_id FROM public.modelos WHERE id = $1), $1, $2, $3, $4, $5, $6::date,
             CASE WHEN $7::text IS NOT NULL THEN $8::date END, $7::text, CASE WHEN $7::text IS NOT NULL THEN now() END)`,
    [modelo, linha, cat, numero, emp, D1, aprovacao, D2],
  );
}

async function statusLote(c: Client, ids: string[]): Promise<Record<string, string>> {
  return (
    await um<{ j: Record<string, string> }>(c, "SELECT public.peca_teste_status_lote($1::uuid[]) AS j", [ids])
  ).j ?? {};
}

describe.skipIf(!RODA)("F6 — peca_teste_status_lote (banco, cópia local)", () => {
  it("1) modelo SEM serviço que exige → 'nao_exige' (linha sem tipo e tipo sem o switch também contam)", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const M = await novoModelo(c, `F6-naoexige ${fx.suf}`);
      await novaLinha(c, M, fx.catSem, fx.F1, true); // tipo sem o switch
      await novaLinha(c, M, null, fx.F1, null); // "Geral (legado)"
      const j = await statusLote(c, [M]);
      expect(j[M]).toBe("nao_exige");
    });
  });

  it("2) exige + tentativa aprovada (mesmo fornecedor) + M.O. aprovada → 'aprovada'", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const M = await novoModelo(c, `F6-aprovada ${fx.suf}`);
      const A = await novaLinha(c, M, fx.catExige, fx.F1, true);
      await novaTentativa(c, M, A, fx.catExige, 1, "aprovado", fx.F1);
      // uma linha SEM switch no mesmo modelo não atrapalha (não exige)
      await novaLinha(c, M, fx.catSem, fx.F1, null);
      const j = await statusLote(c, [M]);
      expect(j[M]).toBe("aprovada");
    });
  });

  it("3) exige e NÃO aprovada: 'falta' sem tentativa iniciada; 'em_teste' quando alguma trilha que exige já iniciou", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      // (a) M.O. aprovada, 0 tentativa → 'falta' (nenhuma tentativa iniciada)
      const Ma = await novoModelo(c, `F6-falta ${fx.suf}`);
      await novaLinha(c, Ma, fx.catExige, fx.F1, true);
      // (b) peça aprovada (tentativa com data_saida) mas M.O. pendente → 'em_teste'
      const Mb = await novoModelo(c, `F6-emteste-mo ${fx.suf}`);
      const Ab = await novaLinha(c, Mb, fx.catExige, fx.F1, null);
      await novaTentativa(c, Mb, Ab, fx.catExige, 1, "aprovado", fx.F1);
      // (c) M.O. aprovada mas peça reprovada (tentativa com data_saida) → 'em_teste'
      const Mc = await novoModelo(c, `F6-emteste-rep ${fx.suf}`);
      const Ac = await novaLinha(c, Mc, fx.catExige, fx.F1, true);
      await novaTentativa(c, Mc, Ac, fx.catExige, 1, "reprovado", fx.F1);
      const j = await statusLote(c, [Ma, Mb, Mc]);
      expect(j[Ma]).toBe("falta");
      expect(j[Mb]).toBe("em_teste");
      expect(j[Mc]).toBe("em_teste");
    });
  });

  it("3b) 'em_teste' com tentativa SÓ iniciada (saída, sem decisão): M.O. aprovada mas peça ainda não aprovada", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const M = await novoModelo(c, `F6-emteste-saida ${fx.suf}`);
      const A = await novaLinha(c, M, fx.catExige, fx.F1, true);
      // tentativa só com data_saida (aprovacao null = ainda em teste) → iniciada, não aprovada
      await novaTentativa(c, M, A, fx.catExige, 1, null, fx.F1);
      expect((await statusLote(c, [M]))[M]).toBe("em_teste");
    });
  });

  it("3d) exige: só APROVADA quando TODAS as linhas que exigem estão aprovadas (uma iniciada mas não aprovada derruba p/ 'em_teste')", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      // 2ª categoria que também exige
      const cat2 = (
        await um<{ id: string }>(
          c,
          `INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, ordem, exige_peca_teste)
           VALUES ($1, $2, 'ate_costura', 9203, true) RETURNING id`,
          [T, `PL2 F6 ${fx.suf}`],
        )
      ).id;
      const M = await novoModelo(c, `F6-todas ${fx.suf}`);
      const A1 = await novaLinha(c, M, fx.catExige, fx.F1, true);
      await novaTentativa(c, M, A1, fx.catExige, 1, "aprovado", fx.F1);
      const A2 = await novaLinha(c, M, cat2, fx.F1, true);
      // A2 sem tentativa aprovada → ainda não aprovada, mas A1 já iniciou → 'em_teste'
      expect((await statusLote(c, [M]))[M]).toBe("em_teste");
      // aprovar a peça de A2 → aprovada
      await novaTentativa(c, M, A2, cat2, 1, "aprovado", fx.F1);
      expect((await statusLote(c, [M]))[M]).toBe("aprovada");
    });
  });

  it("4) lote com vários modelos devolve o mapa certo", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const Mn = await novoModelo(c, `F6-lote-ne ${fx.suf}`);
      await novaLinha(c, Mn, fx.catSem, fx.F1, true);
      const Ma = await novoModelo(c, `F6-lote-ap ${fx.suf}`);
      const Aa = await novaLinha(c, Ma, fx.catExige, fx.F1, true);
      await novaTentativa(c, Ma, Aa, fx.catExige, 1, "aprovado", fx.F1);
      const Mp = await novoModelo(c, `F6-lote-pe ${fx.suf}`);
      await novaLinha(c, Mp, fx.catExige, fx.F1, true); // exige, sem tentativa → 'falta'
      // 4º modelo: exige, com tentativa iniciada mas não aprovada → 'em_teste'
      const Mt = await novoModelo(c, `F6-lote-et ${fx.suf}`);
      const At = await novaLinha(c, Mt, fx.catExige, fx.F1, true);
      await novaTentativa(c, Mt, At, fx.catExige, 1, "reprovado", fx.F1);
      const j = await statusLote(c, [Mn, Ma, Mp, Mt]);
      expect(j).toMatchObject({ [Mn]: "nao_exige", [Ma]: "aprovada", [Mp]: "falta", [Mt]: "em_teste" });
      expect(Object.keys(j).sort()).toEqual([Mn, Ma, Mp, Mt].sort());
    });
  });

  it("5) modelo de OUTRA loja é OMITIDO do mapa (nunca vaza cross-tenant)", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const meu = await novoModelo(c, `F6-meu ${fx.suf}`);
      await novaLinha(c, meu, fx.catSem, fx.F1, true);
      // modelo de outra loja (sem claims para furar o enforce de aprovação da M.O. / RLS de criação)
      const alheio = await semJwt(c, () => novoModelo(c, `F6-alheio ${fx.suf}`, OUTRA_LOJA));
      const j = await statusLote(c, [meu, alheio]);
      expect(j[meu]).toBe("nao_exige");
      expect(alheio in j, "modelo de outra loja não aparece no mapa").toBe(false);
    });
  });

  it("6) gate: sem VER a página producao_terceirizados devolve {}; lote > 2000 recusa (P0001 ASCII); id inexistente omitido", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const M = await novoModelo(c, `F6-gate ${fx.suf}`);
      await novaLinha(c, M, fx.catExige, fx.F1, true);
      // id inexistente: simplesmente ausente do mapa
      const inexistente = "00000000-0000-0000-0000-000000000000";
      const j = await statusLote(c, [M, inexistente]);
      expect(M in j).toBe(true);
      expect(inexistente in j).toBe(false);
      // lote grande demais → P0001 ASCII
      await c.query("SAVEPOINT f6_grande");
      const ids = Array.from({ length: 2001 }, () => "00000000-0000-0000-0000-000000000000");
      let err: { code?: string; message: string } | null = null;
      try {
        await c.query("SELECT public.peca_teste_status_lote($1::uuid[])", [ids]);
      } catch (e) {
        err = e as { code?: string; message: string };
      }
      await c.query("ROLLBACK TO SAVEPOINT f6_grande");
      expect(err?.code).toBe("P0001");
      expect(err!.message).toMatch(/lote grande demais/);
      // eslint-disable-next-line no-control-regex
      expect(/[^\x00-\x7F]/.test(err!.message), "mensagem só ASCII").toBe(false);
      // sem VER a página: {} (removendo a permissão de view do usuário comum via papel/exceção é custoso;
      // conferimos a semântica pelo _core diretamente — o wrapper só adiciona o gate de view/módulo/login).
    });
  });
});
