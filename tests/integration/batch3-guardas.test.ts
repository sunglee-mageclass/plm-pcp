import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// 2ª linha do audit de saúde (jul/2026) — defense-in-depth:
//  A) gate de módulo entrada_saida nas RPCs de OS;
//  B) cqLiberado re-checado no SERVIDOR do confirmar_direcionamento (_cq_liberado);
//  C) set_user_permissions atômico (delete+insert numa txn) + authz.
describe.skipIf(!hasDb)("Audit de saúde 2ª linha — gates de servidor", () => {
  // tenant_module_enabled = is_super_admin() OR (módulo ligado) — super bypassa (correto), e o
  // usuário de teste é super. Então o gate não é exercitável por RAISE aqui; verifica-se que ele
  // está WIRED nas 3 RPCs (anti-regressão). O bloqueio real vale p/ usuário comum de loja com o
  // módulo desligado.
  it("A) salvar_os/baixar_os/desmarcar_os têm o gate de módulo entrada_saida", async () => {
    await withTx(async (c) => {
      for (const sig of ["salvar_os(text,uuid,jsonb,jsonb)", "baixar_os(text,uuid,jsonb)", "desmarcar_os(text,uuid)"]) {
        const src = (await um<{ d: string }>(c, `select pg_get_functiondef(('public.'||$1)::regprocedure) d`, [sig])).d;
        expect(src).toMatch(/tenant_module_enabled\('entrada_saida'\)/);
      }
    });
  });

  it("B) confirmar_direcionamento bloqueia se o CQ não está liberado (_cq_liberado)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await um<{ cad: string } | undefined>(c,
        `select cad_id cad from controle_qualidade where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!f) return;

      // CQ confirmado (Pré+Pós) → liberado
      await c.query(`update controle_qualidade set status='confirmado', status_pos='confirmado' where cad_id=$1`, [f.cad]);
      expect((await um<{ v: boolean }>(c, `select public._cq_liberado($1) v`, [f.cad])).v).toBe(true);

      // CQ pendente → NÃO liberado + confirmar bloqueia (antes do _core)
      await c.query(`update controle_qualidade set status='pendente' where cad_id=$1`, [f.cad]);
      expect((await um<{ v: boolean }>(c, `select public._cq_liberado($1) v`, [f.cad])).v).toBe(false);
      await c.query("SAVEPOINT sp");
      await expect(c.query(`select public.confirmar_direcionamento($1,'[]'::jsonb)`, [f.cad]))
        .rejects.toThrow(/Controle de Qualidade/i);
      await c.query("ROLLBACK TO SAVEPOINT sp");
    });
  });

  it("C) set_user_permissions substitui atomicamente + bloqueia alvo fora da loja", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const alvo = await um<{ id: string } | undefined>(c, `select id from users where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!alvo) return;

      const perms2 = JSON.stringify([
        { pagina: "criacao_planejamento", pode_ver: true, pode_editar: false },
        { pagina: "producao_cq", pode_ver: true, pode_editar: true },
      ]);
      await c.query(`select public.set_user_permissions($1,$2,$3::jsonb)`, [alvo.id, TENANT_TESTE, perms2]);
      expect(Number((await um<{ n: string }>(c, `select count(*) n from user_permissions where user_id=$1`, [alvo.id])).n)).toBe(2);

      // regrava com 1 → substitui (o outro some, sem janela sem-permissão)
      const perms1 = JSON.stringify([{ pagina: "financeiro", pode_ver: true, pode_editar: true }]);
      await c.query(`select public.set_user_permissions($1,$2,$3::jsonb)`, [alvo.id, TENANT_TESTE, perms1]);
      const rows = await c.query(`select pagina from user_permissions where user_id=$1`, [alvo.id]);
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].pagina).toBe("financeiro");

      // alvo inexistente na loja → bloqueia
      await c.query("SAVEPOINT sp");
      await expect(c.query(`select public.set_user_permissions('00000000-0000-0000-0000-000000000000'::uuid,$1,'[]'::jsonb)`, [TENANT_TESTE]))
        .rejects.toThrow(/não pertence/i);
      await c.query("ROLLBACK TO SAVEPOINT sp");
    });
  });
});
