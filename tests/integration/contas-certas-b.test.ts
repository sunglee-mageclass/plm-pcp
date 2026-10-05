// Contas certas — bloco B (itens 6, 8 e 9). Integração em transação revertida (withTx → ROLLBACK).
// Migrations: 20261019100000 (item 6), 20261019110000 (item 8), 20261019120000 (item 9 + 9b). Só leitura de DDL
// (md5/ACL); nenhum teste aplica migration. Precisa das 3 migrations aplicadas no banco em uso (cópia local).
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE, ehBancoLocal } from "./db";
import type { Client } from "pg";
import { md5CamadaSucessor } from "./camada-helpers";

// L3 (revisão G-migration): SÓ na cópia local. Sem DATABASE_URL o db.ts cai em /tmp/dburl.txt (PRODUÇÃO) — este arquivo
// faz DML (tenant_config, ref_sequencia, auth.users) em transação revertida e nunca deve rodar lá.
const RODA = hasDb && ehBancoLocal();

const MD5 = {
  // R16 est #7 (20261026300000, P-188 A): baixa por tamanho pela grade + carona do importado (era 82840be3…)
  estoqueEtiqueta: "28aa308d297cc18b653c6290a5b3b958",
  enforceMo: "a2115ce0538b76b7cbe1740a6227bd2e",
  modeloRef: "0752dc9de192a431b7a241e10d00d58a",
  acabadoRef: "83041c58e76389cab40f3f12ff5a81d0",
  importadoRef: "5549319a6bc74b76e7cb05c0ac37588b",
  refProximo: "be30ddeab566a8997cb8b935365c733c",
};

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  const r = await um<{ m: string | null }>(
    c,
    `select md5(pg_get_functiondef(to_regprocedure($1))) as m`,
    [sig],
  );
  return r.m;
}

async function pode(c: Client, papel: string, sig: string): Promise<boolean> {
  const r = await um<{ p: boolean }>(c, `select has_function_privilege($1, $2, 'EXECUTE') as p`, [
    papel,
    sig,
  ]);
  return r.p;
}

