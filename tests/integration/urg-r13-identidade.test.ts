/**
 * R13 T1 — teste de IDENTIDADE da migration (plan-r13 §5.1 item 1): numa txn revertida, tira a FOTO (R11-final), aplica a R13
 * DENTRO da txn e compara ANTES ≡ DEPOIS, por loja:
 *   - _custo_unitario_modelos_core(ids revenda/importado)  (JWT da loja)
 *   - _dashboard_leadtime_itens_core()                     (JWT da loja)
 *   - _estoque_extrato_insumo_core de todo insumo de BOM de revenda  (JWT da loja)
 *   - sidebar_badges()                                     (JWT da loja)
 *   - _estoque_p_acabado_core / _estoque_p_importado_core  (tenant param)
 *   - _imp_etapas_brl_oc por OC importada                  (tenant-agnostico)
 *   - parcelas (md5) por familia
 *   - cabecalho das OCs: totais/status/numero
 * NAO usa o gancho URG_R13_TXN (precisa fotografar ANTES de aplicar): aplica a R13 com aplicaR13() no meio do teste.
 * So na copia local (a R13 e DDL). Suite de integracao so com a copia QUIETA.
 */
import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, hasDb, ehBancoLocal } from "./db";
import { aplicaR13 } from "./urg-r13-helpers";

const rodar = hasDb && ehBancoLocal;

// lojas com usuario ativo (necessario para as RPCs com get_user_tenant_id)
const LOJAS = [
  { tenant: "20c84a36-b7a0-4c26-ac59-52cb11e9d979", user: "174518a5-569f-4954-9010-24204b345508", nome: "Ave Rara" },
  { tenant: "37889b78-fffb-404b-8c75-18b7e50a1d9b", user: "396c22df-78d6-4374-b537-9491a57af6cc", nome: "Loja Teste" },
];

async function hash(c: any, sql: string, params: any[] = []): Promise<string> {
  const r = await c.query(sql, params);
  return JSON.stringify(r.rows);
}

