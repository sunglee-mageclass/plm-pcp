// [modularidade F2] Anti-regressão em texto-fonte (o repo faz isso onde render completo é caro): os botões que atravessam módulo
// continuam pedindo o módulo ANTES do clique, e o editor de permissões nunca tira a linha do payload.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");

describe("F4a — Enviar à Explosão pede Entrada e Saída", () => {
  const detail = ler("src/components/planejamento/PlanejamentoDetail.tsx");
  const hook = ler("src/components/planejamento/planejamento-detail/useEnviarExplosao.ts");
  it("o motivo do módulo é o PRIMEIRO bloqueio do botão e o InfoHover cobre o celular", () => {
    expect(detail).toContain('const requerEs = useRequerModulo("entrada_saida");');
    expect(detail).toMatch(/!mostraEnviarExplosao \? null\s*\n\s*: !requerEs\.ok \? requerEs\.motivo/);
    expect(detail).toContain('<InfoHover ariaLabel="Por que não envia à Explosão">');
  });
  it("o mutationFn recusa antes de chamar a RPC", () => {
    expect(detail).toContain("bloqueioModulo: requerEs.ok ? null : requerEs.motivo");
    const i = hook.indexOf("if (bloqueioModulo) throw");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(hook.indexOf('supabase.rpc("enviar_modelo_para_cad"'));
  });
});

describe("F4b — Fazer pedido pede Entrada e Saída", () => {
  const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
  it("botão desabilitado + guarda no handler + motivo", () => {
    expect(sheet).toContain('useRequerModulo("entrada_saida")');
    expect(sheet).toContain("disabled={preparandoPedidoSelecao || !requerEsPedido.ok}");
    expect(sheet).toMatch(/function handleFazerPedidoSelecaoClick\(\) \{\s*\n\s*if \(!requerEsPedido\.ok\)/);
  });
});

describe("T1 M2 — reverter corte em PCP › Serviços", () => {
  const f = ler("src/routes/_authenticated/pcp.servicos.$modeloId.tsx");
  it("o botão some sem Entrada e Saída", () => {
    expect(f).toContain('const podeReverterCorte = useRequerModulo("entrada_saida").ok;');
    expect(f).toContain("const voltarEtapaButton = cad?.id && podeReverterCorte ? (");
  });
});

describe("F10 — editor de permissões", () => {
  const f = ler("src/components/admin/PermissoesModal.tsx");
  it("o payload sai do estado inteiro (página esmaecida NÃO é filtrada)", () => {
    expect(f).toContain(".map((k) => ({ pagina: k, ...state[k] }))");
    expect(f).not.toMatch(/\.filter\(\(k\) => !desligada/);
  });
  it("lê os módulos da loja do usuário/papel EDITADO, não da loja ativa", () => {
    expect(f).toContain("useModulosDaLoja(user.tenant_id)");
    expect(f).toContain("useModulosDaLoja(papel.tenant_id)");
  });
});

describe("F11 — Receber OC de Tecido", () => {
  const f = ler("src/routes/_authenticated/entrada-saida.oc-tecido.tsx");
  it("só promete contas a pagar com o Financeiro ligado", () => {
    expect(f).toContain('const financeiroOn = useRequerModulo("financeiro").ok;');
    expect(f).toMatch(/\{financeiroOn \? \(\s*\n\s*<>\s*\n\s*Isto registra a entrada e gera as contas a pagar no Financeiro/);
  });
});