// ─────────────────────────────── item 6 — insumo de revenda sem baixa em dobro ───────────────────────────────
describe.skipIf(!RODA)("contas certas 6 — _estoque_etiqueta_core: revenda baixa UMA vez", () => {
  async function baixa(c: Client, etq: string): Promise<number> {
    const r = await um<{ b: string | null }>(
      c,
      `select sum(baixa) as b from public._estoque_etiqueta_core($1) where etiqueta_id = $2`,
      [TENANT_TESTE, etq],
    );
    return Number(r?.b ?? 0);
  }

  async function cenario(c: Client, origem: "revenda" | "interno") {
    const etq = await um<{ id: string }>(
      c,
      `insert into etiquetas (tenant_id, nome) values ($1, $2) returning id`,
      [TENANT_TESTE, `Etq CC6 ${origem}`],
    );
    const m = await um<{ id: string }>(
      c,
      `insert into modelos (tenant_id, nome, origem) values ($1, $2, $3) returning id`,
      [TENANT_TESTE, `Modelo CC6 ${origem}`, origem],
    );
    await c.query(
      `insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, consumo) values ($1, $2, $3, 1)`,
      [TENANT_TESTE, m.id, etq.id],
    );
    const cad = await um<{ id: string }>(
      c,
      `insert into cad (tenant_id, modelo_id) values ($1, $2) returning id`,
      [TENANT_TESTE, m.id],
    );
    // 100 peças recebidas (cad-espelho da revenda: grade_total_real)
    await c.query(
      `insert into cad_grades (cad_id, variante_numero, grades_planejadas, grade_total_real)
       values ($1, 1, '{}'::jsonb, 100)`,
      [cad.id],
    );
    // o que _receber_oc_p_acabado_core materializa: cad_etiquetas = consumo x peças
    const ce = await um<{ id: string }>(
      c,
      `insert into cad_etiquetas (cad_id, etiqueta_id, consumo, quantidade_enviar)
          values ($1, $2, 1, 100) returning id`,
      [cad.id, etq.id],
    );
    return { etq: etq.id, modelo: m.id, cad: cad.id, cadEtiqueta: ce.id };
  }

  it("migration aplicada: md5 de depois + EXECUTE revogado dos três", async () => {
    await withTx(async (c) => {
      expect(await md5Fn(c, "public._estoque_etiqueta_core(uuid)")).toBe(MD5.estoqueEtiqueta);
      expect(await pode(c, "anon", "public._estoque_etiqueta_core(uuid)")).toBe(false);
      expect(await pode(c, "authenticated", "public._estoque_etiqueta_core(uuid)")).toBe(false);
    });
  });

  it("revenda 100 peças, consumo 1: antes do envio = 100; depois do Enviar para PCP = 100 (não 200); 'a enviar' 80 → 80", async () => {
    await withTx(async (c) => {
      const s = await cenario(c, "revenda");
      expect(await baixa(c, s.etq)).toBe(100); // antes do envio: BOM x peças
      await c.query(`update cad set enviado_corte = true where id = $1`, [s.cad]); // = baixar_estoque_tecido_corte
      expect(await baixa(c, s.etq)).toBe(100); // depois: só o "a enviar" da Explosão (era 200)
      await c.query(`update cad_etiquetas set quantidade_enviar = 80 where id = $1`, [
        s.cadEtiqueta,
      ]);
      expect(await baixa(c, s.etq)).toBe(80); // respeita a edição da pessoa
    });
  });

  it("o Enviar para PCP de verdade (baixar_estoque_tecido_corte) numa revenda: baixa 100, não 200", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await cenario(c, "revenda");
      await c.query(`select public.baixar_estoque_tecido_corte($1, null)`, [s.cad]);
      const e = await um<{ e: boolean }>(c, `select enviado_corte as e from cad where id = $1`, [
        s.cad,
      ]);
      expect(e.e).toBe(true);
      expect(await baixa(c, s.etq)).toBe(100);
    });
  });

  it("caminho manufaturado (interno) intocado: só conta depois do envio, pelo 'a enviar'", async () => {
    await withTx(async (c) => {
      const s = await cenario(c, "interno");
      expect(await baixa(c, s.etq)).toBe(0); // interno não entra na CTE da revenda; sem envio não baixa
      await c.query(`update cad set enviado_corte = true where id = $1`, [s.cad]);
      expect(await baixa(c, s.etq)).toBe(100);
    });
  });
});

