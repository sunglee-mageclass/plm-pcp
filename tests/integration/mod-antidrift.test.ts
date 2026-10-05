// Modularidade D1 (plano §11) — anti-drift da frente. Só LEITURA do catálogo (pg_proc / pg_policies / pg_publication_tables) numa
// txn revertida, SÓ na cópia local; mais leitura do TEXTO-FONTE do front. Nada de DDL fora da txn (aplicaMod = mig-txn).
//   (a) todo portão de módulo das RPCs (`_exige_modulos`) usa chave que existe em `ModuleKey` (T1 M5) e os módulos do portão
//       ficam dentro de {dono} ∪ MODULE_DEPS[dono].exige (o mapa de dependências do front é a fonte dos avisos da tela);
//   (b) a lista de módulos OPT-IN (default OFF) é IGUAL em `tenant_module_enabled`, `_tenant_modulo_ligado`,
//       `useTenantModules.DEFAULTS` e `admin/lojas.tsx MODULE_DEFAULTS`;
//   (c) T5/M12: nenhuma tabela da publicação `supabase_realtime` tem policy RESTRICTIVE de SELECT/ALL, EXCETO a lista conhecida
//       (a leitura do Realtime roda sem contexto de tenant: RESTRICTIVE de SELECT derruba o canal — lição do merge colaborativo).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx } from "./db";
import { aplicaMod } from "./mod-helpers";
import { MODULE_DEPS, PAGES_CATALOG } from "../../src/lib/permissions-catalog";

const RODA = hasDb && ehBancoLocal();
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (p: string) => readFileSync(ROOT + p, "utf8");

// ── fontes do front (texto) ───────────────────────────────────────────────────────────────────────────────────────────────
/** `ModuleKey` = a união de literais de `useTenantModules.ts`. */
function moduleKeys(): string[] {
  const src = ler("src/hooks/useTenantModules.ts");
  const bloco = src.match(/export type ModuleKey =([\s\S]*?);/);
  expect(bloco, "type ModuleKey não encontrado").toBeTruthy();
  return [...bloco![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}
/** Chaves `false` de um literal de objeto (`DEFAULTS` / `MODULE_DEFAULTS`). */
function chavesFalse(src: string, abre: RegExp): string[] {
  const i = src.search(abre);
  expect(i, `bloco ${abre} não encontrado`).toBeGreaterThanOrEqual(0);
  const fim = src.indexOf("};", i);
  return [...src.slice(i, fim).matchAll(/^\s*([a-z_]+):\s*false\b/gm)].map((m) => m[1]).sort();
}
/** Lista `NOT IN ('a','b',…)` do SQL de `tenant_module_enabled` / `_tenant_modulo_ligado` (comentários fora). */
function optInDoSql(def: string): string[] {
  const sem = def.replace(/--.*$/gm, "");
  const m = sem.match(/NOT IN \(([^)]*)\)/);
  expect(m, "lista NOT IN não encontrada").toBeTruthy();
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}
// Corpo sem comentários de linha (--) nem de bloco: uma função que só CITA o helper num comentário não conta como chamada.
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

// ── (a) dono de cada RPC com portão ──────────────────────────────────────────────────────────────────────────────────────
// Toda RPC com `_exige_modulos` tem de cair numa linha desta tabela (RPC nova com portão = acrescentar aqui, com o dono).
const DONOS: { re: RegExp; dono: string; extras?: string[] }[] = [
  // Dashboards: o dono é o módulo Dashboard. A aba Custo & Financeiro lê dado do FINANCEIRO, então o portão dessa RPC soma o
  // módulo do dado (M7); fora esse caso, nada além do dono.
  { re: /^dashboard_financeiro$/, dono: "dashboard", extras: ["financeiro"] },
  { re: /^(dashboard_.+|ranking_servicos|ranking_oficinas)$/, dono: "dashboard" },
  // Explosão (T1: Criação + E&S; o portão de módulo da RPC é o de E&S, a Criação segue pelo gate de página/estado do card).
  {
    re: /^(baixar_estoque_tecido_corte|salvar_explosao_.+|voltar_modelo_desenvolvimento|reverter_corte_tecido|enviar_modelo_para_cad)$/,
    dono: "entrada_saida",
  },
  // Plan. Tecido = OTB (P-253 A).
  {
    re: /^(plan_tecido_.+|salvar_plan_tecido|aplicar_plan_tecido_grade|replicar_cards_plan_tecido)$/,
    dono: "otb",
  },
  // Revenda / Importado (P9).
  { re: /^(criar_cards?_produto_acabado|receber_oc_p_acabado)$/, dono: "produto_acabado" },
  { re: /^(criar_cards?_produto_importado|receber_oc_importado)$/, dono: "produto_importado" },
  // Urgentes R2 T10 (20261103175000): BOM inicial de insumo do card interno novo = Criacao.
  { re: /^salvar_insumos_iniciais$/, dono: "criacao" },
];

const ASSINATURA_CHAMADA = /\b_exige_modulos\(([^)]*)\)/g;
const LITERAL = /'([^']*)'/g;

