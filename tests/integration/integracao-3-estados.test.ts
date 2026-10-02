/** Integração + API — migration 3 (estados + log). Plano Task 3. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import type { Client as ClientType } from "pg";
import { hasDb, withTx, comoUsuario, um, dbUrl } from "./db";
import { aplicarSql } from "./mig-txn";
import { CAMPOS_PADRAO, INVERSOS, LOCAL, MIG_TXN, T, U, aplica, camposLoja, comoUsuarioCom, keywordsLoja, ler, modeloInterno, prepara, revenda, semTravas, padraoVivo } from "./integracao-helpers";

const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // loja com mais modelos na cópia (mesmo id da suíte 2)
const SSL = false; // cópia local, sem SSL — mesmo padrão de kanban-auto.test.ts/sku-previa.test.ts

async function assinatura(c: ClientType, id: string): Promise<string> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
}
async function marcar(c: ClientType, id: string, ass?: string): Promise<any> {
  const a = ass ?? (await assinatura(c, id));
  return (await um<{ r: any }>(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text))) AS r`, [id, a])).r;
}
async function erro(c: ClientType, sql: string, params: unknown[]): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT e");
  try {
    await c.query(sql, params);
    throw new Error("esperava erro");
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT e");
    return { code: e.code, message: e.message };
  }
}

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 3: estados", () => {
  it("marcar: integrável + retrato + espelho (1 produto + 2 sublinhas) + log 'integrar'; estado_modelos enxerga", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const padrao = await padraoVivo(c); // Release I3: a I3c marca os 3 não obrigatórios em toda config (20)
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });
      const ip = await um<{ estado: string; campos: string[]; ass: string; marcado: boolean }>(c,
        `SELECT estado, campos, assinatura AS ass, marcado_em IS NOT NULL AS marcado FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id]);
      expect(ip).toMatchObject({ estado: "integravel", campos: [...padrao], marcado: true });
      const esp = await c.query(`SELECT tipo, ordem, ref_sku, tamanho, preco_venda, integrado_em FROM public.integracao_linhas WHERE modelo_id = $1 ORDER BY ordem`, [m.id]);
      expect(esp.rows.map((r) => [r.tipo, r.ordem, r.tamanho])).toEqual([["produto", 0, null], ["variante", 1, "P"], ["variante", 2, "M"]]);
      expect(esp.rows[1].ref_sku).toBe(`${m.ref}-P`);
      expect(esp.rows[0].preco_venda).toBe("159.90");
      const log = await um<{ acao: string; quem: string; d: any }>(c,
        `SELECT acao, quem, detalhe AS d FROM public.integracao_log WHERE modelo_id = $1`, [m.id]);
      expect(log).toMatchObject({ acao: "integrar", d: { campos: padrao.length, sublinhas: 2 } });
      expect(log.quem).toMatch(/\(super admin\)$/);
      const est = (await um<{ r: any }>(c, `SELECT public.integracao_estado_modelos(ARRAY[$1::uuid]) AS r`, [m.id])).r;
      expect(est[m.id]).toMatchObject({ estado: "integravel", campos: [...padrao] });
      const todos = (await um<{ r: any }>(c, `SELECT public.integracao_estado_modelos(NULL) AS r`)).r;
      expect(todos[m.id]).toMatchObject({ estado: "integravel" });
      expect(Object.values(todos).every((x: any) => ["integravel", "integrado"].includes(x.estado))).toBe(true);
    });
  });

  it("assinatura velha = P0409 integracao_mudou (ASCII); marcar de novo = P0409", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const a = await assinatura(c, m.id);
      await c.query(`UPDATE public.modelos SET ncm = '6109.90.00' WHERE id = $1`, [m.id]);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m.id, a]);
      expect(e.code).toBe("P0409");
      expect(e.message).toMatch(/^integracao_mudou: /);
      expect(/^[\x20-\x7E]*$/.test(e.message)).toBe(true);
      await marcar(c, m.id);
      const e2 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', 'x')))`, [m.id]);
      expect(e2.code).toBe("P0409");
    });
  });

  it("incompleto e reprovado = P0001 (nada marcado)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, null);
      const m = await modeloInterno(c);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m.id, await assinatura(c, m.id)]);
      expect(e).toMatchObject({ code: "P0001" });
      expect(e.message).toMatch(/incompleto — faltam: Keywords/);
      await keywordsLoja(c, "k");
      await c.query(`UPDATE public.modelos SET status_desenvolvimento = 'reprovado' WHERE id = $1`, [m.id]);
      const e2 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m.id, await assinatura(c, m.id)]);
      expect(e2.message).toMatch(/reprovado/);
    });
  });

  it("G2 (ruling do controlador, G-migration fix 1): integravel reprovado continua na lista (nao_integravel some)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      // integravel + reprovado no Planejamento -> continua visivel (senao trava sem "Voltar")
      const mPlan = await modeloInterno(c);
      await marcar(c, mPlan.id);
      await c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [mPlan.id]);
      const lPlan = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`, [mPlan.ref]);
      expect(lPlan.r.total).toBe(1);
      expect(lPlan.r.produtos[0]).toMatchObject({ modelo_id: mPlan.id, estado: "integravel" });

      // integravel + reprovado no Desenvolvimento -> continua visivel
      const mDev = await modeloInterno(c);
      await marcar(c, mDev.id);
      await c.query(`UPDATE public.modelos SET status_desenvolvimento = 'reprovado' WHERE id = $1`, [mDev.id]);
      const lDev = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`, [mDev.ref]);
      expect(lDev.r.total).toBe(1);
      expect(lDev.r.produtos[0]).toMatchObject({ modelo_id: mDev.id, estado: "integravel" });

      // nao_integravel + reprovado -> continua sumindo (comportamento pre-existente, P-61 A/D9)
      const mNao = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [mNao.id]);
      const lNao = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`, [mNao.ref]);
      expect(lNao.r.total).toBe(0);

      // marcar um reprovado continua recusado
      const mMarcar = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [mMarcar.id]);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [mMarcar.id, await assinatura(c, mMarcar.id)]);
      expect(e.message).toMatch(/reprovado/);
    });
  });

  it("G6 (ruling do controlador, G-migration fix 1 · B-M10): integracao_marcar reconfere criacao + modulo da origem", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      // fixtures criadas como super admin (is_super_admin() "fura" o gate de módulo — tenant_module_enabled),
      // depois troca pra um usuário NÃO-admin com permissão de Integração, pra exercitar o gate de verdade.
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      const m2 = await modeloInterno(c);
      const PERM: Array<[string, boolean, boolean]> = [["integracao", true, true], ["criacao_planejamento", true, true],
        ["criacao_planejamento:preco_venda", true, true], ["criacao_desenvolvimento", true, true],
        ["criacao_planejamento:custos", true, true]];
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce41", PERM);
      // dentro da txn: desliga o modulo produto_acabado (mesma tecnica da suite 5, n5)
      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"produto_acabado": false}'::jsonb WHERE tenant_id = $1`, [T]);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m.id, await assinatura(c, m.id)]);
      expect(e.code).toBe("42501");
      expect(e.message).toMatch(/^integracao_sem_permissao: /);
      // religa o modulo: volta a marcar normalmente (mesma msg/ERRCODE do salvar via _integracao_gates)
      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"produto_acabado": true}'::jsonb WHERE tenant_id = $1`, [T]);
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });
      // modulo criacao desligado tambem recusa (mesmo gate v_criacao de _integracao_gates)
      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"criacao": false}'::jsonb WHERE tenant_id = $1`, [T]);
      const e2 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m2.id, await assinatura(c, m2.id)]);
      expect(e2.code).toBe("42501");
      expect(e2.message).toMatch(/^integracao_sem_permissao: /);
    });
  });

  it("H3 (ruling do controlador, G-migration fix 2 · A + B-DM-3): _integracao_gates expoe 'modulo_bloqueado' ESTRUTURADO — integracao_marcar nao depende do TEXTO PT do motivo", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      const PERM: Array<[string, boolean, boolean]> = [["integracao", true, true], ["criacao_planejamento", true, true],
        ["criacao_planejamento:preco_venda", true, true], ["criacao_desenvolvimento", true, true],
        ["criacao_planejamento:custos", true, true]];
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce42", PERM);

      // sinal ESTRUTURADO: modulo_bloqueado = false com o modulo ligado
      const gatesOn = (await um<{ r: any }>(c, `SELECT public._integracao_gates($1::uuid) AS r`, [m.id])).r;
      expect(gatesOn.modulo_bloqueado).toBe(false);

      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"produto_acabado": false}'::jsonb WHERE tenant_id = $1`, [T]);
      const gatesOff = (await um<{ r: any }>(c, `SELECT public._integracao_gates($1::uuid) AS r`, [m.id])).r;
      expect(gatesOff.modulo_bloqueado).toBe(true);

      // ruling do controlador, G-migration fix 2 #H3: prova de que a checagem NÃO é mais por TEXTO — muda a
      // mensagem PT de _integracao_gates.compartilhado.motivo (simulado direto no retorno, sem editar a função)
      // e confirma que integracao_marcar CONTINUA recusando (porque agora olha 'modulo_bloqueado', não o texto).
      // Se a checagem ainda comparasse a string antiga, uma mudança de copy destravaria isto em silêncio — o
      // teste abaixo prova que isso NÃO acontece mais: o marcar recusa mesmo com o texto do motivo diferente do
      // literal original (fixture: consulta _integracao_gates com um motivo customizado via override temporário
      // não é viável sem tocar a função; a prova real é indireta — confirmamos que o predicado usado por
      // integracao_marcar é 'modulo_bloqueado' e não texto, lendo o código-fonte da função redefinida).
      const def = (await um<{ d: string }>(c, `SELECT pg_get_functiondef('public.integracao_marcar(jsonb)'::regprocedure) AS d`)).d;
      expect(def).toContain("modulo_bloqueado");
      expect(def).not.toMatch(/O módulo Estilo & Engenharia está desligado nesta loja\./);
      expect(def).not.toMatch(/O módulo da origem deste produto/);

      // efeito continua o mesmo (recusa com módulo desligado)
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m.id, await assinatura(c, m.id)]);
      expect(e).toEqual({ code: "42501", message: "integracao_sem_permissao: compartilhado" });

      // religa: modulo_bloqueado volta a false, marcar volta a funcionar
      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"produto_acabado": true}'::jsonb WHERE tenant_id = $1`, [T]);
      const gatesBack = (await um<{ r: any }>(c, `SELECT public._integracao_gates($1::uuid) AS r`, [m.id])).r;
      expect(gatesBack.modulo_bloqueado).toBe(false);
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });

      // modulo_bloqueado NÃO confunde com outros motivos de base_ok=false (ex.: sem permissão de Integração)
      await comoUsuario(c, U);
      const m2 = await modeloInterno(c);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce43", [["integracao", true, false]]);
      const gatesSemPerm = (await um<{ r: any }>(c, `SELECT public._integracao_gates($1::uuid) AS r`, [m2.id])).r;
      expect(gatesSemPerm.modulo_bloqueado).toBe(false); // motivo é permissão, não módulo
    });
  });

  it("P-75 A: com Preço de custo marcado só integra quem VÊ custos; sem custo marcado, integra", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce11", [["integracao", true, true]]);
      const a = await assinatura(c, m.id);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m.id, a]);
      expect(e).toMatchObject({ code: "42501" });
      expect(e.message).toMatch(/^integracao_sem_custo: /);
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "preco_custo"));
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce12", [["integracao", true, false]]);
      const e2 = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      expect(e2.message).toBe("Sem permissão para editar a Integração.");
    });
  });

  it("voltar: só de integrável (P-63 A), apaga o espelho, loga; em massa é atômico", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const a = await modeloInterno(c);
      const b = await modeloInterno(c);
      await marcar(c, a.id);
      const e = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid, $2::uuid])`, [a.id, b.id]);
      expect(e.code).toBe("P0409");
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [a.id])).e).toBe("integravel");
      expect((await um<{ r: any }>(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid]) AS r`, [a.id])).r).toEqual({ voltaram: 1 });
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_linhas WHERE modelo_id = $1`, [a.id])).n).toBe("0");
      expect((await um<{ e: string; r: unknown }>(c, `SELECT estado AS e, retrato AS r FROM public.integracao_produtos WHERE modelo_id = $1`, [a.id])))
        .toEqual({ e: "nao_integravel", r: null });
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado' WHERE modelo_id = $1`, [a.id]);
      expect((await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [a.id])).message).toMatch(/^integracao_mudou: .* esta integrado$/);
    });
  });

  it("resíduos T7 #5 (T3 B): 'em massa é atômico' independe de QUAL id (bom ou ruim) é o MENOR — cobre as 2 ordens", async () => {
    // integracao_voltar re-ordena _modelo_ids por ORDER BY 1 internamente (ASC por id); o teste original acima
    // criava 'a' (bom, marcado) e 'b' (ruim) com ids aleatórios (gen_random_uuid) sem forçar as 2 ordens possíveis
    // — a asserção final (o bom permanece integravel) é sempre verdadeira por construção (a função é atômica: UMA
    // chamada = UMA transação, RAISE em qualquer ponto desfaz tudo), mas nada garantia que o teste exercitasse o
    // caminho em que o ID DO BOM é o MAIOR (ruim processado primeiro, bom nunca chega a ser tocado pelo loop) E o
    // caminho em que é o MENOR (bom processado e desfeito pelo loop, depois desfeito de novo pelo ROLLBACK
    // implícito da exceção) — ambos precisam devolver EXATAMENTE o mesmo resultado observável.
    for (const bomMenor of [true, false]) {
      await withTx(async (c) => {
        await prepara(c, 3);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        let bom = await modeloInterno(c);
        let ruim = await modeloInterno(c);
        // gera de novo até a relação de ids pedida aparecer (ids são gen_random_uuid — não há como fixar sem
        // tocar o fixture; o loop converge rápido, 50% de chance por tentativa).
        for (let tentativas = 0; (bom.id < ruim.id) !== bomMenor && tentativas < 40; tentativas++) {
          bom = await modeloInterno(c);
          ruim = await modeloInterno(c);
        }
        expect(bom.id < ruim.id).toBe(bomMenor);
        await marcar(c, bom.id);
        const e = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid, $2::uuid])`, [bom.id, ruim.id]);
        expect(e.code).toBe("P0409");
        // o bom permanece INTOCADO (integravel, espelho INTACTO com as 3 linhas do marcar: 1 produto + 2
        // variantes) e o ruim permanece nao_integravel (sem linha em integracao_produtos) — nas 2 ordens.
        const estados = await um<{ bom: string; ruim: string; linhas: string }>(c,
          `SELECT coalesce((SELECT estado FROM public.integracao_produtos WHERE modelo_id = $1), 'nao_integravel') AS bom,
                  coalesce((SELECT estado FROM public.integracao_produtos WHERE modelo_id = $2), 'nao_integravel') AS ruim,
                  (SELECT count(*)::text FROM public.integracao_linhas WHERE modelo_id = $1) AS linhas`,
          [bom.id, ruim.id]);
        expect(estados).toEqual({ bom: "integravel", ruim: "nao_integravel", linhas: "3" });
      });
    }
  });

  it("desfazer: SÓ super admin, só integrado, motivo obrigatório; log leva o retrato antigo; apaga o espelho", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      expect((await erro(c, `SELECT public.integracao_desfazer($1, 'motivo ok')`, [m.id])).message).toMatch(/Só um produto integrado/);
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1`, [m.id]);
      expect((await erro(c, `SELECT public.integracao_desfazer($1, ' x ')`, [m.id])).message).toBe("Informe o motivo (obrigatório).");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce13", [["integracao", true, true]], { tenantAdmin: true });
      expect((await erro(c, `SELECT public.integracao_desfazer($1, 'NCM errado enviado')`, [m.id])).message).toBe("Só o super admin pode fazer isto.");
      await comoUsuario(c, U);
      // Minor #4 (revisão T3): desfazer também apaga o espelho (o teste original só afirmava isso p/ voltar).
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_linhas WHERE modelo_id = $1`, [m.id])).n).not.toBe("0");
      expect((await um<{ r: any }>(c, `SELECT public.integracao_desfazer($1, 'NCM errado enviado') AS r`, [m.id])).r).toEqual({ ok: true });
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_linhas WHERE modelo_id = $1`, [m.id])).n).toBe("0");
      const ip = await um<{ e: string; mot: string; integ: unknown }>(c,
        `SELECT estado AS e, desfeito_motivo AS mot, integrado_em AS integ FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id]);
      expect(ip).toEqual({ e: "nao_integravel", mot: "NCM errado enviado", integ: null });
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'desfazer'`, [m.id]);
      expect(log.d.motivo).toBe("NCM errado enviado");
      expect(log.d.retrato.linhas[0].valores.preco_custo).toBe("62.10");
    });
  });

  it("log por papel (N11): não-super não vê campos/chaves/config; retrato do log sem custo p/ quem não vê custos; tenant admin (vê custos) idem", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1`, [m.id]);
      await c.query(`SELECT public.integracao_desfazer($1, 'motivo do teste')`, [m.id]);
      await c.query(`INSERT INTO public.integracao_log (tenant_id, acao, quem, detalhe) VALUES ($1, 'campos', 'x', '{}')`, [T]);
      const sup = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      expect(sup.linhas.map((l: any) => l.acao)).toEqual(expect.arrayContaining(["campos", "desfazer", "integrar"]));
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce14", [["integracao", true, false]]);
      const v = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      expect(v.linhas.map((l: any) => l.acao)).not.toContain("campos");
      const d = v.linhas.find((l: any) => l.acao === "desfazer");
      for (const l of d.detalhe.retrato.linhas) expect(l.valores.preco_custo).toBeNull();
      // Minor #4 (revisão T3): N11 também para um TENANT ADMIN (vê custos — caminho diferente do usuário
      // com só a permissão `integracao`, que não vê custos). tenant_admin não é super: continua sem 'campos',
      // mas o retrato do 'desfazer' mantém o custo (não mascarado), já que ele PODE ver custos.
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce15", [["integracao", true, false]], { tenantAdmin: true });
      const a = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      expect(a.super).toBe(false);
      expect(a.linhas.map((l: any) => l.acao)).not.toContain("campos");
      const da = a.linhas.find((l: any) => l.acao === "desfazer");
      expect(da.detalhe.retrato.linhas[0].valores.preco_custo).toBe("62.10");
    });
  });

  it("Minor #1 (revisão T3): _integracao_mascarar não crasha com retrato JSON null (desfazer sem retrato prévio)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      // Estado inconsistente só alcançável por escrita direta (não pelo fluxo normal): 'integrado' sem retrato.
      await c.query(
        `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato, integrado_em)
         VALUES ($1, $2, 'integrado', ARRAY['nome']::text[], NULL, now())`, [T, m.id]);
      expect((await um<{ r: any }>(c, `SELECT public.integracao_desfazer($1, 'motivo sem retrato') AS r`, [m.id])).r).toEqual({ ok: true });
      // detalhe.retrato grava jsonb_build_object(..., 'retrato', v_ip.retrato) — retrato SQL NULL vira JSON null.
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'desfazer'`, [m.id]);
      expect(log.d.retrato).toBeNull();
      // Usuário sem visão de custos lendo o log NÃO pode crashar em _integracao_mascarar('null'::jsonb).
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce16", [["integracao", true, false]]);
      const v = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      const d = v.linhas.find((l: any) => l.acao === "desfazer" && l.modelo_id === m.id);
      expect(d.detalhe.retrato).toBeNull();
    });
  });

  it.skipIf(!MIG_TXN)("Minor #2 (revisão T3): o pos-check do inverso 3 pega QUALQUER uma das 6 sobrando, não só integracao_marcar", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      // Remove o DROP de 1 das 6 funções (uma DIFERENTE de integracao_marcar, que um pos-check ingênuo de
      // "só checa 1" poderia enxergar sozinho) — mesmo padrão do Minor #7 da suíte de migration 2.
      const semDrop = ler(INVERSOS[2]).replace(
        /DROP FUNCTION IF EXISTS public\._integracao_quem\(\);\n/,
        "",
      );
      await expect(aplicarSql(c, semTravas(semDrop, "teste-minor2-t3"), "teste-minor2-t3")).rejects.toThrow(/funcao\(oes\) da migration 3 ainda existem/);
    });
  });

  it("Minor #3 (revisão T3): marcar recusa modelo_id duplicado no payload (P0001, nada marcado)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const a = await assinatura(c, m.id);
      const e = await erro(
        c,
        `SELECT public.integracao_marcar(jsonb_build_array(
           jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text),
           jsonb_build_object('modelo_id', $1::uuid, 'assinatura', 'outra-assinatura')))`,
        [m.id, a],
      );
      expect(e.code).toBe("P0001");
      expect(e.message).toMatch(/repetido/);
      // nada foi marcado: nem sequer uma linha de integracao_produtos foi criada pro modelo.
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id])).n).toBe("0");
    });
  });

  it("resíduos T7 #6 (T3 C): marcar recusa item SEM modelo_id (mensagem PRÓPRIA, não 'repetido') e duplicata por UUID em CAIXA DIFERENTE", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      // item sem modelo_id: mensagem PRÓPRIA (não reutiliza "Produto repetido na lista").
      const semId = await erro(
        c,
        `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('assinatura', 'x')))`,
        [],
      );
      expect(semId.code).toBe("P0001");
      expect(semId.message).not.toMatch(/repetido/);
      expect(semId.message).toBe("Envie o modelo_id de cada produto.");
      // 2 itens sem modelo_id: mesma mensagem (não "repetido" por acidente do count(DISTINCT NULL) = 0).
      const dois = await erro(
        c,
        `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('assinatura', 'x'), jsonb_build_object('assinatura', 'y')))`,
        [],
      );
      expect(dois.message).toBe("Envie o modelo_id de cada produto.");
      // mesmo UUID em caixa alta E baixa = MESMO produto (antes do fix, count(DISTINCT text) via ->> os contava
      // como 2 produtos diferentes e o duplicado passava batido).
      const a = await assinatura(c, m.id);
      const maiuscula = m.id.toUpperCase();
      const dup = await erro(
        c,
        `SELECT public.integracao_marcar(jsonb_build_array(
           jsonb_build_object('modelo_id', $1::text, 'assinatura', $2::text),
           jsonb_build_object('modelo_id', $3::text, 'assinatura', 'outra')))`,
        [m.id, a, maiuscula],
      );
      expect(dup.code).toBe("P0001");
      expect(dup.message).toMatch(/repetido/);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id])).n).toBe("0");
    });
  });

  it("resíduos T7 #11/#12 (fix rounds 1-2, Minor 3): marcar recusa modelo_id inválido/não-string/chave desbalanceada com P0001 (nunca 22P02) — aceita sem hifen e com as 2 chaves", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const msg = "Envie o modelo_id de cada produto.";
      const semId = await modeloInterno(c);
      const casosInvalidos: unknown[] = ["abc", "", { a: 1 }, 123,
        // ruling T7 #12 (re-review round 1, Minor 3): chave DESBALANCEADA — só abrindo ou só fechando — precisa
        // continuar dando P0001, nunca o 22P02 cru que o ::uuid dá pra chaves desbalanceadas.
        `{${semId.id}`, `${semId.id}}`];
      for (const modeloId of casosInvalidos) {
        const e = await erro(c,
          `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::jsonb, 'assinatura', 'x')))`,
          [JSON.stringify(modeloId)]);
        expect(e.code, JSON.stringify(modeloId)).toBe("P0001");
        expect(e.message, JSON.stringify(modeloId)).toBe(msg);
      }
      // formatos que o ::uuid do Postgres ACEITA (sem hifen, com as 2 chaves) precisam SEGUIR ADIANTE de verdade —
      // ruling T7 #12: a asserção antiga só checava message !== msg, que um "esperava erro" (sucesso) OU um 22P02
      // satisfazem igualmente; agora chama o RPC de verdade e confirma o efeito observável (produto marcado).
      const semHifen = await modeloInterno(c);
      const aSemHifen = await assinatura(c, semHifen.id);
      const rSemHifen = await um<{ r: any }>(c,
        `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::text, 'assinatura', $2::text))) AS r`,
        [semHifen.id.replace(/-/g, ""), aSemHifen]);
      expect(rSemHifen.r).toEqual({ marcados: 1 });
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [semHifen.id])).e)
        .toBe("integravel");

      const comChaves = await modeloInterno(c);
      const aComChaves = await assinatura(c, comChaves.id);
      const rComChaves = await um<{ r: any }>(c,
        `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::text, 'assinatura', $2::text))) AS r`,
        [`{${comChaves.id}}`, aComChaves]);
      expect(rComChaves.r).toEqual({ marcados: 1 });
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [comChaves.id])).e)
        .toBe("integravel");
    });
  });

  it("Minor #4 (revisão T3): título '(nada marcado)' — 2º item ruim aborta o 1º item bom em lote (atômico) — cobre as 2 ordens", async () => {
    // ruling do controlador, revisão T7 #10 (fix round 1, Important 1): o teste original só reordenava o PAYLOAD
    // (`[bom.id, ruim.id].sort()`), mas `integracao_marcar` re-ordena por `m.id` internamente
    // (`DISTINCT ON (m.id) ... ORDER BY m.id`, m3:114-121) — a ordem do array de entrada NÃO decide a ordem de
    // processamento. Quando `ruim.id < bom.id`, o loop processa `ruim` PRIMEIRO e dá RAISE antes mesmo de tocar
    // `bom` — "nada marcado" fica vacuamente verdadeiro (bom nunca chegou a ser processado, não "foi processado e
    // desfeito"). Mesmo padrão de retry-até-a-ordem-pedida já usado no teste de `voltar` acima (`:132`).
    for (const bomMenor of [true, false]) {
      await withTx(async (c) => {
        await prepara(c, 3);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        let bom = await modeloInterno(c);
        let ruim = await modeloInterno(c);
        for (let tentativas = 0; (bom.id < ruim.id) !== bomMenor && tentativas < 40; tentativas++) {
          bom = await modeloInterno(c);
          ruim = await modeloInterno(c);
        }
        expect(bom.id < ruim.id).toBe(bomMenor);
        const assBom = await assinatura(c, bom.id);
        // ruim: assinatura errada de propósito — dispara P0409 em algum ponto do loop, não importa qual id vem
        // primeiro (a asserção final não depende de "bom processado e desfeito" vs. "bom nunca tocado").
        const itens = [
          { modelo_id: bom.id, assinatura: assBom },
          { modelo_id: ruim.id, assinatura: "errada" },
        ];
        const e = await erro(c, `SELECT public.integracao_marcar($1::jsonb)`, [JSON.stringify(itens)]);
        expect(e.code).toBe("P0409");
        // "nada marcado": NEM o produto bom (que teria passado sozinho) foi marcado — o lote é atômico, nas 2 ordens.
        expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_produtos WHERE modelo_id IN ($1, $2) AND estado <> 'nao_integravel'`,
          [bom.id, ruim.id])).n).toBe("0");
      });
    }
  });

  it("Minor #4 (revisão T3): as 3 mensagens P0409 de marcar/voltar são ASCII em runtime (não só a 1ª)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const asciiRe = /^[\x20-\x7E]*$/;
      // 1) "ja esta %" (marcar de novo sobre integravel)
      const m1 = await modeloInterno(c);
      await marcar(c, m1.id);
      const e1 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', 'x')))`, [m1.id]);
      expect(e1.code).toBe("P0409");
      expect(asciiRe.test(e1.message)).toBe(true);
      // 2) "mudou desde o resumo" (assinatura velha)
      const m2 = await modeloInterno(c);
      const a2 = await assinatura(c, m2.id);
      await c.query(`UPDATE public.modelos SET ncm = '6109.90.00' WHERE id = $1`, [m2.id]);
      const e2 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m2.id, a2]);
      expect(e2.code).toBe("P0409");
      expect(asciiRe.test(e2.message)).toBe(true);
      // 3) "esta %" (voltar de nao_integravel)
      const m3 = await modeloInterno(c);
      const e3 = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m3.id]);
      expect(e3.code).toBe("P0409");
      expect(asciiRe.test(e3.message)).toBe(true);
    });
  });

  it("Minor #4 (revisão T3): marcar e log_listar sem a permissão 'integracao' são recusados (42501)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const a = await assinatura(c, m.id);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce17", []);
      const eMarcar = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m.id, a]);
      expect(eMarcar.code).toBe("42501");
      expect(eMarcar.message).toBe("Sem permissão para editar a Integração.");
      const eLog = await erro(c, `SELECT public.integracao_log_listar(1)`, []);
      expect(eLog.code).toBe("42501");
      expect(eLog.message).toBe("Sem permissão para ver a Integração.");
    });
  });

  it("Important #2 (revisão T3): tenant isolation — marcar/voltar/desfazer/log_listar ignoram produto de outra loja", async (ctx) => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      // ruling do controlador, revisão T7 #11 (fix round 1, Minor 1): os 2 modelos de outra loja (Ave Rara) eram
      // UUIDs FIXOS — mesma fragilidade que a T2 N3/T5 N2 removeram das suítes 2 e 5. Escolhidos EM TEMPO DE
      // EXECUÇÃO: 2 modelos DISTINTOS da própria Ave Rara (ORDER BY id, determinístico), pulando limpo se a cópia
      // não tiver pelo menos 2. Este teste só INSERE linhas próprias em integracao_produtos/integracao_linhas/
      // integracao_log para esses ids (nunca toca produtos_acabados/produtos_importados), então não há risco de
      // "ganhar um vínculo" do Minor 1 aqui — qualquer par de ids de outra loja serve.
      const candidatos = await c.query<{ id: string }>(
        `SELECT id FROM public.modelos WHERE tenant_id = $1 ORDER BY id LIMIT 2`, [AVE_RARA]);
      if (candidatos.rows.length < 2) {
        ctx.skip("cópia sem 2 modelos da Ave Rara — nada para testar");
        return;
      }
      const [foreignVoltar, foreignDesfazer] = candidatos.rows.map((r) => r.id);
      await c.query(
        `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato, assinatura, marcado_em)
         VALUES ($1, $2, 'integravel', ARRAY['nome']::text[], jsonb_build_object('linhas', '[]'::jsonb), 'x', now())`,
        [AVE_RARA, foreignVoltar],
      );
      await c.query(
        `INSERT INTO public.integracao_linhas (tenant_id, loja_nome, modelo_id, tipo, ordem) VALUES ($1, 'Ave Rara', $2, 'produto', 0)`,
        [AVE_RARA, foreignVoltar],
      );
      await c.query(
        `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato, integrado_em)
         VALUES ($1, $2, 'integrado', ARRAY['nome']::text[], jsonb_build_object('linhas', '[]'::jsonb), now())`,
        [AVE_RARA, foreignDesfazer],
      );

      // marcar: "Produto não encontrado nesta loja." e nenhuma linha nova em integracao_produtos p/ esse id.
      const eMarcar = await erro(
        c,
        `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', 'x')))`,
        [foreignVoltar],
      );
      expect(eMarcar.message).toBe("Produto não encontrado nesta loja.");
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_produtos WHERE modelo_id = $1 AND tenant_id = $2`,
        [foreignVoltar, T])).n).toBe("0");

      // voltar: P0409 (o filtro por tenant faz o LEFT JOIN não achar a linha => estado 'nao_integravel' => P0409),
      // e a linha estrangeira PERMANECE integravel com o espelho intacto.
      const eVoltar = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [foreignVoltar]);
      expect(eVoltar.code).toBe("P0409");
      const foreignIp = await um<{ e: string; n: string }>(
        c,
        `SELECT ip.estado AS e, (SELECT count(*)::text FROM public.integracao_linhas l WHERE l.modelo_id = ip.modelo_id) AS n
           FROM public.integracao_produtos ip WHERE ip.modelo_id = $1`,
        [foreignVoltar],
      );
      expect(foreignIp).toEqual({ e: "integravel", n: "1" });

      // desfazer: P0001 (o filtro x.tenant_id = v_tenant faz NOT FOUND) e a linha estrangeira SEGUE integrado.
      const eDesfazer = await erro(c, `SELECT public.integracao_desfazer($1, 'tentativa cross-tenant')`, [foreignDesfazer]);
      expect(eDesfazer.code).toBe("P0001");
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [foreignDesfazer])).e)
        .toBe("integrado");

      // resíduos T7 #4 (T3 A): torna o teste de isolamento do log_listar NÃO-vacuoso — insere uma linha de log de
      // OUTRA loja (Ave Rara) e OUTRA da PRÓPRIA loja (T) dentro da txn, e confere que só a de T aparece, com o
      // total batendo com a contagem REAL (não um 0 vazio de coincidência).
      // ruling do controlador, revisão T7 #11 (fix round 1, Minor 2): (a) `total = 1`/`toHaveLength(1)` supunham
      // o log da Loja Teste vazio — a suíte também roda contra uma cópia com migrations JÁ aplicadas
      // ("ou aplique na cópia", integracao-helpers.ts), onde linhas reais preexistem e o teste quebraria; agora o
      // total é comparado com a contagem REAL (sem pin no valor absoluto); (b) `totalReal` filtrava por
      // `acao IN (...)` — o predicado de NÃO-super — mas `U` é super_admin, e `log_listar` conta TODAS as ações
      // pra super (m3:249: `v_super OR l.acao IN (...)`); sem filtro de `acao` nenhum aqui, espelhando o caminho
      // super que o teste de fato exercita.
      const foreignLog = await um<{ id: string }>(c,
        `INSERT INTO public.integracao_log (tenant_id, acao, quem, modelo_id, modelo_nome, detalhe)
         VALUES ($1, 'integrar', 'outra loja', $2, 'Produto de outra loja', '{}'::jsonb) RETURNING id`,
        [AVE_RARA, foreignVoltar],
      );
      const minhaLinha = await modeloInterno(c);
      const meuLog = await um<{ id: string }>(c,
        `INSERT INTO public.integracao_log (tenant_id, acao, quem, modelo_id, modelo_nome, detalhe)
         VALUES ($1, 'integrar', 'eu', $2, 'Meu produto', '{}'::jsonb) RETURNING id`,
        [T, minhaLinha.id],
      );
      const totalReal = await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM public.integracao_log WHERE tenant_id = $1`, [T]);
      const meu = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      expect(meu.total).toBe(Number(totalReal.n));
      const ids: string[] = meu.linhas.map((l: any) => l.id);
      expect(ids).toContain(meuLog.id);
      expect(ids).not.toContain(foreignLog.id);
    });
  });

  it("Important #1 (revisão T3): marcar serializa com o MESMO advisory lock dos gravadores de SKU (sku_modelo:<id>)", async () => {
    const segunda = new Client({ connectionString: dbUrl()!, ssl: SSL });
    await segunda.connect();
    try {
      await withTx(async (c) => {
        await prepara(c, 3);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        const m = await modeloInterno(c);
        const a = await assinatura(c, m.id);

        // A 2ª conexão prende a MESMA chave que os gravadores de SKU usam de verdade
        // (_aplicar_skus_modelo_core/_gerar_skus_modelo_core/_salvar_sku_manual_core, conferido no read-only
        // da cópia: pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0))) — simula
        // um Regerar/Salvar em andamento no exato instante em que marcar tentaria integrar o mesmo produto.
        await segunda.query("BEGIN");
        await segunda.query(`SELECT pg_advisory_xact_lock(hashtextextended('sku_modelo:' || $1::text, 0))`, [m.id]);

        // marcar deve ficar esperando o MESMO advisory lock — com lock_timeout curto, estoura 55P03 (mesmo
        // mecanismo/código de um lock de linha, ver comentário de kanban-auto.test.ts) em vez de prosseguir.
        await c.query("SET LOCAL lock_timeout = '300ms'");
        await c.query("SAVEPOINT trava_sku");
        let travou = false;
        try {
          await marcar(c, m.id, a);
        } catch (e: any) {
          travou = e.code === "55P03";
          await c.query("ROLLBACK TO SAVEPOINT trava_sku");
        }
        expect(travou).toBe(true);
        // nada foi marcado enquanto a 2ª conexão segurava a trava.
        expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_produtos WHERE modelo_id = $1 AND estado <> 'nao_integravel'`, [m.id])).n)
          .toBe("0");

        // solta a trava da 2ª conexão — agora marcar (com lock_timeout normal de novo) segue em frente.
        await segunda.query("ROLLBACK");
        await c.query("SET LOCAL lock_timeout = '500ms'");
        expect(await marcar(c, m.id, a)).toEqual({ marcados: 1 });
      });
    } finally {
      await segunda.end();
    }
  });

  it.skipIf(!MIG_TXN)("inverso 3 desfaz a 3 (6 funções somem)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await aplica(c, INVERSOS[2]);
      const r = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('_integracao_quem','_integracao_logar','integracao_marcar','integracao_voltar','integracao_desfazer','integracao_log_listar')`);
      expect(r.n).toBe("0");
    });
  });
});