// ─────────────────────────────── item 8 — M.O. decidida que muda de valor volta a pendente ───────────────────────────────
describe.skipIf(!RODA)(
  "contas certas 8 — linha de M.O. aprovada/reprovada que muda de valor ou serviço volta a pendente",
  () => {
    const SEM_PERM = "0a0a0a0a-0000-4000-8000-0000000000c8";

    async function comoSemPermissao(c: Client) {
      await c.query(
        `insert into auth.users (id, email) values ($1,'noperm-cc8@teste') on conflict (id) do nothing`,
        [SEM_PERM],
      );
      await c.query(
        `insert into public.users (id, tenant_id, email, nome) values ($1,$2,'noperm-cc8@teste','Sem Perm CC8')
       on conflict (id) do update set tenant_id = excluded.tenant_id`,
        [SEM_PERM, TENANT_TESTE],
      );
      // Reforço de segurança S3c (P-244 = B): mudar o VALOR da M.O. exige EDITAR o Planejamento E ver custos — este usuário
      // tem as duas (o que falta a ele, de propósito, é a permissão de APROVAR: producao_servico_aprovacao).
      await c.query(`delete from public.user_permissions where user_id = $1`, [SEM_PERM]);
      await c.query(
        `insert into public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
         values ($1, $2, 'criacao_planejamento', true, true), ($1, $2, 'criacao_planejamento:custos', true, false)`,
        [SEM_PERM, TENANT_TESTE],
      );
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: SEM_PERM, role: "authenticated" }),
      ]);
      const p = await um<{ p: boolean }>(
        c,
        `select public.user_can_edit('producao_servico_aprovacao') as p`,
      );
      expect(p.p).toBe(false); // pré-condição do teste
    }

    async function modeloComLinha(
      c: Client,
      aprovado: boolean | null,
      motivo: string | null = null,
    ) {
      // semeia como o usuário da Loja Teste (tem producao_servico_aprovacao): gravar `aprovado` exige a permissão
      await comoUsuario(c);
      const m = await um<{ id: string }>(
        c,
        `insert into modelos (tenant_id, nome) values ($1,'M CC8') returning id`,
        [TENANT_TESTE],
      );
      const cat = await um<{ id: string }>(
        c,
        `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1, $2, 'ate_costura') returning id`,
        [TENANT_TESTE, `Serv CC8 ${m.id.slice(0, 8)}`],
      );
      const cat2 = await um<{ id: string }>(
        c,
        `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1, $2, 'ate_costura') returning id`,
        [TENANT_TESTE, `Serv CC8 b ${m.id.slice(0, 8)}`],
      );
      const l = await um<{ id: string }>(
        c,
        `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado, motivo_reprovacao)
          values ($1,$2,$3,50,$4,$5) returning id`,
        [TENANT_TESTE, m.id, cat.id, aprovado, motivo],
      );
      return { modelo: m.id, linha: l.id, cat: cat.id, cat2: cat2.id };
    }

    async function linha(c: Client, id: string) {
      return um<{ aprovado: boolean | null; motivo_reprovacao: string | null; valor: string }>(
        c,
        `select aprovado, motivo_reprovacao, valor from modelo_servico_mo where id = $1`,
        [id],
      );
    }
    async function flag(c: Client, modelo: string) {
      return (
        await um<{ f: boolean }>(
          c,
          `select custo_terceirizados_aprovado as f from modelos where id = $1`,
          [modelo],
        )
      ).f;
    }

    it("migration aplicada: md5 de depois", async () => {
      await withTx(async (c) => {
        // [urg R4a] 20261103180000 redefine enforce_servico_mo_aprovacao por cima (fornecedor da linha reabre): aceita o
        // sucessor pela cadeia LIFO (md5CamadaSucessor continua em md5UrgbSucessor), nunca troca o pino.
        expect(md5CamadaSucessor("public.enforce_servico_mo_aprovacao()", MD5.enforceMo)).toContain(
          await md5Fn(c, "public.enforce_servico_mo_aprovacao()"),
        );
      });
    });

    it("usuário SEM producao_servico_aprovacao muda o valor de linha APROVADA pelo Salvar: sem 42501, linha pendente, flag false", async () => {
      await withTx(async (c) => {
        const s = await modeloComLinha(c, true);
        expect(await flag(c, s.modelo)).toBe(true);
        await comoSemPermissao(c);
        await c.query(`select public.salvar_modelo_servico_mo($1, $2::jsonb)`, [
          s.modelo,
          JSON.stringify([{ id: s.linha, categoria_terceirizado_id: s.cat, valor: 75 }]),
        ]);
        const l = await linha(c, s.linha);
        expect(l.aprovado).toBeNull();
        expect(Number(l.valor)).toBe(75);
        expect(await flag(c, s.modelo)).toBe(false);
      });
    });

    it("mesmo valor (sem mudança real, 50 vs 50.00): continua aprovada", async () => {
      await withTx(async (c) => {
        const s = await modeloComLinha(c, true);
        await comoSemPermissao(c);
        await c.query(`select public.salvar_modelo_servico_mo($1, $2::jsonb)`, [
          s.modelo,
          JSON.stringify([{ id: s.linha, categoria_terceirizado_id: s.cat, valor: "50.00" }]),
        ]);
        expect((await linha(c, s.linha)).aprovado).toBe(true);
        expect(await flag(c, s.modelo)).toBe(true);
      });
    });

    it("trocar o SERVIÇO de linha aprovada: fica pendente", async () => {
      await withTx(async (c) => {
        const s = await modeloComLinha(c, true);
        await comoSemPermissao(c);
        await c.query(`update modelo_servico_mo set categoria_terceirizado_id = $2 where id = $1`, [
          s.linha,
          s.cat2,
        ]);
        expect((await linha(c, s.linha)).aprovado).toBeNull();
      });
    });

    it("REPROVADA com valor novo: fica pendente e o motivo é limpo", async () => {
      await withTx(async (c) => {
        const s = await modeloComLinha(c, false, "caro demais");
        await comoSemPermissao(c);
        await c.query(`update modelo_servico_mo set valor = 40 where id = $1`, [s.linha]);
        const l = await linha(c, s.linha);
        expect(l.aprovado).toBeNull();
        expect(l.motivo_reprovacao).toBeNull();
      });
    });

    it("PENDENTE com valor novo: continua pendente (nada muda)", async () => {
      await withTx(async (c) => {
        const s = await modeloComLinha(c, null);
        await comoSemPermissao(c);
        await c.query(`update modelo_servico_mo set valor = 40 where id = $1`, [s.linha]);
        expect((await linha(c, s.linha)).aprovado).toBeNull();
      });
    });

    it("aprovar_servico_mo SEM permissão: continua 42501", async () => {
      await withTx(async (c) => {
        const s = await modeloComLinha(c, null);
        await comoSemPermissao(c);
        await expect(
          c.query(`select public.aprovar_servico_mo($1, $2, true, null)`, [s.modelo, s.linha]),
        ).rejects.toMatchObject({ code: "42501" });
      });
    });

    it("valor E aprovado mudando juntos sem permissão: continua 42501 (a reabertura não abre brecha)", async () => {
      await withTx(async (c) => {
        const s = await modeloComLinha(c, false, "x");
        await comoSemPermissao(c);
        await expect(
          c.query(`update modelo_servico_mo set valor = 10, aprovado = true where id = $1`, [
            s.linha,
          ]),
        ).rejects.toMatchObject({ code: "42501" });
      });
    });

    it("COM permissão: aprovar de novo depois da reabertura funciona", async () => {
      await withTx(async (c) => {
        const s = await modeloComLinha(c, true);
        await comoUsuario(c); // usuário da Loja Teste (admin → tem a permissão)
        await c.query(`update modelo_servico_mo set valor = 60 where id = $1`, [s.linha]);
        expect((await linha(c, s.linha)).aprovado).toBeNull();
        await c.query(`select public.aprovar_servico_mo($1, $2, true, null)`, [s.modelo, s.linha]);
        expect((await linha(c, s.linha)).aprovado).toBe(true);
        expect(await flag(c, s.modelo)).toBe(true);
      });
    });

    it("replicar segue zerando o aprovado (INSERT com aprovado NULL; o texto do replicar não mudou)", async () => {
      await withTx(async (c) => {
        const f = await um<{ d: string }>(
          c,
          `select pg_get_functiondef('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)'::regprocedure) as d`,
        );
        expect(f.d).toMatch(
          /select _tenant, v_novo, categoria_terceirizado_id, valor, null, null, observacoes/,
        );
        await comoUsuario(c);
        const m = await um<{ id: string }>(
          c,
          `insert into modelos (tenant_id, nome) values ($1,'M CC8 rep') returning id`,
          [TENANT_TESTE],
        );
        const l = await um<{ aprovado: boolean | null }>(
          c,
          `insert into modelo_servico_mo (tenant_id, modelo_id, valor, aprovado) values ($1,$2,30,null) returning aprovado`,
          [TENANT_TESTE, m.id],
        );
        expect(l.aprovado).toBeNull();
      });
    });
  },
);