(rodar ? describe : describe.skip)("R13 T1 — identidade da migration", () => {
  it("custo/leadtime/extrato/sidebar/estoque_p por loja ≡ antes/depois", async () => {
    await withTx(async (c) => {
      // fixa o tenant ativo de cada usuario-dono DENTRO da txn (revertido no fim)
      for (const l of LOJAS) {
        await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [l.tenant, l.user]);
      }

      const antes: Record<string, string> = {};
      for (const l of LOJAS) {
        await comoUsuario(c, l.user);
        // ids revenda/importado da loja
        const ids = (await c.query(
          "SELECT array_agg(id) a FROM public.modelos WHERE tenant_id = $1 AND origem IN ('revenda','importado')",
          [l.tenant],
        )).rows[0].a as string[] | null;
        antes[`custo:${l.tenant}`] = await hash(
          c,
          "SELECT public._custo_unitario_modelos_core($1) x",
          [ids ?? []],
        );
        antes[`leadtime:${l.tenant}`] = await hash(
          c,
          "SELECT public._dashboard_leadtime_itens_core(NULL, NULL, NULL) x",
        );
        antes[`sidebar:${l.tenant}`] = await hash(c, "SELECT public.sidebar_badges() x");
        // insumos de BOM de revenda da loja
        const etqs = (await c.query(
          `SELECT DISTINCT me.etiqueta_id FROM public.modelo_etiquetas me
             JOIN public.modelos m ON m.id = me.modelo_id
            WHERE m.tenant_id = $1 AND m.origem = 'revenda' AND me.etiqueta_id IS NOT NULL`,
          [l.tenant],
        )).rows.map((r: any) => r.etiqueta_id);
        const extrato: any[] = [];
        for (const e of etqs) {
          const r = await c.query("SELECT * FROM public._estoque_extrato_insumo_core($1, $2) ORDER BY 1,2,3,4,5", [l.tenant, e]);
          extrato.push({ e, rows: r.rows });
        }
        antes[`extrato:${l.tenant}`] = JSON.stringify(extrato);
      }
      // estoque_p (tenant param, sem JWT) + OC-level (sem JWT)
      await comoUsuario(c, LOJAS[0].user); // qualquer: os _core abaixo nao usam JWT
      const estoqueP: Record<string, string> = {};
      for (const l of LOJAS) {
        estoqueP[`pa:${l.tenant}`] = await hash(c, "SELECT public._estoque_p_acabado_core($1) x", [l.tenant]);
        estoqueP[`pi:${l.tenant}`] = await hash(c, "SELECT public._estoque_p_importado_core($1) x", [l.tenant]);
      }
      const impBrlAntes = await hash(
        c,
        `SELECT o.id, (SELECT md5(coalesce(string_agg(e.ordem::text||'|'||coalesce(e.rotulo,'')||'|'||coalesce(e.base,'')||'|'||
           coalesce(e.data_vencimento::text,'')||'|'||coalesce(e.valor_brl::text,''),';' ORDER BY e.ordem,e.rotulo),''))
           FROM public._imp_etapas_brl_oc(o.id) e) h
         FROM public.ocs_importado o ORDER BY o.id`,
      );
      const parcAntes = await hash(
        c,
        `SELECT tipo_oc, md5(coalesce(string_agg(id::text||'|'||coalesce(numero_parcela::text,'')||'|'||coalesce(valor::text,'')||'|'||
           coalesce(data_vencimento::text,'')||'|'||coalesce(status,'')||'|'||coalesce(vencimento_manual::text,''),''
           ORDER BY id),'')) h FROM public.parcelas WHERE tipo_oc IN ('p_acabado','p_importado') GROUP BY tipo_oc ORDER BY tipo_oc`,
      );
      const cabAntes = await hash(
        c,
        `SELECT 'pa' f, id, numero, qtd_total, valor_bruto, valor_total_desconto, status, data_entrega FROM public.ocs_p_acabado
         UNION ALL
         SELECT 'pi', id, numero, qtd_total, valor_bruto, valor_total_desconto, status, data_entrega FROM public.ocs_importado
         ORDER BY 1,2`,
      );

      // ── aplica a R13 DENTRO da txn ──
      await aplicaR13(c);

      // ── compara DEPOIS ──
      for (const l of LOJAS) {
        await comoUsuario(c, l.user);
        const ids = (await c.query(
          "SELECT array_agg(id) a FROM public.modelos WHERE tenant_id = $1 AND origem IN ('revenda','importado')",
          [l.tenant],
        )).rows[0].a as string[] | null;
        expect(await hash(c, "SELECT public._custo_unitario_modelos_core($1) x", [ids ?? []]),
          `custo ${l.nome}`).toBe(antes[`custo:${l.tenant}`]);
        expect(await hash(c, "SELECT public._dashboard_leadtime_itens_core(NULL, NULL, NULL) x"),
          `leadtime ${l.nome}`).toBe(antes[`leadtime:${l.tenant}`]);
        expect(await hash(c, "SELECT public.sidebar_badges() x"), `sidebar ${l.nome}`).toBe(antes[`sidebar:${l.tenant}`]);
        const etqs = (await c.query(
          `SELECT DISTINCT me.etiqueta_id FROM public.modelo_etiquetas me
             JOIN public.modelos m ON m.id = me.modelo_id
            WHERE m.tenant_id = $1 AND m.origem = 'revenda' AND me.etiqueta_id IS NOT NULL`,
          [l.tenant],
        )).rows.map((r: any) => r.etiqueta_id);
        const extrato: any[] = [];
        for (const e of etqs) {
          const r = await c.query("SELECT * FROM public._estoque_extrato_insumo_core($1, $2) ORDER BY 1,2,3,4,5", [l.tenant, e]);
          extrato.push({ e, rows: r.rows });
        }
        expect(JSON.stringify(extrato), `extrato ${l.nome}`).toBe(antes[`extrato:${l.tenant}`]);
      }
      await comoUsuario(c, LOJAS[0].user);
      for (const l of LOJAS) {
        expect(await hash(c, "SELECT public._estoque_p_acabado_core($1) x", [l.tenant]),
          `estoque_pa ${l.nome}`).toBe(estoqueP[`pa:${l.tenant}`]);
        expect(await hash(c, "SELECT public._estoque_p_importado_core($1) x", [l.tenant]),
          `estoque_pi ${l.nome}`).toBe(estoqueP[`pi:${l.tenant}`]);
      }
      expect(await hash(
        c,
        `SELECT o.id, (SELECT md5(coalesce(string_agg(e.ordem::text||'|'||coalesce(e.rotulo,'')||'|'||coalesce(e.base,'')||'|'||
           coalesce(e.data_vencimento::text,'')||'|'||coalesce(e.valor_brl::text,''),';' ORDER BY e.ordem,e.rotulo),''))
           FROM public._imp_etapas_brl_oc(o.id) e) h
         FROM public.ocs_importado o ORDER BY o.id`,
      ), "imp_etapas_brl").toBe(impBrlAntes);
      expect(await hash(
        c,
        `SELECT tipo_oc, md5(coalesce(string_agg(id::text||'|'||coalesce(numero_parcela::text,'')||'|'||coalesce(valor::text,'')||'|'||
           coalesce(data_vencimento::text,'')||'|'||coalesce(status,'')||'|'||coalesce(vencimento_manual::text,''),''
           ORDER BY id),'')) h FROM public.parcelas WHERE tipo_oc IN ('p_acabado','p_importado') GROUP BY tipo_oc ORDER BY tipo_oc`,
      ), "parcelas md5").toBe(parcAntes);
      expect(await hash(
        c,
        `SELECT 'pa' f, id, numero, qtd_total, valor_bruto, valor_total_desconto, status, data_entrega FROM public.ocs_p_acabado
         UNION ALL
         SELECT 'pi', id, numero, qtd_total, valor_bruto, valor_total_desconto, status, data_entrega FROM public.ocs_importado
         ORDER BY 1,2`,
      ), "cabecalho").toBe(cabAntes);

      // sanidade: a R13 ficou viva (itens criados)
      const nIt = (await c.query(
        "SELECT (SELECT count(*) FROM public.ocs_p_acabado_itens) + (SELECT count(*) FROM public.ocs_importado_itens) n",
      )).rows[0].n;
      expect(Number(nIt)).toBeGreaterThan(0);
    });
  }, 120000);
});