describe.skipIf(!RODA)(
  "mod anti-drift — portões de módulo, opt-in e Realtime × RESTRICTIVE",
  () => {
    it("(a) toda chave usada nos portões (`_exige_modulos`, `_tenant_modulo_ligado`, `tenant_module_enabled`) existe em ModuleKey", async () => {
      const validas = new Set(moduleKeys());
      expect(validas.size).toBeGreaterThanOrEqual(11);
      await withTx(async (c) => {
        await aplicaMod(c);
        const { rows } = await c.query<{ proname: string; prosrc: string }>(
          `SELECT proname, prosrc FROM pg_proc
          WHERE pronamespace = 'public'::regnamespace
            AND prosrc ~ '(_exige_modulos|_tenant_modulo_ligado|tenant_module_enabled)'
            AND proname NOT IN ('_exige_modulos', '_tenant_modulo_ligado', 'tenant_module_enabled')`,
        );
        expect(rows.length).toBeGreaterThan(30);
        const ruins: string[] = [];
        let chamadas = 0;
        for (const r of rows) {
          const src = semComentarios(r.prosrc);
          for (const m of src.matchAll(ASSINATURA_CHAMADA)) {
            const lits = [...m[1].matchAll(LITERAL)].map((x) => x[1]);
            // portão por literal: argumento que não é literal escaparia da validação
            const resto = m[1].replace(LITERAL, "").replace(/[\s,]/g, "");
            if (resto !== "")
              ruins.push(
                `${r.proname}: _exige_modulos com argumento que não é literal (${m[1].trim()})`,
              );
            for (const k of lits) {
              chamadas++;
              if (!validas.has(k))
                ruins.push(`${r.proname}: _exige_modulos('${k}') — chave fora de ModuleKey`);
            }
          }
          for (const m of src.matchAll(/\btenant_module_enabled\(\s*'([^']*)'\s*\)/g))
            if (!validas.has(m[1]))
              ruins.push(
                `${r.proname}: tenant_module_enabled('${m[1]}') — chave fora de ModuleKey`,
              );
          for (const m of src.matchAll(/\b_tenant_modulo_ligado\([^,()]+,\s*'([^']*)'\s*\)/g))
            if (!validas.has(m[1]))
              ruins.push(
                `${r.proname}: _tenant_modulo_ligado(…, '${m[1]}') — chave fora de ModuleKey`,
              );
        }
        expect(chamadas).toBeGreaterThanOrEqual(37); // sanidade: os 37 wrappers da T1 (+ os de várias chaves)
        expect(ruins).toEqual([]);

        // políticas (RLS) também chamam tenant_module_enabled('x')
        const pol = await c.query<{ tablename: string; policyname: string; t: string }>(
          `SELECT tablename, policyname, coalesce(qual,'') || ' ' || coalesce(with_check,'') AS t
           FROM pg_policies WHERE schemaname = 'public' AND (qual ~ 'tenant_module_enabled' OR with_check ~ 'tenant_module_enabled')`,
        );
        const ruinsPol: string[] = [];
        for (const p of pol.rows)
          for (const m of p.t.matchAll(/tenant_module_enabled\(\s*'([^']*)'(?:::text)?\s*\)/g))
            if (!validas.has(m[1])) ruinsPol.push(`${p.tablename}.${p.policyname}: '${m[1]}'`);
        expect(ruinsPol).toEqual([]);
      });
    });

    it("(a) módulos do portão de cada RPC ⊆ {dono} ∪ MODULE_DEPS[dono].exige (+ extras declarados); RPC com portão sem dono declarado falha", async () => {
      await withTx(async (c) => {
        await aplicaMod(c);
        const { rows } = await c.query<{ proname: string; prosrc: string }>(
          `SELECT proname, prosrc FROM pg_proc
          WHERE pronamespace = 'public'::regnamespace AND prosrc ~ '_exige_modulos' AND proname <> '_exige_modulos'`,
        );
        const sem = rows
          .map((r) => ({ nome: r.proname, src: semComentarios(r.prosrc) }))
          .filter((r) => /\b_exige_modulos\(/.test(r.src));
        expect(sem.length).toBeGreaterThanOrEqual(37);
        const problemas: string[] = [];
        for (const r of sem) {
          const d = DONOS.find((x) => x.re.test(r.nome));
          if (!d) {
            problemas.push(
              `${r.nome}: tem portão de módulo mas nenhum dono declarado em DONOS (acrescente a linha)`,
            );
            continue;
          }
          const permitidos = new Set<string>([
            d.dono,
            ...(MODULE_DEPS[d.dono as keyof typeof MODULE_DEPS]?.exige ?? []),
            ...(d.extras ?? []),
          ]);
          for (const m of r.src.matchAll(ASSINATURA_CHAMADA))
            for (const k of [...m[1].matchAll(LITERAL)].map((x) => x[1]))
              if (!permitidos.has(k))
                problemas.push(
                  `${r.nome}: portão exige '${k}' fora de {${[...permitidos].join(", ")}} (dono ${d.dono})`,
                );
        }
        expect(problemas).toEqual([]);
      });
    });

    it("(a) o `gate` de página do front bate com o portão das RPCs: Plan. Tecido = otb em todas as RPCs do Plan. Tecido; Explosão = o módulo da página (E&S) em todas as RPCs da Explosão", async () => {
      const paginas = PAGES_CATALOG.flatMap((m) =>
        m.pages.map((p) => ({ ...p, modulo: m.module })),
      );
      const planTecido = paginas.find((p) => p.key === "criacao_plan_tecido")!;
      const explosao = paginas.find((p) => p.key === "producao_explosao")!;
      expect(planTecido.gate).toBe("otb"); // Plan. Tecido = OTB (P-253 A)
      expect(explosao.modulo).toBe("entrada_saida"); // a página mora em Entrada e Saída
      expect(explosao.gate).toBe("criacao"); // Explosão = Criação + E&S (T1): a Criação é o `gate`, o módulo da página é o E&S
      await withTx(async (c) => {
        await aplicaMod(c);
        const { rows } = await c.query<{ proname: string; prosrc: string }>(
          `SELECT proname, prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc ~ '_exige_modulos' AND proname <> '_exige_modulos'`,
        );
        const portoes = (nome: string) =>
          [
            ...semComentarios(rows.find((r) => r.proname === nome)!.prosrc).matchAll(
              ASSINATURA_CHAMADA,
            ),
          ].flatMap((m) => [...m[1].matchAll(LITERAL)].map((x) => x[1]));
        const doDono = (dono: string) =>
          rows.map((r) => r.proname).filter((n) => DONOS.find((d) => d.re.test(n))?.dono === dono);
        const rpcsPlanTecido = doDono("otb");
        expect(rpcsPlanTecido.length).toBeGreaterThanOrEqual(12);
        for (const n of rpcsPlanTecido) expect(portoes(n), n).toContain(planTecido.gate);
        const rpcsExplosao = doDono("entrada_saida");
        expect(rpcsExplosao.length).toBeGreaterThanOrEqual(7);
        for (const n of rpcsExplosao) expect(portoes(n), n).toContain(explosao.modulo);
      });
    });

    it("(b) a lista opt-in (default OFF) é IGUAL no SQL (tenant_module_enabled, _tenant_modulo_ligado) e no front (DEFAULTS, MODULE_DEFAULTS)", async () => {
      const front = chavesFalse(
        ler("src/hooks/useTenantModules.ts"),
        /const DEFAULTS: Record<ModuleKey, boolean> = \{/,
      );
      const lojas = chavesFalse(
        ler("src/routes/_authenticated/admin/lojas.tsx"),
        /const MODULE_DEFAULTS: Record<string, boolean> = \{/,
      );
      expect(front.length).toBeGreaterThanOrEqual(5);
      expect(lojas).toEqual(front);
      await withTx(async (c) => {
        await aplicaMod(c);
        const def = async (sig: string) =>
          (
            await c.query<{ d: string }>("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
              sig,
            ])
          ).rows[0].d;
        const sqlTme = optInDoSql(await def("public.tenant_module_enabled(text)"));
        const sqlLig = optInDoSql(await def("public._tenant_modulo_ligado(uuid,text)"));
        expect(sqlTme).toEqual(front);
        expect(sqlLig).toEqual(front);
      });
      // toda ModuleKey tem padrão no front; o que não é opt-in é módulo "clássico" (default ligado)
      const todas = moduleKeys();
      const defaultsSrc = ler("src/hooks/useTenantModules.ts").match(
        /const DEFAULTS: Record<ModuleKey, boolean> = \{([\s\S]*?)\};/,
      )![1];
      for (const k of todas)
        expect(defaultsSrc, `DEFAULTS sem a chave ${k}`).toMatch(
          new RegExp(`\\b${k}:\\s*(true|false)`),
        );
    });

    it("(c) Realtime × RESTRICTIVE: nenhuma tabela da publicação supabase_realtime tem policy RESTRICTIVE de SELECT/ALL, exceto a lista conhecida (M12)", async () => {
      // Lista CONHECIDA (achado M12, ruling R2 — vai para a frente Backend: DROP POLICY trava auth/storage, horário calmo).
      const CONHECIDAS = new Set([
        "produtos_acabados.modgate_sel",
        "produtos_importados.modgate_pi_sel",
      ]);
      await withTx(async (c) => {
        const { rows } = await c.query<{ t: string; p: string; cmd: string }>(
          `SELECT pt.tablename AS t, p.policyname AS p, p.cmd
           FROM pg_publication_tables pt
           JOIN pg_policies p ON p.schemaname = pt.schemaname AND p.tablename = pt.tablename
          WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
            AND p.permissive = 'RESTRICTIVE' AND p.cmd IN ('SELECT', 'ALL')`,
        );
        const achadas = new Set(rows.map((r) => `${r.t}.${r.p}`));
        const novas = [...achadas].filter((x) => !CONHECIDAS.has(x));
        expect(
          novas,
          "tabela do Realtime com policy RESTRICTIVE de leitura que NÃO está na lista conhecida",
        ).toEqual([]);
        // a lista conhecida não apodrece: se alguém tirou a policy (frente Backend), tirar daqui também
        const sumiram = [...CONHECIDAS].filter((x) => !achadas.has(x));
        expect(sumiram, "policy conhecida já não existe — remova da lista CONHECIDAS").toEqual([]);
      });
    });
  },
);