// ─────────────────────────────── item 9 — "Começar em" vale para REF nova ───────────────────────────────
describe.skipIf(!RODA)(
  "contas certas 9 — piso da REF = 'Começar em' da loja; ref_proximo_numero",
  () => {
    async function prepara(c: Client, ultimo: number, numInicio: number | null) {
      await c.query(
        `insert into ref_sequencia (tenant_id, ultimo) values ($1, $2)
       on conflict (tenant_id) do update set ultimo = excluded.ultimo`,
        [TENANT_TESTE, ultimo],
      );
      await c.query(
        `update tenant_config set ref_config = case when $2::bigint is null then ref_config - 'num_inicio'
         else coalesce(ref_config, '{}'::jsonb) || jsonb_build_object('num_inicio', $2::bigint) end
       where tenant_id = $1`,
        [TENANT_TESTE, numInicio],
      );
    }
    const proximo = async (c: Client, f: string) =>
      Number((await um<{ n: string }>(c, `select public.${f}($1) as n`, [TENANT_TESTE])).n);

    it("migration aplicada: md5 de depois dos 3 embrulhos + RPC nova", async () => {
      await withTx(async (c) => {
        expect(await md5Fn(c, "public._modelo_ref_next_num(uuid)")).toBe(MD5.modeloRef);
        expect(await md5Fn(c, "public._produto_acabado_ref_next(uuid)")).toBe(MD5.acabadoRef);
        expect(await md5Fn(c, "public._produto_importado_ref_next(uuid)")).toBe(MD5.importadoRef);
        expect(await md5Fn(c, "public.ref_proximo_numero(bigint)")).toBe(MD5.refProximo);
      });
    });

    it("num_inicio > ultimo: modelo, acabado e importado pegam num_inicio, depois +1, +2 (pool ÚNICO)", async () => {
      await withTx(async (c) => {
        await prepara(c, 10000274, 100000000);
        expect(await proximo(c, "_modelo_ref_next_num")).toBe(100000000);
        expect(await proximo(c, "_produto_acabado_ref_next")).toBe(100000001);
        expect(await proximo(c, "_produto_importado_ref_next")).toBe(100000002);
      });
    });

    it("loja sem config: continua em ultimo+1 (piso 10000000)", async () => {
      await withTx(async (c) => {
        await prepara(c, 10000012, null);
        expect(await proximo(c, "_modelo_ref_next_num")).toBe(10000013);
        await prepara(c, 0, null);
        expect(await proximo(c, "_produto_acabado_ref_next")).toBe(10000000);
      });
    });

    it("num_inicio <= ultimo: ultimo+1 (o piso nunca faz voltar)", async () => {
      await withTx(async (c) => {
        await prepara(c, 10000500, 10000100);
        expect(await proximo(c, "_produto_importado_ref_next")).toBe(10000501);
      });
    });

    it("fim a fim: modelo que chega ao Dev nasce com o nº do 'Começar em'; REF manual e ref_auto existentes intactas", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const antes = await um<{ n: string }>(
          c,
          `select count(*) as n from modelos where tenant_id = $1 and (ref is not null or ref_auto is not null)`,
          [TENANT_TESTE],
        );
        const hash = await um<{ h: string }>(
          c,
          `select md5(string_agg(id::text || coalesce(ref,'') || coalesce(ref_auto,''), ',' order by id)) as h
              from modelos where tenant_id = $1`,
          [TENANT_TESTE],
        );
        await prepara(c, 10000274, 100000000);
        // categoria de um modelo existente da loja → a sigla não fica vazia (senão o gatilho não gera ref_auto)
        const cat = await um<{ id: string }>(
          c,
          `select categoria_principal_id as id from modelos where tenant_id = $1 and categoria_principal_id is not null limit 1`,
          [TENANT_TESTE],
        );
        const m = await um<{ id: string }>(
          c,
          `insert into modelos (tenant_id, nome, categoria_principal_id) values ($1, 'M CC9 ref', $2) returning id`,
          [TENANT_TESTE, cat.id],
        );
        await c.query(`update modelos set ordem_criacao_enviada = true where id = $1`, [m.id]);
        const r = await um<{ ref_auto: string | null }>(
          c,
          `select ref_auto from modelos where id = $1`,
          [m.id],
        );
        expect(r.ref_auto ?? "").toMatch(/100000000$/);
        // as REFs que já existiam não mudaram (P-162 A)
        const hash2 = await um<{ h: string }>(
          c,
          `select md5(string_agg(id::text || coalesce(ref,'') || coalesce(ref_auto,''), ',' order by id)) as h
              from modelos where tenant_id = $1 and id <> $2`,
          [TENANT_TESTE, m.id],
        );
        expect(hash2.h).toBe(hash.h);
        const depois = await um<{ n: string }>(
          c,
          `select count(*) as n from modelos where tenant_id = $1 and id <> $2 and (ref is not null or ref_auto is not null)`,
          [TENANT_TESTE, m.id],
        );
        expect(depois.n).toBe(antes.n);
      });
    });

    it("ref_proximo_numero(): max(ultimo+1, piso) sem consumir; aceita o piso do rascunho", async () => {
      await withTx(async (c) => {
        await prepara(c, 10000274, 100000000);
        await comoUsuario(c, USER_TESTE);
        const n1 = Number(
          (await um<{ n: string }>(c, `select public.ref_proximo_numero() as n`)).n,
        );
        const n2 = Number(
          (await um<{ n: string }>(c, `select public.ref_proximo_numero() as n`)).n,
        );
        expect(n1).toBe(100000000);
        expect(n2).toBe(100000000); // não consumiu
        const ult = await um<{ u: string }>(
          c,
          `select ultimo as u from ref_sequencia where tenant_id = $1`,
          [TENANT_TESTE],
        );
        expect(Number(ult.u)).toBe(10000274);
        // rascunho: "Começar em" digitado e ainda não salvo
        expect(
          Number((await um<{ n: string }>(c, `select public.ref_proximo_numero(20000000) as n`)).n),
        ).toBe(20000000);
        expect(
          Number((await um<{ n: string }>(c, `select public.ref_proximo_numero(5) as n`)).n),
        ).toBe(10000275);
      });
    });

    it("R1d: 'Começar em' digitado fora da regra (19 dígitos, negativo) → a prévia usa o piso 10000000, como a emissão", async () => {
      await withTx(async (c) => {
        await prepara(c, 5, null);
        await comoUsuario(c, USER_TESTE);
        for (const v of ["9223372036854775807", "-5"]) {
          const r = await um<{ n: string }>(
            c,
            `select public.ref_proximo_numero($1::bigint) as n`,
            [v],
          );
          expect(Number(r.n)).toBe(10000000);
        }
        const ok = await um<{ n: string }>(
          c,
          `select public.ref_proximo_numero(123456789012345678) as n`,
        );
        expect(ok.n).toBe("123456789012345678");
      });
    });

    it("ref_proximo_numero: sem JWT → 42501", async () => {
      await withTx(async (c) => {
        await expect(c.query(`select public.ref_proximo_numero()`)).rejects.toMatchObject({
          code: "42501",
        });
      });
    });

    it("ACL (RB1): anon NÃO executa ref_proximo_numero; authenticated sim; os 3 embrulhos fechados", async () => {
      await withTx(async (c) => {
        expect(await pode(c, "anon", "public.ref_proximo_numero(bigint)")).toBe(false);
        expect(await pode(c, "authenticated", "public.ref_proximo_numero(bigint)")).toBe(true);
        for (const f of [
          "_modelo_ref_next_num",
          "_produto_acabado_ref_next",
          "_produto_importado_ref_next",
        ]) {
          expect(await pode(c, "anon", `public.${f}(uuid)`)).toBe(false);
          expect(await pode(c, "authenticated", `public.${f}(uuid)`)).toBe(false);
        }
      });
    });
  },
);

