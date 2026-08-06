import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("MO por serviço — Task 1: toggle ativo em categorias_terceirizado", () => {
  it("coluna ativo existe, NOT NULL default true", async () => {
    await withTx(async (c) => {
      const r = await um<{ is_nullable: string; column_default: string }>(
        c,
        `select is_nullable, column_default from information_schema.columns
          where table_name='categorias_terceirizado' and column_name='ativo'`,
      );
      expect(r.is_nullable).toBe("NO");
      expect(r.column_default).toMatch(/true/);
    });
  });

  it("categoria nova nasce ativa; desativar não a exclui", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cat = await um<{ id: string; ativo: boolean }>(
        c,
        `insert into categorias_terceirizado (tenant_id, nome, etapa)
         values ($1, 'Serviço Teste MO', 'ate_costura') returning id, ativo`,
        [TENANT_TESTE],
      );
      expect(cat.ativo).toBe(true);
      await c.query(`update categorias_terceirizado set ativo=false where id=$1`, [cat.id]);
      const still = await um<{ n: string }>(
        c, `select count(*) as n from categorias_terceirizado where id=$1`, [cat.id],
      );
      expect(Number(still.n)).toBe(1);
    });
  });
});

describe.skipIf(!hasDb)("MO por serviço — Task 2: tabela + backfill legado", () => {
  it("tabela existe com FK RESTRICT na categoria e índice parcial do legado", async () => {
    await withTx(async (c) => {
      const restrict = await um<{ n: string }>(
        c,
        `select count(*) as n from pg_constraint
          where conname='modelo_servico_mo_categoria_terceirizado_id_fkey' and confdeltype='r'`,
      );
      expect(Number(restrict.n)).toBe(1); // 'r' = RESTRICT
      const parcial = await um<{ n: string }>(
        c,
        `select count(*) as n from pg_indexes
          where tablename='modelo_servico_mo' and indexname='ux_msm_legado'`,
      );
      expect(Number(parcial.n)).toBe(1);
    });
  });

  it("índice parcial barra 2º legado (categoria NULL) no mesmo modelo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string }>(
        c, `insert into modelos (tenant_id, nome) values ($1,'M legado') returning id`, [TENANT_TESTE],
      );
      await c.query(
        `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor)
         values ($1,$2,NULL,10)`, [TENANT_TESTE, m.id],
      );
      await expect(
        c.query(`insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor)
                 values ($1,$2,NULL,20)`, [TENANT_TESTE, m.id]),
      ).rejects.toThrow(/duplicate key|ux_msm_legado/);
    });
  });

  it("FK RESTRICT impede excluir categoria com MO", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cat = await um<{ id: string }>(
        c, `insert into categorias_terceirizado (tenant_id, nome, etapa)
            values ($1,'Serv RESTRICT','ate_costura') returning id`, [TENANT_TESTE],
      );
      const m = await um<{ id: string }>(
        c, `insert into modelos (tenant_id, nome) values ($1,'M restrict') returning id`, [TENANT_TESTE],
      );
      await c.query(
        `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor)
         values ($1,$2,$3,5)`, [TENANT_TESTE, m.id, cat.id],
      );
      await expect(
        c.query(`delete from categorias_terceirizado where id=$1`, [cat.id]),
      ).rejects.toThrow(/violates foreign key|modelo_servico_mo/);
    });
  });
});

