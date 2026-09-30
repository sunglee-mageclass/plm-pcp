/** Integração + API — migration 4 (trava §8, foto WHEN, B1). Plano Task 4. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import type { Client as ClientType } from "pg";
import { hasDb, withTx, comoUsuario, um, dbUrl } from "./db";
import {
  CAMPOS_PADRAO, DEF, INVERSOS, LAYOUT, LOCAL, MD5_ANTES, MIG_TXN, MIGRACOES, T, U, aplica, camposLoja, imediato, importado, keywordsLoja,
  ler, modeloInterno, prepara, revenda,
} from "./integracao-helpers";

const SSL = false; // cópia local, sem SSL — mesmo padrão de integracao-3-estados.test.ts/kanban-auto.test.ts

/**
 * LIFO com a 20261018100000 (Preço anterior/Título por versão): no modo INTEGRACAO_MIG_TXN o `prepara` volta essa migration DENTRO
 * da txn antes da 20261013100000 — e o inverso dela tira o gatilho de captura de `modelos` (DROP TRIGGER = AccessExclusive em
 * `modelos` até o fim da txn do teste). Os 2 testes "REAL 2 conexões" abaixo precisam que a 2ª conexão prenda uma linha de
 * `modelos`, o que fica impossível nesse estado. Eles provam a trava da migration 4 (que a 20261018 não toca) e continuam
 * rodando no modo padrão (migrations já na cópia) — só são pulados no modo txn com a 20261018 na cópia.
 */