// ─────────────── item 9 / M2 (fix round 1) — "Começar em" inválido nunca derruba REF nem o salvar ───────────────
describe.skipIf(!RODA)("contas certas 9 / M2 — _ref_num_inicio tolerante a config ruim", () => {
  async function cfgNumInicio(c: Client, valorJson: string) {
    await c.query(
      `update tenant_config set ref_config = coalesce(ref_config, '{}'::jsonb) || jsonb_build_object('num_inicio', $2::jsonb)
        where tenant_id = $1`,
      [TENANT_TESTE, valorJson],
    );
  }

  it("md5 de depois do _ref_num_inicio tolerante", async () => {
    await withTx(async (c) => {
      expect(await md5Fn(c, "public._ref_num_inicio(uuid)")).toBe(
        "addf044a5ebf27c29d533c35698db959",
      );
      expect(await pode(c, "anon", "public._ref_num_inicio(uuid)")).toBe(false);
      expect(await pode(c, "authenticated", "public._ref_num_inicio(uuid)")).toBe(false);
    });
  });

  it.each([
    ["notação 1e+21 (vira 22 dígitos no jsonb)", "1e+21"],
    ["fração", "12.5"],
    ["acima do bigint", "99999999999999999999"],
    ["texto", '"abc"'],
    ["negativo", "-5"],
    ["vazio", '""'],
  ])(
    "%s → piso 10000000; o gatilho de REF e o salvar do modelo seguem funcionando",
    async (_rotulo, valor) => {
      await withTx(async (c) => {
        await comoUsuario(c);
        await c.query(
          `insert into ref_sequencia (tenant_id, ultimo) values ($1, 10000274)
         on conflict (tenant_id) do update set ultimo = excluded.ultimo`,
          [TENANT_TESTE],
        );
        await cfgNumInicio(c, valor);
        const ini = await um<{ n: string }>(c, `select public._ref_num_inicio($1) as n`, [
          TENANT_TESTE,
        ]);
        expect(Number(ini.n)).toBe(10000000);
        expect(
          Number((await um<{ n: string }>(c, `select public.ref_proximo_numero() as n`)).n),
        ).toBe(10000275);
        // modelo chega ao Dev (gatilho fn_modelo_ref_auto → _modelo_ref_next_num → _ref_num_inicio)
        const cat = await um<{ id: string }>(
          c,
          `select categoria_principal_id as id from modelos where tenant_id = $1 and categoria_principal_id is not null limit 1`,
          [TENANT_TESTE],
        );
        const m = await um<{ id: string }>(
          c,
          `insert into modelos (tenant_id, nome, categoria_principal_id) values ($1, 'M CC9 M2', $2) returning id`,
          [TENANT_TESTE, cat.id],
        );
        await c.query(`update modelos set ordem_criacao_enviada = true where id = $1`, [m.id]);
        const r = await um<{ ref_auto: string | null }>(
          c,
          `select ref_auto from modelos where id = $1`,
          [m.id],
        );
        expect(r.ref_auto ?? "").toMatch(/10000275$/);
      });
    },
  );

  it("valor válido de 18 dígitos continua valendo", async () => {
    await withTx(async (c) => {
      await cfgNumInicio(c, "123456789012345678");
      const ini = await um<{ n: string }>(c, `select public._ref_num_inicio($1) as n`, [
        TENANT_TESTE,
      ]);
      expect(ini.n).toBe("123456789012345678");
    });
  });
});
