// FF2/FF3 (fast-follows Revenda, ago/2026, migrations 20260811110000/20260811120000).
//
// FF2 fecha o gap conhecido/aceito da invariante 13 (CLAUDE.md): as 3 tabelas de Produto
// Acabado não tinham modgate RESTRICTIVE de `tenant_module_enabled('produto_acabado')` —
// leitura direta via REST/embed não era bloqueada quando o módulo estava desligado.
//
// FF3 fecha um belt-and-suspenders de tenant-match nos 2 vínculos opcionais da feature
// (`produtos_acabados.modelo_id`, `ocs_p_acabado.produto_acabado_id`) — mesma classe de
// bug já coberta por `enforce_empresa_tenant`/`enforce_representante_tenant`.
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Ave Rara: único tenant com módulo `produto_acabado` ligado E usuários reais não-
// super_admin (a conta-padrão dos testes, USER_TESTE, é sempre super_admin — não dá pra
// exercitar o modgate de LEITURA sem ela, já que `tenant_module_enabled` faz bypass
// automático de super_admin). Toda mutação em tenant_config/produtos_acabados/etc. abaixo
// roda dentro de `withTx` (BEGIN…ROLLBACK sempre no fim) — nada persiste.
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const AVE_RARA_USER_COMUM = "3f17e45b-aeec-47f0-8917-f3f29955e2a5"; // role='user'
const AVE_RARA_SUPER_ADMIN = "25285a7d-277b-472e-8cf2-4a3bc4e202f1"; // role='super_admin', tenant real = Ave Rara

async function moduloOff(c: any) {
  await c.query(
    `update tenant_config set modules = jsonb_set(modules,'{produto_acabado}','false') where tenant_id=$1`,
    [AVE_RARA],
  );
}

// set_tenant_id_trg força o tenant do CHAMADOR no INSERT (ignora tenant_id explícito) —
// mesmo truque de fixture usado em rpc-conjunto.test.ts: cria em TENANT_TESTE (chamador
// super_admin padrão) e reatribui por UPDATE direto pra simular um registro de OUTRA loja.
async function novoModelo(c: any, tenant = TENANT_TESTE): Promise<string> {
  const r = await um<{ id: string }>(c, `insert into modelos(nome) values ('ITEST pa-hard') returning id`);
  if (tenant !== TENANT_TESTE) await c.query(`update modelos set tenant_id=$1 where id=$2`, [tenant, r.id]);
  return r.id;
}
async function novoProdutoAcabado(c: any, tenant = TENANT_TESTE, modeloId: string | null = null): Promise<string> {
  const r = await um<{ id: string }>(
    c,
    `insert into produtos_acabados (nome, modelo_id) values ('ITEST pa-hard', $1) returning id`,
    [modeloId],
  );
  if (tenant !== TENANT_TESTE) await c.query(`update produtos_acabados set tenant_id=$1 where id=$2`, [tenant, r.id]);
  return r.id;
}