describe.skipIf(!hasDb)("MO por serviço — Task 3: rollup derivado do flag", () => {
  async function novoModeloComLinhas(c: any, aprovados: (boolean | null)[]) {
    const m = await um<{ id: string }>(
      c, `insert into modelos (tenant_id, nome) values ($1,'M rollup') returning id`, [TENANT_TESTE],
    );
    for (let i = 0; i < aprovados.length; i++) {
      const cat = await um<{ id: string }>(
        c, `insert into categorias_terceirizado (tenant_id, nome, etapa)
            values ($1,$2,'ate_costura') returning id`, [TENANT_TESTE, `Serv rollup ${i} ${m.id.slice(0,8)}`],
      );
      await c.query(
        `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado)
         values ($1,$2,$3,10,$4)`, [TENANT_TESTE, m.id, cat.id, aprovados[i]],
      );
    }
    return m.id;
  }
  async function flag(c: any, id: string) {
    const r = await um<{ f: boolean }>(c, `select custo_terceirizados_aprovado as f from modelos where id=$1`, [id]);
    return r.f;
  }
  async function rev(c: any, id: string) {
    const r = await um<{ r: number }>(c, `select rev as r from modelos where id=$1`, [id]);
    return r.r;
  }

  it("sem linha → flag true (sem serviço = liberada)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, []);
      expect(await flag(c, id)).toBe(true);
    });
  });
  it("todas aprovadas → flag true", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [true, true]);
      expect(await flag(c, id)).toBe(true);
    });
  });
  it("uma pendente → flag false", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [true, null]);
      expect(await flag(c, id)).toBe(false);
    });
  });
  it("uma reprovada → flag false; ao aprovar todas → volta true", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [true, false]);
      expect(await flag(c, id)).toBe(false);
      await c.query(`update modelo_servico_mo set aprovado=true where modelo_id=$1`, [id]);
      expect(await flag(c, id)).toBe(true);
      await c.query(`delete from modelo_servico_mo where modelo_id=$1`, [id]);
      expect(await flag(c, id)).toBe(true); // sem serviço = liberada
    });
  });
  it("flag é à prova de adulteração: UPDATE direto é re-derivado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [null]); // pendente → derivado false
      await c.query(`update modelos set custo_terceirizados_aprovado=true where id=$1`, [id]);
      expect(await flag(c, id)).toBe(false); // trigger BEFORE UPDATE re-derivou
    });
  });
  it("custo_unitario.mao_obra_previsto passou a somar modelo_servico_mo.valor", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c, `select position('modelo_servico_mo' in
              pg_get_functiondef('public._custo_unitario_modelos_core(uuid[])'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });
  it("enforce_maodeobra_aprovacao foi aposentado (trigger não existe mais)", async () => {
    await withTx(async (c) => {
      const r = await um<{ n: string }>(
        c, `select count(*) as n from pg_trigger where tgname='trg_enforce_maodeobra_aprovacao'`,
      );
      expect(Number(r.n)).toBe(0);
    });
  });

  // Fix round 1 (review): o rollup fazia UPDATE modelos SEM guard → bumpava modelos.rev
  // (trg_colab_rev) a cada escrita em modelo_servico_mo, mesmo quando o flag não mudava.
  // O Planejamento usa colab por modelos.rev — isso geraria P0409 falsos nas Tasks 4/5.
  it("editar valor de linha JÁ aprovada (flag não muda) NÃO bumpa modelos.rev", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [true]); // 1 linha aprovada → flag true
      expect(await flag(c, id)).toBe(true);
      const revAntes = await rev(c, id);
      await c.query(`update modelo_servico_mo set valor=99 where modelo_id=$1`, [id]);
      expect(await flag(c, id)).toBe(true); // continua aprovada
      expect(await rev(c, id)).toBe(revAntes); // rev NÃO bumpou
    });
  });
  it("transição real do flag (pendente→aprovada) bumpa modelos.rev exatamente 1×", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [null]); // pendente → flag false
      expect(await flag(c, id)).toBe(false);
      const revAntes = await rev(c, id);
      await c.query(`update modelo_servico_mo set aprovado=true where modelo_id=$1`, [id]);
      expect(await flag(c, id)).toBe(true); // transição real
      expect(await rev(c, id)).toBe(revAntes + 1); // bumpou exatamente 1×
    });
  });
});

describe.skipIf(!hasDb)("MO por serviço — Task 4: RPCs + permissão por linha", () => {
  it("salvar_modelo_servico_mo faz diff estado-completo (upsert + delete de ausentes)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1,'M rpc') returning id`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv rpc a','ate_costura') returning id`, [TENANT_TESTE]);
      const cat2 = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv rpc b','ate_costura') returning id`, [TENANT_TESTE]);
      await c.query(`select salvar_modelo_servico_mo($1, $2::jsonb)`, [m.id,
        JSON.stringify([{ categoria_terceirizado_id: cat.id, valor: 12 }, { categoria_terceirizado_id: cat2.id, valor: 8 }])]);
      let n = await um<{ n: string }>(c, `select count(*) as n from modelo_servico_mo where modelo_id=$1`, [m.id]);
      expect(Number(n.n)).toBe(2);
      // novo estado sem cat2 → cat2 é apagada; cat vira 20
      await c.query(`select salvar_modelo_servico_mo($1, $2::jsonb)`, [m.id,
        JSON.stringify([{ categoria_terceirizado_id: cat.id, valor: 20 }])]);
      n = await um<{ n: string }>(c, `select count(*) as n from modelo_servico_mo where modelo_id=$1`, [m.id]);
      expect(Number(n.n)).toBe(1);
      const v = await um<{ valor: string; aprovado: boolean | null }>(c, `select valor, aprovado from modelo_servico_mo where modelo_id=$1`, [m.id]);
      expect(Number(v.valor)).toBe(20);
      expect(v.aprovado).toBeNull(); // salvar nunca toca aprovado
    });
  });

  it("aprovar_servico_mo seta aprovado; reprovar exige motivo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1,'M ap') returning id`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv ap','ate_costura') returning id`, [TENANT_TESTE]);
      await c.query(`select salvar_modelo_servico_mo($1, $2::jsonb)`, [m.id, JSON.stringify([{ categoria_terceirizado_id: cat.id, valor: 5 }])]);
      await c.query(`select aprovar_servico_mo($1,$2,true,null)`, [m.id, cat.id]);
      let f = await um<{ f: boolean }>(c, `select custo_terceirizados_aprovado as f from modelos where id=$1`, [m.id]);
      expect(f.f).toBe(true);
      // savepoint: o RAISE do motivo obrigatório aborta a txn até o próximo ROLLBACK/SAVEPOINT.
      await c.query("SAVEPOINT sp_motivo");
      await expect(c.query(`select aprovar_servico_mo($1,$2,false,null)`, [m.id, cat.id])).rejects.toThrow(/motivo/i);
      await c.query("ROLLBACK TO SAVEPOINT sp_motivo");
      await c.query(`select aprovar_servico_mo($1,$2,false,'valor alto')`, [m.id, cat.id]);
      f = await um<{ f: boolean }>(c, `select custo_terceirizados_aprovado as f from modelos where id=$1`, [m.id]);
      expect(f.f).toBe(false);
    });
  });

  it("trigger de permissão por linha: aprovar sem producao_servico_aprovacao → RAISE 42501", async () => {
    await withTx(async (c) => {
      const uid = "0a0a0a0a-0000-4000-8000-0000000000aa";
      // public.users.id → auth.users(id): semeia a auth primeiro (txn revertida). Sem papel em
      // user_roles nem permissão → user_can_edit('producao_servico_aprovacao')=false.
      await c.query(`insert into auth.users (id, email) values ($1,'noperm-mo@teste') on conflict (id) do nothing`, [uid]);
      await c.query(`insert into public.users (id, tenant_id, email, nome) values ($1,$2,'noperm-mo@teste','No Perm')
                     on conflict (id) do update set tenant_id=excluded.tenant_id`, [uid, TENANT_TESTE]);
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
      const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1,'M noperm') returning id`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv noperm','ate_costura') returning id`, [TENANT_TESTE]);
      // inserir linha pendente é permitido (aprovado null); mudar aprovado sem permissão RAISE.
      await c.query(`insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) values ($1,$2,$3,5)`, [TENANT_TESTE, m.id, cat.id]);
      await expect(
        c.query(`update modelo_servico_mo set aprovado=true where modelo_id=$1`, [m.id]),
      ).rejects.toThrow(/permiss/i);
    });
  });

  it("modelo_mo_resumo devolve estado + totais; cores com REVOKE dos três", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1,'M resumo') returning id`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv resumo','ate_costura') returning id`, [TENANT_TESTE]);
      await c.query(`select salvar_modelo_servico_mo($1, $2::jsonb)`, [m.id, JSON.stringify([{ categoria_terceirizado_id: cat.id, valor: 30 }])]);
      await c.query(`select aprovar_servico_mo($1,$2,true,null)`, [m.id, cat.id]);
      const r = await um<{ resumo: any }>(c, `select modelo_mo_resumo(array[$1]::uuid[]) as resumo`, [m.id]);
      const info = r.resumo[m.id];
      expect(info.estado).toBe("aprovada");
      expect(Number(info.total_aprovado)).toBe(30);
      const priv = await um<{ a: boolean; b: boolean }>(
        c, `select has_function_privilege('anon','public._modelo_mo_resumo_core(uuid[])','EXECUTE') as a,
                   has_function_privilege('authenticated','public._modelo_mo_resumo_core(uuid[])','EXECUTE') as b`,
      );
      expect(priv.a).toBe(false); expect(priv.b).toBe(false);
    });
  });

  it("modelo_mo_resumo MASCARA valor/total p/ quem não pode ver custos (invariante #12)", async () => {
    await withTx(async (c) => {
      // 1) super_admin cria os dados
      await comoUsuario(c);
      const m = await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1,'M mask') returning id`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1,'Serv mask','ate_costura') returning id`, [TENANT_TESTE]);
      await c.query(`select salvar_modelo_servico_mo($1, $2::jsonb)`, [m.id, JSON.stringify([{ categoria_terceirizado_id: cat.id, valor: 42 }])]);
      // 2) usuário SÓ com producao_servico_aprovacao (Editar): abre o gate do wrapper, mas NÃO vê custos
      const uid = "0b0b0b0b-0000-4000-8000-0000000000bb";
      await c.query(`insert into auth.users (id, email) values ($1,'mask-mo@teste') on conflict (id) do nothing`, [uid]);
      await c.query(`insert into public.users (id, tenant_id, email, nome) values ($1,$2,'mask-mo@teste','Mask User')
                     on conflict (id) do update set tenant_id=excluded.tenant_id`, [uid, TENANT_TESTE]);
      await c.query(`insert into public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
                     values ($1,$2,'producao_servico_aprovacao',true,true)`, [uid, TENANT_TESTE]);
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
      const r = await um<{ resumo: any }>(c, `select modelo_mo_resumo(array[$1]::uuid[]) as resumo`, [m.id]);
      const info = r.resumo[m.id];
      expect(info).toBeTruthy(); // gate abriu (tem aprovacao)
      expect(info.estado).toBe("pendente"); // estado sempre visível
      expect(info.total).toBeNull(); // custo mascarado
      expect(info.total_aprovado).toBeNull();
      expect(info.linhas[0].valor).toBeNull();
      expect(info.linhas[0].aprovado).toBeNull(); // metadado (não-custo) visível
    });
  });
});