async function precoVersaoNaCopia(): Promise<boolean> {
  if (!hasDb || !LOCAL || !MIG_TXN) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: SSL });
  await c.connect();
  try {
    return (await c.query("SELECT to_regprocedure('public._modelo_versao_anterior(uuid)') IS NOT NULL AS ok")).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const PULA_2_CONEXOES = await precoVersaoNaCopia();

/** Trecho inserido nos 2 recálculos (diff mínimo — o "depois" menos ISTO é o "antes"). */
export const TRECHO_B1 =
  "  -- [integracao v1] B1: produto travado pela Integração com \"Preço de venda\" marcado — o recálculo automático (OC, MO,\n" +
  "  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.\n" +
  "  if public._integracao_campo_travado(v_modelo_id, 'preco_venda') then\n" +
  "    v_preco_venda := v_venda_atual;\n" +
  "  end if;\n" +
  "\n";

async function marcar(c: ClientType, id: string): Promise<void> {
  const a = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
  await c.query(`SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [id, a]);
}
async function falha(c: ClientType, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT f");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT f");
    return "PASSOU";
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT f");
    return `${e.code} ${e.message}`;
  }
}
/**
 * ruling do controlador, T8 ensaio #1: a migration 5 (mão dupla nome/REF, trg_modelo_espelho_nome_ref /
 * trg_espelho_modelo_nome_ref) é INCONDICIONAL de propósito (P-88 A) — com as 6 migrations aplicadas de
 * verdade, um UPDATE cru em modelos.nome não fica mais divergente do produto espelho: o gatilho resincroniza
 * na MESMA transação, antes que _integracao_retrato_core consiga observar a falta "Nome diferente". A falta
 * continua necessária para divergência que já existe em DADO LEGADO (linhas gravadas antes desta migration
 * existir) ou por um caminho fora do gatilho — não para um UPDATE feito hoje com o gatilho ativo. Este helper
 * reproduz esse cenário legado: desliga os 2 gatilhos (se existirem — a suíte pode rodar isolada, só 1..4, ou
 * contra a cópia com as 6 aplicadas de verdade; `to_regclass`/`pg_trigger` decide em runtime), roda `fn` (que
 * cria a divergência sem nenhum gatilho interferindo) e SEMPRE religa antes de devolver — mesmo se `fn` (ou uma
 * asserção dentro dela) lançar. Um savepoint isola a fase de checagem/disable de qualquer erro anterior.
 */
async function comMirrorDesligado(c: ClientType, tabelaEspelho: "produtos_acabados" | "produtos_importados", fn: () => Promise<void>): Promise<void> {
  await c.query("SAVEPOINT mirror_check");
  const existe = (await um<{ m: boolean; e: boolean }>(
    c,
    `SELECT
       EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                WHERE c.relname = 'modelos' AND t.tgname = 'trg_modelo_espelho_nome_ref' AND NOT t.tgisinternal) AS m,
       EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                WHERE c.relname = $1 AND t.tgname = 'trg_espelho_modelo_nome_ref' AND NOT t.tgisinternal) AS e`,
    [tabelaEspelho],
  ));
  await c.query("RELEASE SAVEPOINT mirror_check");
  const disable = existe.m && existe.e;
  if (disable) {
    await c.query(`ALTER TABLE public.${tabelaEspelho} DISABLE TRIGGER trg_espelho_modelo_nome_ref`);
    await c.query(`ALTER TABLE public.modelos DISABLE TRIGGER trg_modelo_espelho_nome_ref`);
  }
  try {
    await fn();
  } finally {
    if (disable) {
      await c.query(`ALTER TABLE public.${tabelaEspelho} ENABLE TRIGGER trg_espelho_modelo_nome_ref`);
      await c.query(`ALTER TABLE public.modelos ENABLE TRIGGER trg_modelo_espelho_nome_ref`);
    }
  }
}
const CASOS: Array<[campo: string, set: string]> = [
  ["nome", "nome = nome || ' X'"], ["ref_sku", "ref = ref || 'X'"], ["preco_anterior", "preco_anterior = 1"],
  ["preco_venda", "preco_venda = 1"], ["peso", "peso_kg = 1"], ["ncm", "ncm = '0000.00.00'"], ["titulo", "titulo_pagina = 'x'"],
  ["descricao", "descricao_produto = 'x'"], ["comprimento", "comprimento_cm = 1"], ["largura", "largura_cm = 1"],
  ["altura", "altura_cm = 1"],
];

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 4: trava", () => {
  it("cada campo MARCADO trava (42501 integracao_travado: <campo>); Tamanho em e SKUs SEMPRE; não marcado fica livre", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await camposLoja(c, LAYOUT);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      for (const [campo, set] of CASOS) {
        expect(await falha(c, `UPDATE public.modelos SET ${set} WHERE id = $1`, [m.id]), campo).toBe(`42501 integracao_travado: ${campo}`);
      }
      expect(await falha(c, `UPDATE public.modelos SET fotos_modelo = '{}' WHERE id = $1`, [m.id])).toBe("42501 integracao_travado: foto");
      expect(await falha(c, `UPDATE public.modelos SET tamanho_tipo = 'numero' WHERE id = $1`, [m.id])).toBe("42501 integracao_travado: tamanho_tipo");
      expect(await falha(c, `UPDATE public.modelo_skus SET sku = sku || 'X' WHERE modelo_id = $1`, [m.id])).toBe("42501 integracao_travado: sku");
      expect(await falha(c, `DELETE FROM public.modelo_skus WHERE modelo_id = $1`, [m.id])).toBe("42501 integracao_travado: sku");
      expect(await falha(c, `UPDATE public.modelo_skus SET sku = sku WHERE modelo_id = $1`, [m.id])).toBe("PASSOU");
      // não marcado: volta, desmarca NCM, marca de novo — NCM fica livre, nome não
      await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "ncm"));
      await marcar(c, m.id);
      expect(await falha(c, `UPDATE public.modelos SET ncm = '0000.00.00' WHERE id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelos SET fotos_modelo = '{}' WHERE id = $1`, [m.id])).toBe("PASSOU"); // Foto não marcada
    });
  });

  it("save do Sheet do Dev SEM mudança passa (R9); BOM, grade, CAD e produção seguem livres (P-62 A)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      expect(await falha(c, `UPDATE public.modelos SET nome = nome, ref = ref, fotos_modelo = fotos_modelo, tamanho_tipo = tamanho_tipo,
        observacoes_tecnicas = 'obs nova', status_desenvolvimento = status_desenvolvimento WHERE id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelo_tecidos SET consumo = 1.5 WHERE modelo_id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelo_grades SET grades = '{"38|P": 9, "40|M": 3}' WHERE modelo_id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelos SET custo_peca_previsto = 99 WHERE id = $1`, [m.id])).toBe("PASSOU");
    });
  });

  it("UPDATE direto via REST (authenticated), até de super admin, é recusado; DELETE do produto travado é recusado", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      await c.query("SAVEPOINT r");
      await c.query("SET LOCAL ROLE authenticated");
      await expect(c.query(`UPDATE public.modelos SET nome = 'hack' WHERE id = $1`, [m.id])).rejects.toThrow(/integracao_travado: nome/);
      await c.query("ROLLBACK TO SAVEPOINT r");
      expect(await falha(c, `DELETE FROM public.modelos WHERE id = $1`, [m.id])).toBe("42501 integracao_travado: excluir");
      await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      expect(await falha(c, `DELETE FROM public.modelos WHERE id = $1`, [m.id])).toBe("PASSOU");
    });
  });

  it("revenda travada: excluir produto espelho recusado; nome/REF/preço fixo explícito recusados; limpar o fixo passa (D12)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      await marcar(c, m.id);
      expect(await falha(c, `SELECT public.excluir_produto_acabado($1)`, [m.produtoId])).toBe("42501 integracao_travado: excluir");
      expect(await falha(c, `UPDATE public.produtos_acabados SET nome = nome || ' X' WHERE id = $1`, [m.produtoId])).toBe("42501 integracao_travado: nome");
      expect(await falha(c, `UPDATE public.produtos_acabados SET ref = ref || 'X' WHERE id = $1`, [m.produtoId])).toBe("42501 integracao_travado: ref_sku");
      expect(await falha(c, `UPDATE public.produtos_acabados SET modelo_id = NULL WHERE id = $1`, [m.produtoId])).toBe("42501 integracao_travado: vinculo");
      expect(await falha(c, `SELECT public.salvar_precos_fixo_produto_acabado($1, false, NULL, true, 199)`, [m.produtoId]))
        .toBe("42501 integracao_travado: preco_venda");
      expect(await falha(c, `SELECT public.salvar_markups_produto_acabado($1, NULL, 4)`, [m.produtoId])).toBe("PASSOU");
      expect((await um<{ p: string }>(c, `SELECT preco_venda::text AS p FROM public.modelos WHERE id = $1`, [m.id])).p).toBe("159.90");
    });
  });

  it("G8 (ruling do controlador, G-migration fix 1 · B-M7): produto de OUTRA loja vinculado a um card não lê/trava esse card (sem vazar 1 bit)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      // produtos_acabados TEM trg_pa_modelo_tenant (enforce_produto_acabado_modelo_tenant) — vínculo cruzado é
      // BLOQUEADO pelo próprio schema para revenda; confirmamos isso primeiro (prova negativa exigida pelo brief).
      const outroCard = await um<{ id: string; tenant_id: string }>(c,
        `SELECT id, tenant_id FROM public.modelos WHERE tenant_id <> $1 LIMIT 1`, [T]);
      expect(outroCard.tenant_id).not.toBe(T);
      const revendaMesmaLoja = await revenda(c);
      const bloqueado = await falha(c, `UPDATE public.produtos_acabados SET modelo_id = $2 WHERE id = $1`,
        [revendaMesmaLoja.produtoId, outroCard.id]);
      expect(bloqueado).toMatch(/Modelo de outra loja/);

      // ruling do controlador, G-migration fix 2 #H1 (A-d1 + B-DI-1): produtos_importados GANHOU o mesmo guard
      // (trg_pi_modelo_tenant, reusa enforce_produto_acabado_modelo_tenant) — o vínculo cruzado que antes era
      // possível (gap T5 #3) agora é BLOQUEADO igual à revenda.
      // ruling do controlador, G-migration fix 3 #J5 (d2-M1): o comentário ANTIGO aqui dizia que a metade
      // "espelho" do G8 (fn_integracao_trava_espelho/_variantes não LER nem TRAVAR o card de outra loja quando o
      // tenant não bate) "ficava coberta pelo teste dedicado H1", mas os testes H1/H5 só provam a RECUSA do
      // vínculo (o UPDATE/INSERT nunca chegam a existir) — nenhum deles exercita o código de skip DENTRO das 2
      // funções de trava, porque elas só rodam quando já existe um modelo_id vinculado. Corrigido: o teste
      // dedicado "J5" abaixo constrói o vínculo cruzado DENTRO da própria txn via DISABLE TRIGGER (o mesmo
      // recurso que os testes de mão dupla da suíte 5 já usam), com try/finally garantindo o ENABLE em todos os
      // caminhos (inclusive se uma asserção falhar no meio).
      const imp = await importado(c);
      const bloqueadoImp = await falha(c, `UPDATE public.produtos_importados SET modelo_id = $2 WHERE id = $1`,
        [imp.produtoId, outroCard.id]);
      expect(bloqueadoImp).toMatch(/Modelo de outra loja/);
    });
  });

  it("J5 (ruling do controlador, G-migration fix 3 · d2-M1): com o vinculo cruzado montado DENTRO da txn (DISABLE TRIGGER), fn_integracao_trava_espelho/_variantes pulam por inteiro — o card da OUTRA loja nao e lido nem travado", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      // outroCard precisa ser um card SEM produto espelho já vinculado (senão o UPDATE de modelo_id esbarraria na
      // invariante 1:1 de enforce_unique_fk ANTES de chegar em fn_integracao_trava_espelho — não é o que este
      // teste quer provar).
      const outroCard = await um<{ id: string; tenant_id: string; nome: string; ref: string | null }>(c,
        `SELECT m.id, m.tenant_id, m.nome::text AS nome, m.ref::text AS ref FROM public.modelos m
          WHERE m.tenant_id <> $1
            AND NOT EXISTS (SELECT 1 FROM public.produtos_acabados pa WHERE pa.modelo_id = m.id)
            AND NOT EXISTS (SELECT 1 FROM public.produtos_importados pi WHERE pi.modelo_id = m.id)
          ORDER BY m.id LIMIT 1`, [T]);
      expect(outroCard.tenant_id).not.toBe(T);
      const revendaCruzada = await revenda(c);
      const importadoCruzado = await importado(c);
      let ligados = false;
      try {
        // Monta o vínculo cruzado DENTRO da txn, por FORA do guard (trg_pa_modelo_tenant/trg_pi_modelo_tenant) —
        // única forma de reproduzir hoje o cenário que fn_integracao_trava_espelho precisa saber pular (a causa
        // raiz do vínculo em si foi fechada pelo H1; isto é só para exercitar a checagem de tenant DENTRO da
        // trava, que continua no código como defesa em profundidade).
        await c.query(`ALTER TABLE public.produtos_acabados DISABLE TRIGGER trg_pa_modelo_tenant`);
        await c.query(`ALTER TABLE public.produtos_importados DISABLE TRIGGER trg_pi_modelo_tenant`);
        ligados = true;
        await c.query(`UPDATE public.produtos_acabados SET modelo_id = $2 WHERE id = $1`, [revendaCruzada.produtoId, outroCard.id]);
        await c.query(`UPDATE public.produtos_importados SET modelo_id = $2 WHERE id = $1`, [importadoCruzado.produtoId, outroCard.id]);
        // Marca os 2 produtos como 'integravel' com variantes_chaves preenchido DIRETO (sem passar por
        // integracao_marcar/_integracao_gates, que reconfeririam o vínculo) — só para dar a fn_integracao_trava_*
        // algo para "ler" caso o guard de tenant não pulasse antes do FOR SHARE.
        const chaveRevenda = (await um<{ k: string }>(c,
          `SELECT public._sku_variante_key(cor_id, cor_apelido_id)::text AS k FROM public.produto_acabado_variantes WHERE produto_acabado_id = $1`,
          [revendaCruzada.produtoId])).k;
        const chaveImportado = (await um<{ k: string }>(c,
          `SELECT public._sku_variante_key(cor_id, cor_apelido_id)::text AS k FROM public.produto_importado_variantes WHERE produto_importado_id = $1`,
          [importadoCruzado.produtoId])).k;
        await c.query(
          `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, variantes_chaves)
           VALUES ($1, $2, 'integravel', ARRAY['nome'], ARRAY[$3]::uuid[])`,
          [T, revendaCruzada.id, chaveRevenda]);
        await c.query(
          `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, variantes_chaves)
           VALUES ($1, $2, 'integravel', ARRAY['nome'], ARRAY[$3]::uuid[])`,
          [T, importadoCruzado.id, chaveImportado]);

        // fn_integracao_trava_espelho: renomear/trocar REF nos 2 produtos (que teriam campos travados se a trava
        // LESSE o card errado) NÃO estoura 42501 — a checagem de tenant (OLD.tenant_id do produto vs. tenant_id
        // do card apontado) pula ANTES do FOR SHARE/SELECT em integracao_produtos.
        expect(await falha(c, `UPDATE public.produtos_acabados SET nome = nome || ' Z' WHERE id = $1`, [revendaCruzada.produtoId])).toBe("PASSOU");
        expect(await falha(c, `UPDATE public.produtos_importados SET nome = nome || ' Z' WHERE id = $1`, [importadoCruzado.produtoId])).toBe("PASSOU");
        // fn_integracao_trava_variantes: trocar a cor da variante (que teria o conjunto travado se a trava LESSE
        // variantes_chaves do card errado) também NÃO estoura, e o CONSTRAINT TRIGGER adiado (imediato()) confirma.
        const outraCor = (await um<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Cor J5') RETURNING id`, [T])).id;
        await c.query(`UPDATE public.produto_acabado_variantes SET cor_id = $2 WHERE produto_acabado_id = $1`, [revendaCruzada.produtoId, outraCor]);
        await c.query(`UPDATE public.produto_importado_variantes SET cor_id = $2 WHERE produto_importado_id = $1`, [importadoCruzado.produtoId, outraCor]);
        await expect(imediato(c)).resolves.not.toThrow();

        // O card de OUTRA loja não foi lido/travado: nome/REF continuam intocados (a trava nunca chegou a olhar
        // pra ele — se tivesse lido, o FOR SHARE não muda dado, mas um bug de leitura cruzada apareceria como
        // exceção nas linhas acima, já que o card de outra loja nunca teve integracao_produtos vinculada a ele).
        const cardDepois = await um<{ nome: string; ref: string | null }>(c,
          `SELECT nome::text AS nome, ref::text AS ref FROM public.modelos WHERE id = $1`, [outroCard.id]);
        expect(cardDepois.nome).toBe(outroCard.nome);
        expect(cardDepois.ref).toBe(outroCard.ref);
      } finally {
        if (ligados) {
          await c.query(`ALTER TABLE public.produtos_acabados ENABLE TRIGGER trg_pa_modelo_tenant`);
          await c.query(`ALTER TABLE public.produtos_importados ENABLE TRIGGER trg_pi_modelo_tenant`);
        }
      }
    });
  });

  it.skipIf(!MIG_TXN)("K3 (ruling do controlador, G-migration fix 4): linha de integracao_produtos INSERIDA para o card da OUTRA loja prova o RED sem a checagem de tenant antes do FOR SHARE", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      const outroCard = await um<{ id: string; tenant_id: string; nome: string } | undefined>(c,
        `SELECT id, tenant_id, nome::text AS nome FROM public.modelos m WHERE tenant_id <> $1
           AND NOT EXISTS (SELECT 1 FROM public.produtos_acabados pa WHERE pa.modelo_id = m.id)
         ORDER BY id LIMIT 1`, [T]);
      if (!outroCard) return; // skip limpo se a cópia não tiver nenhum modelo de outra loja sem produto espelho
      expect(outroCard.tenant_id).not.toBe(T);
      const rv = await revenda(c);
      let ligado = false;
      try {
        // Vincula o produto da loja de teste ao card de OUTRA loja (só possível por fora do guard, que o H1 já
        // fecha na origem — mesmo recurso do teste J5/H4).
        await c.query(`ALTER TABLE public.produtos_acabados DISABLE TRIGGER trg_pa_modelo_tenant`);
        ligado = true;
        await c.query(`UPDATE public.produtos_acabados SET modelo_id = $2 WHERE id = $1`, [rv.produtoId, outroCard.id]);

        // K3: insere a linha de integracao_produtos para o CARD DA OUTRA LOJA em si — (tenant_id = T, modelo_id =
        // outroCard.id) — o mesmo "1 bit vazado" que o G8/G-migration fix 1 documentou: a tabela não tem NENHUM
        // vínculo (FK/trigger) forçando integracao_produtos.tenant_id a bater com modelos.tenant_id do modelo_id
        // referenciado, então uma linha dessas É POSSÍVEL de existir (mesmo que nenhum caminho hoje a crie de
        // propósito — é a MESMA classe de gap que H1 fechou para modelo_id nos produtos, mas para integracao_
        // produtos não há guard nenhum).
        await c.query(
          `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos) VALUES ($1, $2, 'integravel', ARRAY['nome'])`,
          [T, outroCard.id]);

        // GREEN (código real, com a checagem de tenant intacta em fn_integracao_trava_espelho): renomear o produto
        // (que teria 'nome' travado SE a trigger lesse essa linha) PASSA — a checagem de tenant (ANTES do FOR
        // SHARE) vê que outroCard.tenant_id != rv (produto).tenant_id e pula por inteiro, sem nunca chegar ao
        // SELECT que acharia essa linha.
        expect(await falha(c, `UPDATE public.produtos_acabados SET nome = nome || ' Z' WHERE id = $1`, [rv.produtoId])).toBe("PASSOU");

        // RED: remove SÓ a checagem de tenant (o bloco "IF NOT EXISTS (...) THEN ... RETURN; END IF;" logo antes
        // do FOR SHARE) do texto de fn_integracao_trava_espelho — mutação por regex no texto lido do arquivo,
        // aplicada nesta txn via aplicarSql/semTravas (nunca editando o arquivo em si; mesmo padrão dos testes
        // "Minor #7"/G9/J1-RED desta suíte). Sem a checagem, o FOR SHARE e o SELECT seguinte rodam incondicional-
        // mente sobre OLD.modelo_id — como o SELECT ainda filtra por ip.tenant_id = OLD.tenant_id (o tenant do
        // PRODUTO, que é T), a linha K3 (tenant_id=T, modelo_id=outroCard.id) É achada, e o rename trava.
        const original = ler(MIGRACOES[3]);
        const semChecagemEspelho = original.replace(
          /  IF NOT EXISTS \(SELECT 1 FROM public\.modelos WHERE id = OLD\.modelo_id AND tenant_id = OLD\.tenant_id\) THEN\n    IF TG_OP = 'DELETE' THEN\n      RETURN OLD;\n    END IF;\n    RETURN NEW;\n  END IF;\n/,
          "",
        );
        expect(semChecagemEspelho).not.toBe(original); // confere que o regex casou de verdade
        // Extrai só a redefinição de fn_integracao_trava_espelho (CREATE OR REPLACE FUNCTION ... AS $function$ ...
        // $function$;) do texto mutado e reaplica por cima da versão já carregada por prepara(c, 4) — não precisa
        // reaplicar a migration 4 inteira (evita recriar tabelas/gatilhos já existentes na mesma txn).
        const defMatch = semChecagemEspelho.match(
          /CREATE OR REPLACE FUNCTION public\.fn_integracao_trava_espelho\(\)[\s\S]*?\$function\$;/,
        );
        if (!defMatch) throw new Error("nao achei a definicao de fn_integracao_trava_espelho no texto mutado");
        await c.query(defMatch[0]);

        expect(await falha(c, `UPDATE public.produtos_acabados SET nome = nome || ' Z2' WHERE id = $1`, [rv.produtoId]))
          .toMatch(/^42501 integracao_travado: nome/);
      } finally {
        if (ligado) {
          await c.query(`ALTER TABLE public.produtos_acabados ENABLE TRIGGER trg_pa_modelo_tenant`);
        }
        // Restaura a definição ORIGINAL da função (com a checagem de tenant) antes do withTx desfazer a txn — não
        // é estritamente necessário (a txn inteira é revertida), mas evita qualquer efeito residual caso um savepoint
        // externo mude esse comportamento no futuro. A extração usa o mesmo regex de match do arquivo real (fonte
        // única, sem redigitar).
        const defOriginal = ler(MIGRACOES[3]).match(
          /CREATE OR REPLACE FUNCTION public\.fn_integracao_trava_espelho\(\)[\s\S]*?\$function\$;/,
        );
        if (defOriginal) await c.query(defOriginal[0]).catch(() => {});
      }
    });
  });

  it("H1 (ruling do controlador, G-migration fix 2 · A-d1 + B-DI-1): trg_pi_modelo_tenant recusa vinculo cruzado; foto/preco nao escrevem no card de outra loja", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const outroCard = await um<{ id: string; tenant_id: string; nome: string }>(c,
        `SELECT id, tenant_id, nome::text AS nome FROM public.modelos WHERE tenant_id <> $1 ORDER BY id LIMIT 1`, [T]);
      expect(outroCard.tenant_id).not.toBe(T);

      // (a) UPDATE de modelo_id pra outra loja é recusado — mesma mensagem/guard de produtos_acabados
      const imp = await importado(c);
      const bloqueado = await falha(c, `UPDATE public.produtos_importados SET modelo_id = $2 WHERE id = $1`,
        [imp.produtoId, outroCard.id]);
      expect(bloqueado).toMatch(/Modelo de outra loja não pode ser vinculado aqui\./);
      // nada foi vinculado
      expect((await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM public.produtos_importados WHERE id = $1 AND modelo_id = $2`,
        [imp.produtoId, outroCard.id])).n).toBe(0);

      // (b) INSERT com modelo_id de outra loja também é recusado (mesmo guard, BEFORE INSERT)
      const bloqueadoInsert = await falha(c,
        `INSERT INTO public.produtos_importados (tenant_id, nome, ref, moeda_compra, valor_unitario_m1, cotacao_ref,
                cotacao_final, qtd_total, markup_varejo, modelo_id)
         VALUES ($1, 'PI cross-tenant', 'PICROSS1', 'USD', 10, 1, 5, 5, 3, $2)`, [T, outroCard.id]);
      expect(bloqueadoInsert).toMatch(/Modelo de outra loja não pode ser vinculado aqui\./);

      // (c) MESMA loja continua funcionando (o guard não regride o caso normal)
      const mesmaLoja = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET origem = 'importado' WHERE id = $1`, [mesmaLoja.id]);
      const okMesmaLoja = await falha(c, `UPDATE public.produtos_importados SET modelo_id = $2 WHERE id = $1`,
        [imp.produtoId, mesmaLoja.id]);
      expect(okMesmaLoja).toBe("PASSOU");
    });
  });

  it("H1/H5 (ruling do controlador, G-migration fix 2): com o vinculo cruzado agora bloqueado, prova a recusa (nao ha mais como reproduzir o vazamento do espelho por essa via)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const outroCard = await um<{ id: string; tenant_id: string; fotos: string[]; preco: string | null }>(c,
        `SELECT id, tenant_id, fotos_modelo AS fotos, preco_venda::text AS preco FROM public.modelos WHERE tenant_id <> $1 ORDER BY id LIMIT 1`, [T]);
      // H5: a metade "variantes" do G8 não provava nada de verdade (falha() não chama imediato(); variantes_chaves
      // NULL já dava CONTINUE). Prova de verdade: com H1 fechando a causa raiz, a ÚNICA forma de exercitar o
      // caminho de escrita (foto/preço) seria já ter um vínculo cruzado — que H1 agora impede de nascer. Prova a
      // recusa do vínculo (nem UPDATE nem INSERT criam a ponte) E que o estado do card de outra loja não mudou
      // com a tentativa (UPDATE inteiro desfeito pelo BEFORE trigger — nenhuma coluna é tocada, nem foto_url).
      const imp = await importado(c);
      const r = await falha(c, `UPDATE public.produtos_importados SET modelo_id = $2, foto_url = $3 WHERE id = $1`,
        [imp.produtoId, outroCard.id, `${T}/fotos_modelo/x.jpg`]);
      expect(r).toMatch(/Modelo de outra loja não pode ser vinculado aqui\./);
      const cardDepois = await um<{ fotos: string[]; preco: string | null }>(c,
        `SELECT fotos_modelo AS fotos, preco_venda::text AS preco FROM public.modelos WHERE id = $1`, [outroCard.id]);
      expect(cardDepois.fotos).toEqual(outroCard.fotos);
      expect(cardDepois.preco).toBe(outroCard.preco);
      // _imp_recomputar_precos_modelo no produto (modelo_id continua NULL — o UPDATE acima foi revertido) não
      // toca NENHUM card (v_modelo_id NULL = early return no código, confirmado por leitura)
      expect(await falha(c, `SELECT public._imp_recomputar_precos_modelo($1)`, [imp.produtoId])).toBe("PASSOU");
      const cardFinal = await um<{ preco: string | null }>(c, `SELECT preco_venda::text AS preco FROM public.modelos WHERE id = $1`, [outroCard.id]);
      expect(cardFinal.preco).toBe(outroCard.preco);
    });
  });

  it("B1: recálculo automático (markup, MO, receber OC) NÃO mexe no preço de venda travado; o atacado segue", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      await marcar(c, m.id);
      await c.query(`UPDATE public.produtos_acabados SET markup_atacado = 2 WHERE id = $1`, [m.produtoId]);
      expect(await falha(c, `SELECT public._pa_recomputar_precos_modelo($1)`, [m.produtoId])).toBe("PASSOU");
      expect(await um(c, `SELECT preco_venda::text AS v, preco_atacado::text AS a FROM public.modelos WHERE id = $1`, [m.id]))
        .toEqual({ v: "159.90", a: "80.00" });
      expect(await falha(c, `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, valor) VALUES ($1, $2, 5)`, [T, m.id])).toBe("PASSOU");
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe("159.90");
      const oc = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id, qtd_total, valor_unitario, valor_unitario_real,
                grade_detalhe) VALUES ($1, 'OC teste', $2, 5, 45, 45, '{"1": {"38|P": {"pedida": 2, "recebida": 2, "defeito": 0}}}')
         RETURNING id`, [T, m.produtoId])).id;
      expect(await falha(c, `SELECT public.receber_oc_p_acabado($1, '{}'::jsonb, NULL)`, [oc])).toBe("PASSOU");
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe("159.90");
    });
  });

  it("revisão T4 #1 (Important #1, ruling do controlador — opção b): nome do card diferente do Produto Acabado vira falta e marcar recusa; nomes iguais marca normal; save sem mudar nada passa", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      // ruling do controlador (T8 ensaio #1): renomeia SÓ o card, reproduzindo uma divergência de DADO LEGADO
      // (linha gravada antes da mão dupla da migration 5 existir, ou por um caminho fora do gatilho) — com o
      // gatilho trg_modelo_espelho_nome_ref/trg_espelho_modelo_nome_ref ATIVO (P-88 A, incondicional por
      // desenho), este UPDATE cru seria resincronizado na mesma transação e a divergência nunca existiria de
      // fato; desligamos os 2 lados só durante a criação do dado divergente (comMirrorDesligado é no-op se as 6
      // migrations não estiverem todas aplicadas, ex. suíte isolada em 1..4).
      await comMirrorDesligado(c, "produtos_acabados", async () => {
        await c.query(`UPDATE public.modelos SET nome = nome || ' renomeado' WHERE id = $1`, [m.id]);
      });
      const previa = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id])).r.produtos[0];
      expect(previa.completo).toBe(false);
      expect(previa.faltas).toContainEqual({ campo: "nome", texto: "Nome diferente do Produto Acabado" });
      expect(await falha(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m.id, previa.assinatura])).toMatch(/^P0001/);
      // iguala os nomes (edita o PRODUTO, não o card — o card fica sob controle de quem tem permissão de preço/planejamento)
      await c.query(`UPDATE public.produtos_acabados SET nome = (SELECT nome FROM public.modelos WHERE id = $1) WHERE modelo_id = $1`, [m.id]);
      const previa2 = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id])).r.produtos[0];
      expect(previa2.completo).toBe(true);
      expect(previa2.faltas).not.toContainEqual(expect.objectContaining({ campo: "nome" }));
      await marcar(c, m.id);
      // save do PA que NÃO muda o nome (mesmo nome do produto, já igual ao do card) passa sem travar — a falta só
      // acontece quando os 2 já DIVERGEM antes do marcar; depois de marcado, o `nome` trava por IS DISTINCT FROM real.
      const nome = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).n;
      const dados = { nome, qtd_total: 7, valor_unitario: 40, desconto_pct: 0, markup_varejo: 3 };
      const mesmas = [{ ordem: 1, cor_id: m.corId, cor_apelido_id: m.apelidoId, peso: 1, qtd: 7 }];
      expect(await falha(c, `SELECT public.salvar_produto_acabado($1, $2::jsonb, $3::jsonb, NULL)`, [m.produtoId, dados, JSON.stringify(mesmas)])).toBe("PASSOU");
    });
  });

  it("revisão T4 re-review A (Important, residual do #1): diferença SÓ DE ESPAÇO ('Blusa ' no PA × 'Blusa' no card) também vira falta e marcar recusa — a comparação é EXATA (sem btrim), igual o save do espelho grava", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c, { nome: "Blusa" });
      // _salvar_produto_acabado_core grava `nullif(_dados->>'nome','')` RAW (sem trim) em modelos.nome — um PA
      // com espaço a mais no nome ('Blusa ') e o card sem ('Blusa') é EXATAMENTE o cenário que a comparação com
      // btrim (fix da revisão T4 #1, anterior a este) deixava passar batido, mesmo a trava recusando depois
      // (fn_integracao_trava_modelos usa NEW.nome IS DISTINCT FROM OLD.nome, também sem trim).
      // ruling do controlador (T8 ensaio #1): mesmo motivo do T4 #1 acima — com o gatilho da mão dupla ATIVO
      // (migration 5), um UPDATE cru em produtos_acabados.nome propagaria pra modelos.nome (mudança REAL, o
      // próprio nome mudou) e fecharia a divergência antes do retrato observá-la; desligado só durante a criação
      // do dado divergente (legado).
      await comMirrorDesligado(c, "produtos_acabados", async () => {
        await c.query(`UPDATE public.produtos_acabados SET nome = 'Blusa ' WHERE modelo_id = $1`, [m.id]);
      });
      const previa = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id])).r.produtos[0];
      expect(previa.completo).toBe(false);
      expect(previa.faltas).toContainEqual({ campo: "nome", texto: "Nome diferente do Produto Acabado" });
      expect(await falha(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m.id, previa.assinatura])).toMatch(/^P0001/);
    });
  });

  it("nota 14 (D11): save do Produto Acabado com o MESMO conjunto de cores passa (apaga/recria); trocar a cor é recusado no COMMIT", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      await marcar(c, m.id);
      const nome = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).n;
      const dados = { nome, qtd_total: 7, valor_unitario: 40, desconto_pct: 0, markup_varejo: 3 };
      const mesmas = [{ ordem: 1, cor_id: m.corId, cor_apelido_id: m.apelidoId, peso: 1, qtd: 7 }];
      expect(await falha(c, `SELECT public.salvar_produto_acabado($1, $2::jsonb, $3::jsonb, NULL)`, [m.produtoId, dados, JSON.stringify(mesmas)])).toBe("PASSOU");
      await imediato(c);
      const outra = (await um<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Outra cor teste') RETURNING id`, [T])).id;
      await c.query(`UPDATE public.produto_acabado_variantes SET cor_id = $2 WHERE produto_acabado_id = $1`, [m.produtoId, outra]);
      await expect(imediato(c)).rejects.toThrow(/integracao_travado: variantes/);
    });
  });

  it("revisão T4 #2 (Important #2, plan-mandated): mover a variante de um PA TRAVADO para OUTRO PA (UPDATE do FK, tipo PATCH REST) é recusado no COMMIT — o conjunto de cores do produto de ORIGEM não pode encolher escondido", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      // um 2º produto acabado (NÃO travado) do MESMO tenant, com a SUA PRÓPRIA variante (destino já "correto"
      // segundo o próprio conjunto dele, que não trava nada) — cria/flusha ANTES do marcar+imediato abaixo, pra
      // não deixar o INSERT das variantes de setup (evento ADIADO também) pendurado junto com o UPDATE de teste.
      const outroProdutoId = (await um<{ id: string }>(c,
        `INSERT INTO public.produtos_acabados (tenant_id, nome, ref, valor_unitario, desconto_pct, qtd_total, markup_varejo)
         VALUES ($1, 'Outro produto T4-2', 'OUT-T42', 40, 0, 5, 3) RETURNING id`, [T])).id;
      await imediato(c); // flusha o INSERT das variantes do fixture `revenda()` + do outro produto (nenhum trava ainda)
      await marcar(c, m.id);
      const varianteId = (await um<{ id: string }>(c,
        `SELECT id FROM public.produto_acabado_variantes WHERE produto_acabado_id = $1 LIMIT 1`, [m.produtoId])).id;
      // move a variante (a ÚNICA cor do produto travado) para o outro produto — checar só NEW.produto_acabado_id
      // deixaria passar: o destino não está travado. O conjunto de cores do produto de ORIGEM (m.produtoId) encolhe
      // para VAZIO, o que deveria recusar (D11) — antes do fix, fn_integracao_trava_variantes só olhava NEW.
      await c.query(`UPDATE public.produto_acabado_variantes SET produto_acabado_id = $2 WHERE id = $1`, [varianteId, outroProdutoId]);
      await expect(imediato(c)).rejects.toThrow(/integracao_travado: variantes/);
    });
  });

  it("V2: foto do produto só sincroniza quando MUDA (WHEN) — reordenar no card não é desfeito pelo save do PA", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      const m = await revenda(c, { fotos: [`${T}/fotos_modelo/card.jpg`] });
      await c.query(`UPDATE public.produtos_acabados SET foto_url = $2 WHERE id = $1`, [m.produtoId, `${T}/fotos_modelo/capa.jpg`]);
      expect((await um<{ f: string[] }>(c, `SELECT fotos_modelo AS f FROM public.modelos WHERE id = $1`, [m.id])).f)
        .toEqual([`${T}/fotos_modelo/capa.jpg`, `${T}/fotos_modelo/card.jpg`]);
      await c.query(`UPDATE public.modelos SET fotos_modelo = ARRAY[$2::text] WHERE id = $1`, [m.id, `${T}/fotos_modelo/card.jpg`]);
      await c.query(`UPDATE public.produtos_acabados SET foto_url = foto_url, qtd_total = qtd_total WHERE id = $1`, [m.produtoId]);
      expect((await um<{ f: string[] }>(c, `SELECT fotos_modelo AS f FROM public.modelos WHERE id = $1`, [m.id])).f)
        .toEqual([`${T}/fotos_modelo/card.jpg`]);
    });
  });

  it("G10 (ruling do controlador, G-migration fix 1 · A-M3): marcar um IMPORTADO — trava, D11 nas variantes, D12 no fixo, B1 do recompute", async () => {
    await withTx(async (c) => {
      // D12/salvar_precos_fixo_produto_importado só existe a partir da migration 5 (D14/R1) — a trava em si (§8)
      // é da migration 4, mas este teste exercita as DUAS juntas (mesmo padrão do teste "revenda travada" acima,
      // que usa funções de fora desta frente já existentes há mais tempo).
      await prepara(c, 5);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      // custo landed do importado depende das cotações (integracao-helpers.ts: "as suítes que olham custo usam
      // interno/revenda") — tira preco_custo do padrão pra não travar o marcar com uma falta que não é do teste.
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "preco_custo"));
      const m = await importado(c);
      await marcar(c, m.id);

      // campo marcado (nome) recusado
      expect(await falha(c, `UPDATE public.produtos_importados SET nome = nome || ' X' WHERE id = $1`, [m.produtoId]))
        .toBe("42501 integracao_travado: nome");
      expect(await falha(c, `UPDATE public.produtos_importados SET ref = ref || 'X' WHERE id = $1`, [m.produtoId]))
        .toBe("42501 integracao_travado: ref_sku");
      expect(await falha(c, `UPDATE public.produtos_importados SET modelo_id = NULL WHERE id = $1`, [m.produtoId]))
        .toBe("42501 integracao_travado: vinculo");
      expect(await falha(c, `SELECT public.excluir_produto_importado($1)`, [m.produtoId])).toBe("42501 integracao_travado: excluir");

      // D12: preço fixo EXPLICITO recusado; limpar via markup passa
      expect(await falha(c, `SELECT public.salvar_precos_fixo_produto_importado($1::uuid, false, NULL::numeric, true, 199::numeric)`, [m.produtoId]))
        .toBe("42501 integracao_travado: preco_venda");
      expect(await falha(c, `SELECT public.salvar_precos_fixo_produto_importado($1::uuid, false, NULL::numeric, true, NULL::numeric)`, [m.produtoId])).toBe("PASSOU");

      // B1: _imp_recomputar_precos_modelo não dá erro e mantem o preco_venda congelado (o atacado segue livre)
      const precoAntes = (await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v;
      await c.query(`UPDATE public.produtos_importados SET markup_atacado = 2 WHERE id = $1`, [m.produtoId]);
      expect(await falha(c, `SELECT public._imp_recomputar_precos_modelo($1)`, [m.produtoId])).toBe("PASSOU");
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe(precoAntes);

      // D11: variantes — mesmo conjunto de cores passa (via salvar_produto_importado, apaga/recria); trocar a cor
      // recusa no COMMIT (constraint trigger adiado — deixa a txn nesse ponto, por isso vai por ÚLTIMO no teste).
      const nome = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).n;
      const grupo = (await um<{ id: string }>(c, `INSERT INTO public.grupos_produto (tenant_id, nome) VALUES ($1, 'Grupo G10') RETURNING id`, [T])).id;
      const categoria = (await um<{ id: string }>(c, `INSERT INTO public.categorias_produto (tenant_id, nome) VALUES ($1, 'Categoria G10') RETURNING id`, [T])).id;
      const dados = { nome, grupo_id: grupo, categoria_id: categoria, moeda_compra: "USD", valor_unitario_m1: 10, cotacao_ref: 1, cotacao_final: 5, qtd_total: 5, markup_varejo: 3 };
      const mesmas = [{ ordem: 1, cor_id: m.corId, cor_apelido_id: m.apelidoId, peso: 1, qtd: 5 }];
      expect(await falha(c, `SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, NULL)`, [m.produtoId, dados, JSON.stringify(mesmas)])).toBe("PASSOU");
      await imediato(c);
      const outraCor = (await um<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Outra cor G10') RETURNING id`, [T])).id;
      await c.query(`UPDATE public.produto_importado_variantes SET cor_id = $2 WHERE produto_importado_id = $1`, [m.produtoId, outraCor]);
      await expect(imediato(c)).rejects.toThrow(/integracao_travado: variantes/);
    });
  });

  it("gerar SKU que falta em produto travado é recusado (a tela pula — nota 11)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "ref_sku"));
      const m = await modeloInterno(c, { semSku: true });
      await marcar(c, m.id);
      expect(await falha(c, `SELECT public.gerar_skus_modelo($1, false)`, [m.id])).toMatch(/^42501 integracao_travado: sku$/);
    });
  });

  it("revisão T4 #5 (Minor #5, plan-mandated): _integracao_campo_travado tem EXECUTE revogado dos 3 (PUBLIC/anon/authenticated), não só authenticated/public", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      const r = await um<{ pub: boolean; anon: boolean; auth: boolean }>(c,
        `SELECT has_function_privilege('public', 'public._integracao_campo_travado(uuid,text)', 'EXECUTE') AS pub,
                has_function_privilege('anon', 'public._integracao_campo_travado(uuid,text)', 'EXECUTE') AS anon,
                has_function_privilege('authenticated', 'public._integracao_campo_travado(uuid,text)', 'EXECUTE') AS auth`);
      expect(r).toEqual({ pub: false, anon: false, auth: false });
    });
  });

  it("reset_loja apaga produto integrado (gatilhos não são ENABLE ALWAYS — replica pula)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado' WHERE modelo_id = $1`, [m.id]);
      const alw = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%' AND tgenabled <> 'O'`);
      expect(alw.n).toBe("0");
      await c.query(`SELECT public.reset_loja($1)`, [T]);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.modelos WHERE tenant_id = $1`, [T])).n).toBe("0");
    });
  });

  it.skipIf(!MIG_TXN)("recálculos: depois = antes + SÓ o TRECHO_B1 (diff mínimo, pg_get_functiondef)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      const aPa = await DEF(c, "_pa_recomputar_precos_modelo(uuid)");
      const aImp = await DEF(c, "_imp_recomputar_precos_modelo(uuid)");
      expect((await um<{ a: string; b: string }>(c, "SELECT md5($1) AS a, md5($2) AS b", [aPa, aImp]))).toEqual({ a: MD5_ANTES.pa, b: MD5_ANTES.imp });
      await aplica(c, "supabase/migrations/20261007130000_integracao_4_trava.sql");
      const dPa = await DEF(c, "_pa_recomputar_precos_modelo(uuid)");
      const dImp = await DEF(c, "_imp_recomputar_precos_modelo(uuid)");
      expect(dPa.replace(TRECHO_B1, "")).toBe(aPa);
      expect(dImp.replace(TRECHO_B1, "")).toBe(aImp);
    });
  });

  it.skipIf(!MIG_TXN)("inverso 4 desfaz a 4 (gatilhos novos somem, foto volta ao gatilho original, recálculos voltam ao md5 de antes)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await aplica(c, INVERSOS[3]);
      const r = await um<{ n: string; f: string; fi: string; pa: string; imp: string; funcoes: string }>(c,
        `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%' OR tgname LIKE 'trg_sync_foto_modelo_%_upd') AS n,
                (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_sync_foto_modelo_acabado') AS f,
                (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_sync_foto_modelo_importado') AS fi,
                md5(pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure)) AS pa,
                md5(pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure)) AS imp,
                (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                   AND proname IN ('fn_integracao_trava_modelos', 'fn_integracao_trava_modelos_del', 'fn_integracao_trava_skus',
                                   'fn_integracao_trava_espelho', 'fn_integracao_trava_variantes', '_integracao_campo_travado')
                )::text AS funcoes`);
      // N4 (G-plano do plano): o gatilho de foto do IMPORTADO também volta ao original.
      // revisão T4 #4 (Minor #4, mesma classe de T2 #7/T3 #4): as 6 funções da trava (5 fn_integracao_trava_*
      // + _integracao_campo_travado) TÊM que ter sumido — não só os gatilhos e os 2 recálculos.
      expect(r).toEqual({ n: "0", funcoes: "0", pa: MD5_ANTES.pa, imp: MD5_ANTES.imp,
        f: "CREATE TRIGGER trg_sync_foto_modelo_acabado AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_acabados FOR EACH ROW EXECUTE FUNCTION _sync_foto_modelo_do_produto()",
        fi: "CREATE TRIGGER trg_sync_foto_modelo_importado AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_importados FOR EACH ROW EXECUTE FUNCTION _sync_foto_modelo_do_produto()" });
    });
  });

  it.skipIf(!MIG_TXN)("inverso 4 recusa se um dos 2 recálculos mudou por outra frente depois da migration 4", async () => {
    // D40/revisão T1 #1 (Important #1, mesmo padrão do inverso 1): simula outra frente redefinindo
    // _pa_recomputar_precos_modelo DEPOIS da migration 4 (corpo diferente, sem TRECHO_B1 e sem bater com o "antes") —
    // o inverso deve RECUSAR (RAISE P0001 ASCII) sem tocar em nenhum DROP/gatilho.
    await withTx(async (c) => {
      await prepara(c, 4);
      await c.query(`
        CREATE OR REPLACE FUNCTION public._pa_recomputar_precos_modelo(_produto_id uuid)
         RETURNS void LANGUAGE plpgsql AS $function$
        BEGIN
          -- [outra frente] corpo diferente, sem relação com o texto de antes nem com o TRECHO_B1.
          PERFORM 1;
        END; $function$;
      `);
      await expect(aplica(c, INVERSOS[3])).rejects.toThrow(
        /integracao_4_down: _pa_recomputar_precos_modelo mudou depois da migration 4 - refazer o inverso/,
      );
      // as travas continuam existindo e o recálculo NÃO voltou ao "antes" (a recusa aconteceu no $guarda$, antes de qualquer DROP).
      const r = await um<{ n: string; pa: string }>(c,
        `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%') AS n,
                md5(pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure)) AS pa`);
      expect(r.n).not.toBe("0");
      expect(r.pa).not.toBe(MD5_ANTES.pa);
    });
  });

  it.skipIf(PULA_2_CONEXOES)("revisão T3->T4 (carry, ruling do controlador — Important #3 da revisão da Task 4, REAL 2 conexões): fn_integracao_trava_espelho fica esperando o FOR NO KEY UPDATE de um marcar concorrente em modelos (55P03 com lock_timeout curto), depois passa", async () => {
    // Important #3 da revisão: o teste antigo (mesma sessão, sem 2ª conexão) não provava nada — passava
    // igual com ou sem as linhas FOR SHARE. Prova de verdade (mesmo padrão de integracao-3-estados.test.ts
    // "Important #1 (revisão T3)"): uma 2ª conexão prende `modelos FOR NO KEY UPDATE` (a MESMA trava que
    // integracao_marcar de fato toma) sobre um produto_acabado LIGADO já commitado na cópia (nenhum id fixo —
    // escolhido em runtime); a txn do teste, com lock_timeout curto, tenta um UPDATE inócuo em
    // produtos_acabados — precisa esperar e estourar 55P03 (mesmo código/mecanismo de um lock de linha
    // comum) porque fn_integracao_trava_espelho agora toma FOR SHARE em modelos ANTES de olhar
    // integracao_produtos. Soltando a 2ª conexão, o MESMO UPDATE passa.
    const segunda = new Client({ connectionString: dbUrl()!, ssl: SSL });
    await segunda.connect();
    // revisão T4 re-review C (Minor): lock_timeout na 2ª conexão — se ela algum dia ficasse esperando um
    // lock que a txn do teste segura, segunda.end() NÃO cancela um backend parado num lock; sem timeout o
    // teste travaria até o timeout do próprio vitest. 2s é folgado (a espera esperada aqui é do OUTRO lado).
    await segunda.query("SET lock_timeout = '2s'");
    try {
      await withTx(async (c) => {
        await prepara(c, 4);
        await comoUsuario(c, U);
        // escolhe em runtime um produto_acabado LIGADO já commitado na cópia (a suíte não cria um novo —
        // o novo nasceria DENTRO desta txn, invisível pra 2ª conexão até o commit, que nunca acontece aqui).
        const alvo = await um<{ pa_id: string; modelo_id: string }>(c,
          `SELECT pa.id AS pa_id, pa.modelo_id AS modelo_id FROM public.produtos_acabados pa
            WHERE pa.modelo_id IS NOT NULL ORDER BY pa.id LIMIT 1`);

        await segunda.query("BEGIN");
        await segunda.query(`SELECT 1 FROM public.modelos WHERE id = $1 FOR NO KEY UPDATE`, [alvo.modelo_id]);

        await c.query("SET LOCAL lock_timeout = '300ms'");
        await c.query("SAVEPOINT trava_espelho");
        let travou = false;
        try {
          await c.query(`UPDATE public.produtos_acabados SET qtd_total = qtd_total WHERE id = $1`, [alvo.pa_id]);
        } catch (e: any) {
          travou = e.code === "55P03";
          await c.query("ROLLBACK TO SAVEPOINT trava_espelho");
        }
        expect(travou).toBe(true);

        // solta a 2ª conexão — agora o MESMO UPDATE (lock_timeout normal de novo) passa.
        await segunda.query("ROLLBACK");
        await c.query("SET LOCAL lock_timeout = '500ms'");
        await c.query(`UPDATE public.produtos_acabados SET qtd_total = qtd_total WHERE id = $1`, [alvo.pa_id]);
      });
    } finally {
      await segunda.end();
    }
  });

  it.skipIf(PULA_2_CONEXOES)("revisão T4 #3 (Important #3, mesmo padrão — caminho ADIADO das variantes): fn_integracao_trava_variantes (constraint trigger, disparado por imediato) também fica esperando o FOR NO KEY UPDATE de modelos", async () => {
    const segunda = new Client({ connectionString: dbUrl()!, ssl: SSL });
    await segunda.connect();
    // revisão T4 re-review C (Minor): mesmo lock_timeout de segurança da 2ª conexão do teste anterior.
    await segunda.query("SET lock_timeout = '2s'");
    try {
      await withTx(async (c) => {
        await prepara(c, 4);
        await comoUsuario(c, U);
        const alvo = await um<{ pa_id: string; modelo_id: string }>(c,
          `SELECT pa.id AS pa_id, pa.modelo_id AS modelo_id FROM public.produtos_acabados pa
            WHERE pa.modelo_id IS NOT NULL ORDER BY pa.id LIMIT 1`);
        // toca a linha de variante (mesmo valor — não muda o conjunto de cores) pra ter algo pendente
        // no gatilho ADIADO quando `imediato()` disparar SET CONSTRAINTS ALL IMMEDIATE.
        await c.query(`UPDATE public.produto_acabado_variantes SET peso = peso WHERE produto_acabado_id = $1`, [alvo.pa_id]);

        await segunda.query("BEGIN");
        await segunda.query(`SELECT 1 FROM public.modelos WHERE id = $1 FOR NO KEY UPDATE`, [alvo.modelo_id]);

        await c.query("SET LOCAL lock_timeout = '300ms'");
        await c.query("SAVEPOINT trava_var");
        let travou = false;
        try {
          await imediato(c);
        } catch (e: any) {
          travou = e.code === "55P03";
          await c.query("ROLLBACK TO SAVEPOINT trava_var");
        }
        expect(travou).toBe(true);
        await c.query("SET CONSTRAINTS ALL DEFERRED");

        // solta a 2ª conexão — o MESMO disparo do gatilho adiado agora passa (mesmo conjunto de cores: D11 não recusa).
        await segunda.query("ROLLBACK");
        await c.query("SET LOCAL lock_timeout = '500ms'");
        await c.query(`UPDATE public.produto_acabado_variantes SET peso = peso WHERE produto_acabado_id = $1`, [alvo.pa_id]);
        await imediato(c);
      });
    } finally {
      await segunda.end();
    }
  });
});