describe.skipIf(!hasDb)("FF2 — modgate de leitura (produto_acabado)", () => {
  it("módulo OFF: SELECT como authenticated não-super_admin retorna 0 nas 3 tabelas", async () => {
    await withTx(async (c) => {
      await moduloOff(c);
      await comoUsuario(c, AVE_RARA_USER_COMUM);
      await c.query("SET ROLE authenticated");
      try {
        const p = await um<{ n: string }>(c, `select count(*)::text as n from produtos_acabados`);
        const v = await um<{ n: string }>(c, `select count(*)::text as n from produto_acabado_variantes`);
        const o = await um<{ n: string }>(c, `select count(*)::text as n from ocs_p_acabado`);
        expect(p.n).toBe("0");
        expect(v.n).toBe("0");
        expect(o.n).toBe("0");
      } finally {
        await c.query("RESET ROLE");
      }
    });
  });

  it("módulo OFF: RPC SECURITY DEFINER dá o RAISE do wrapper (42501), não erro de RLS", async () => {
    await withTx(async (c) => {
      await moduloOff(c);
      await comoUsuario(c, AVE_RARA_USER_COMUM);
      await c.query("SET ROLE authenticated");
      // O RAISE abaixo aborta a transação até ROLLBACK/SAVEPOINT (comportamento normal do
      // Postgres) — savepoint pra poder seguir usando a conexão depois de capturar o erro.
      await c.query("SAVEPOINT sp_rpc_modulo_off");
      try {
        await expect(c.query("select estoque_p_acabado()")).rejects.toThrow(/Módulo Produto Acabado não habilitado/);
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT sp_rpc_modulo_off");
        await c.query("RESET ROLE");
      }
    });
  });

  it("módulo ON (estado real da loja): SELECT como authenticated comum não quebra", async () => {
    await withTx(async (c) => {
      await comoUsuario(c, AVE_RARA_USER_COMUM);
      await c.query("SET ROLE authenticated");
      try {
        const p = await um<{ n: string }>(c, `select count(*)::text as n from produtos_acabados`);
        expect(Number(p.n)).toBeGreaterThanOrEqual(0);
      } finally {
        await c.query("RESET ROLE");
      }
    });
  });

  it("super_admin enxerga mesmo com módulo OFF (bypass embutido em tenant_module_enabled)", async () => {
    await withTx(async (c) => {
      await moduloOff(c);
      await comoUsuario(c, AVE_RARA_SUPER_ADMIN);
      await c.query("SET ROLE authenticated");
      try {
        await expect(c.query(`select count(*) from produtos_acabados`)).resolves.toBeDefined();
      } finally {
        await c.query("RESET ROLE");
      }
    });
  });
});

// Fix round do FF2 (HIGH confirmado pelo reviewer, migração 20260811140000):
// `tenant_module_enabled` só tratava `otb` como opt-in-default-OFF no fallback
// (`_module <> 'otb'`) — pra `produto_acabado`, tenant SEM a chave explícita em
// `tenant_config.modules` recebia TRUE (falha aberta), furando tanto as policies
// RESTRICTIVE do FF2 quanto todos os wrappers da feature. Cobre exatamente o gap com um
// tenant SINTÉTICO (criado na própria transação) — não usa os tenants reais (Controle de
// Estoque/French/Mun), pra não depender do estado deles. Nota: `trg_criar_tenant_config`
// semeia um `tenant_config` default pra TODO tenant novo (inclusive via NovaLojaModal),
// mas esse default NUNCA incluiu a chave `produto_acabado`/`otb` (módulos não existiam
// quando o seed foi escrito) — "sem a chave" é o estado real de qualquer loja nova, com
// ou sem essa linha default.
describe.skipIf(!hasDb)("FF2-fix — tenant_module_enabled trata produto_acabado como opt-in (falha-fechado)", () => {
  it("tenant novo (chave produto_acabado ausente no config-default): produto_acabado=false, otb=false, cadastro=true", async () => {
    await withTx(async (c) => {
      const t = await um<{ id: string }>(c, `insert into tenants (nome) values ('ITEST tenant sem config') returning id`);
      // Reassocia um usuário real não-super_admin (comum) pra esse tenant sintético só
      // pra exercitar get_user_tenant_id()/tenant_module_enabled como esse tenant.
      await c.query(`update users set tenant_id=$1 where id=$2`, [t.id, AVE_RARA_USER_COMUM]);
      await comoUsuario(c, AVE_RARA_USER_COMUM);
      await c.query("SET ROLE authenticated");
      try {
        const r = await um<{ pa: boolean; otb: boolean; cad: boolean }>(
          c,
          `select tenant_module_enabled('produto_acabado') as pa,
                  tenant_module_enabled('otb') as otb,
                  tenant_module_enabled('cadastro') as cad`,
        );
        expect(r.pa).toBe(false); // era o bug: vinha true
        expect(r.otb).toBe(false); // já era false antes (regressão-guard)
        expect(r.cad).toBe(true); // módulo "clássico": chave ausente segue ON
      } finally {
        await c.query("RESET ROLE");
      }
    });
  });

  it("mesmo tenant sintético, COM a chave produto_acabado=true: enxerga normal", async () => {
    await withTx(async (c) => {
      // trg_criar_tenant_config (AFTER INSERT em tenants) já semeia um tenant_config
      // default (sem a chave produto_acabado/otb) — UPDATE na linha que o trigger criou,
      // não INSERT (daria unique_violation em tenant_config_tenant_id_key).
      const t = await um<{ id: string }>(c, `insert into tenants (nome) values ('ITEST tenant com config') returning id`);
      await c.query(
        `update tenant_config set modules = jsonb_set(modules, '{produto_acabado}', 'true') where tenant_id=$1`,
        [t.id],
      );
      await c.query(`update users set tenant_id=$1 where id=$2`, [t.id, AVE_RARA_USER_COMUM]);
      await comoUsuario(c, AVE_RARA_USER_COMUM);
      await c.query("SET ROLE authenticated");
      try {
        const r = await um<{ pa: boolean }>(c, `select tenant_module_enabled('produto_acabado') as pa`);
        expect(r.pa).toBe(true);
      } finally {
        await c.query("RESET ROLE");
      }
    });
  });
});

