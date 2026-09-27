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

// Fix round 2 — Important R1 (task-11-review.md "Re-review round 1") / I3 (task-11-code-review.md "Re-check round
// 1"): o debounce da rodada 1 comparava um OBJETO recriado a cada render por `===`, o que nunca vale e gera um
// re-render a cada 300ms para sempre. Checagem de fonte (mesma justificativa da I2/M5 acima — sem precedente de
// `renderHook` na suíte unit deste repo para testar esse loop com fake timers de verdade): `useValorAtrasado` só
// aceita `string`, e `usePreviasSkus` atrasa um `JSON.stringify` (nunca o objeto `entradas` cru).
describe("useIntegracao — useValorAtrasado só aceita string (I3); queryFn deriva da chave, não do 'e' do render (N1); previaDeErro usa a chave (N2)", () => {
  const s = ler("src/components/integracao/useIntegracao.ts");
  it("useValorAtrasado(valor: string, ...) — nunca um objeto/array/generic", () => {
    const i = s.indexOf("function useValorAtrasado");
    expect(i).toBeGreaterThan(-1);
    const assinatura = s.slice(i, s.indexOf(")", i) + 1);
    expect(assinatura).toMatch(/function useValorAtrasado\(valor: string, ms: number\)/);
    expect(assinatura).not.toMatch(/<T>/);
  });
  it("usePreviasSkus atrasa JSON.stringify(entradas), nunca o objeto cru", () => {
    const i = s.indexOf("function usePreviasSkus");
    const trecho = s.slice(i, s.indexOf("useQueries(", i));
    expect(trecho).toMatch(/useValorAtrasado\(entradasStr,\s*300\)/);
    expect(trecho).toMatch(/JSON\.stringify\(entradas\)/);
    expect(trecho).toMatch(/JSON\.parse\(entradasStrAtrasada\)/);
    expect(trecho).toMatch(/useMemo\(/);
    // nunca a chamada antiga (regressão da rodada 1): useValorAtrasado direto no objeto `entradas`.
    expect(trecho).not.toMatch(/useValorAtrasado\(entradas,/);
  });
  it("o queryFn deriva ref/tamanhoTipo/manuais/modo de entradaDaChave(chave), não do 'e' do render (N1)", () => {
    const i = s.indexOf("function usePreviasSkus");
    const trecho = s.slice(i, s.indexOf("function previaDeErro", i));
    expect(trecho).toMatch(/const ed = entradaDaChave\(chave\)/);
    expect(trecho).toMatch(/_ref:\s*ed\.ref/);
    expect(trecho).toMatch(/_tamanho_tipo:\s*ed\.tamanhoTipo/);
    expect(trecho).toMatch(/_manuais:\s*ed\.manuais/);
    expect(trecho).toMatch(/_modo:\s*ed\.modo/);
  });
  it("previaDeErro usa a chave da query como 'entrada' (N2), nunca o literal 'erro'", () => {
    const i = s.indexOf("function previaDeErro");
    expect(i).toBeGreaterThan(-1);
    const trecho = s.slice(i, s.indexOf("\n}", i));
    expect(trecho).toMatch(/entrada:\s*chave,/);
    expect(trecho).not.toMatch(/entrada:\s*"erro"/);
  });
});

// Fix round 2 — Minor R2/R3 (task-11-review.md) / N3 (task-11-code-review.md): sem cópias locais de textos já
// exportados, e o erro de resultado desconhecido preserva a causa original.
describe("salvar-integracao — sem textos duplicados (N3); cause preservada (R3)", () => {
  const s = ler("src/components/integracao/salvar-integracao.ts");
  it("importa TEXTO_FOTOS_SEM_UPLOAD e PREFIXO_SKUS_NAO_GRAVADOS, sem cópias locais", () => {
    expect(s).toMatch(/TEXTO_FOTOS_SEM_UPLOAD/);
    expect(s).toMatch(/PREFIXO_SKUS_NAO_GRAVADOS/);
    expect(s).not.toMatch(/TEXTO_FOTOS_NOVAS_PERDIDAS/);
    expect(s).not.toMatch(/PREFIXO_SKUS_NAO_GRAVADOS_LOCAL/);
  });
  it("o erro de resultado desconhecido leva { cause: e }", () => {
    expect(s).toMatch(/new Error\(TEXTO_RESULTADO_DESCONHECIDO,\s*\{\s*cause:\s*e\s*\}\)/);
  });
});
