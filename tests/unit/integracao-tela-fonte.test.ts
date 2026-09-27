import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
import { abasVisiveis } from "@/lib/integracao/abas";

const ler = (p: string) => readFileSync(p, "utf8");

describe("Integração — permissão, menu e abas por papel (P-65 A, P-74 A, P-81 A, v4)", () => {
  it("ModuleDef próprio 'integracao' no FIM do catálogo, página única (link direto)", () => {
    const ult = PAGES_CATALOG[PAGES_CATALOG.length - 1];
    expect(ult).toMatchObject({ module: "integracao", label: "Integração", basePath: "/integracao" });
    expect(ult.pages.map((p) => p.key)).toEqual(["integracao"]);
  });
  it("fora dos interruptores de contratação (como o importar — nota 12)", () => {
    expect(ler("src/routes/_authenticated/admin/lojas.tsx")).toMatch(/key === "importar" \|\| key === "integracao"/);
  });
  it("D26 (opção A): o diálogo de Reset avisa que apaga a Integração da loja", () => {
    expect(ler("src/routes/_authenticated/admin/lojas.tsx")).toMatch(/Apaga também a Integração da loja/);
  });
  it("super admin tem o item também no Admin Mestre", () => {
    const s = ler("src/components/app-sidebar.tsx");
    const i = s.indexOf("Admin Mestre");
    expect(s.indexOf('to="/integracao"', i)).toBeGreaterThan(i);
  });
  it("abas: super admin vê as 5; admin/permissão só Produtos e Log", () => {
    expect(abasVisiveis(true)).toEqual(["produtos", "campos", "api", "manual", "log"]);
    expect(abasVisiveis(false)).toEqual(["produtos", "log"]);
  });
  it("rota protegida pela permissão 'integracao'", () => {
    expect(ler("src/routes/_authenticated/integracao.tsx")).toMatch(/<RequirePermission page="integracao">/);
  });
});

describe("Integração — guarda única de alterações não salvas", () => {
  it("1 useUnsavedGuard na página (blockNav) e trocar de aba passa pela confirmação", () => {
    const s = ler("src/components/integracao/IntegracaoPage.tsx");
    expect(s.match(/useUnsavedGuard\(/g)?.length).toBe(1);
    expect(s).toMatch(/blockNav: true/);
    expect(s).toMatch(/requestAction\(\(\) => setAba\(/);
    expect(s).toMatch(/<UnsavedChangesGuard confirm=\{confirm\} \/>/);
  });
  it("nenhuma aba cria a própria guarda (2 useBlocker brigariam)", () => {
    for (const f of ["ProdutosAba", "CamposAba", "ApiAba", "ManualAba", "LogAba"]) {
      const p = `src/components/integracao/${f}.tsx`;
      if (!existsSync(p)) continue;
      expect(ler(p), f).not.toMatch(/useUnsavedGuard\(/);
    }
  });
});

// Fix round 1 — I2 (task-11-review.md + task-11-code-review.md): checagem de fonte (em vez de renderHook, sem
// precedente na suíte unit deste repo) para a mutationKey do Salvar e o gate do Realtime contra ela; e M5 para o
// sufixo único do canal.
describe("useIntegracao — Salvar tem mutationKey e o Realtime não relista no meio dele (I2); canal com sufixo único (M5)", () => {
  const s = ler("src/components/integracao/useIntegracao.ts");
  it("useSalvarIntegracao declara mutationKey própria (chaveMutationSalvar)", () => {
    expect(s).toMatch(/mutationKey:\s*chaveMutationSalvar\(tenantId\)/);
  });
  it("useIntegracaoAoVivo consulta qc.isMutating com a MESMA mutationKey antes de invalidar", () => {
    const i = s.indexOf("function useIntegracaoAoVivo");
    expect(i).toBeGreaterThan(-1);
    const trecho = s.slice(i, s.indexOf("\n}", s.indexOf("ch.subscribe()", i)));
    expect(trecho).toMatch(/qc\.isMutating\(\{\s*mutationKey:\s*chaveMutationSalvar\(tenantId\)\s*\}\)/);
    // a invalidação só roda quando isMutating NÃO achou nada (o "> 0" seguido de um return/guarda antes do invalidate)
    expect(trecho.indexOf("isMutating")).toBeLessThan(trecho.indexOf("invalidateQueries"));
  });
  it("o canal Realtime usa um sufixo por montagem (nunca reaproveita um tópico 'velho')", () => {
    const i = s.indexOf("function useIntegracaoAoVivo");
    const trecho = s.slice(i, s.indexOf("ch.subscribe()", i));
    expect(trecho).toMatch(/Math\.random\(\)/);
    expect(trecho).not.toMatch(/getChannels\(\)\.find/);
  });
});