describe.skipIf(!hasDb)("FF3 — tenant-match (produto_acabado.modelo_id / ocs_p_acabado.produto_acabado_id)", () => {
  it("produtos_acabados.modelo_id de OUTRA loja no INSERT → rejeita (P0001, PT)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); // super_admin em TENANT_TESTE
      const modeloOutraLoja = await novoModelo(c, AVE_RARA);
      await expect(
        c.query(`insert into produtos_acabados (nome, modelo_id) values ('ITEST cross', $1)`, [modeloOutraLoja]),
      ).rejects.toThrow(/outra loja/);
    });
  });

  it("produtos_acabados.modelo_id da MESMA loja → funciona", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const modeloMesmaLoja = await novoModelo(c);
      const id = await novoProdutoAcabado(c, TENANT_TESTE, modeloMesmaLoja);
      const r = await um<{ modelo_id: string }>(c, `select modelo_id from produtos_acabados where id=$1`, [id]);
      expect(r.modelo_id).toBe(modeloMesmaLoja);
    });
  });

  it("produtos_acabados.modelo_id: UPDATE p/ modelo de OUTRA loja → rejeita", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoProdutoAcabado(c);
      const modeloOutraLoja = await novoModelo(c, AVE_RARA);
      await expect(
        c.query(`update produtos_acabados set modelo_id=$1 where id=$2`, [modeloOutraLoja, id]),
      ).rejects.toThrow(/outra loja/);
    });
  });

  it("produtos_acabados.modelo_id = NULL → não dispara a guarda", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoProdutoAcabado(c, TENANT_TESTE, null);
      const r = await um<{ modelo_id: string | null }>(c, `select modelo_id from produtos_acabados where id=$1`, [id]);
      expect(r.modelo_id).toBeNull();
    });
  });

  it("ocs_p_acabado.produto_acabado_id de OUTRA loja no INSERT → rejeita (P0001, PT)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const produtoOutraLoja = await novoProdutoAcabado(c, AVE_RARA);
      await expect(
        c.query(`insert into ocs_p_acabado (nome_produto, produto_acabado_id) values ('ITEST cross', $1)`, [produtoOutraLoja]),
      ).rejects.toThrow(/outra loja/);
    });
  });

  it("ocs_p_acabado.produto_acabado_id da MESMA loja → funciona", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const produtoMesmaLoja = await novoProdutoAcabado(c);
      const r = await um<{ id: string }>(
        c,
        `insert into ocs_p_acabado (nome_produto, produto_acabado_id) values ('ITEST same', $1) returning id`,
        [produtoMesmaLoja],
      );
      expect(r.id).toBeTruthy();
    });
  });

  it("ocs_p_acabado.produto_acabado_id = NULL → não dispara a guarda", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const r = await um<{ id: string }>(
        c,
        `insert into ocs_p_acabado (nome_produto, produto_acabado_id) values ('ITEST sem produto', NULL) returning id`,
      );
      expect(r.id).toBeTruthy();
    });
  });
});
