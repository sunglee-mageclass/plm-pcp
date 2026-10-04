// @vitest-environment happy-dom
// [modularidade F4, P-254 A] Kanban na tela sabe de módulo: `condicoesForaDoModulo` (espelho de `_kanban_cond_na`), a derivação /
// arraste / "faltando" com o mapa que o servidor devolve (condição de módulo desligado = true) e o diálogo de Requisitos.
import { describe, it, expect, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { CONDICOES, condicoesForaDoModulo } from "@/lib/kanban-condicoes";
import {
  statusDerivado,
  destinoDrop,
  faltandoPara,
  mensagemDrop,
  type DerivacaoInput,
} from "@/lib/kanban-auto";
import type { KanbanStatus } from "@/lib/kanban-status";
import { seloCondicaoNaoSeAplica, motivoCondicaoNaoSeAplica } from "@/lib/modulos-texto";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// "Estado" da RPC: tudo falso, depois as condições que não se aplicam viram true (o `|| z.na` do SQL).
function mapaDaRpc(
  modules: Parameters<typeof condicoesForaDoModulo>[0],
  satisfeitas: string[] = [],
): Record<string, boolean> {
  const m: Record<string, boolean> = Object.fromEntries(CONDICOES.map((c) => [c.key, false]));
  for (const k of satisfeitas) m[k] = true;
  for (const k of condicoesForaDoModulo(modules).keys()) m[k] = true;
  return m;
}

const PROD = [
  "servico_finalizado",
  "grade_cortada_lancada",
  "direcionamento_feito",
  "cq_confirmado",
  "cq_pos_confirmado",
  "cq_liberado",
];
const ES = ["enviado_cad", "cad_preenchido", "enviado_para_pcp", "separar_enviar_preenchido"];

describe("condicoesForaDoModulo", () => {
  it("tudo ligado, vazio, nulo ou chave ausente = nada fora (só `false` explícito desliga, como _tenant_modulo_ligado)", () => {
    expect(condicoesForaDoModulo({ criacao: true, entrada_saida: true, producao: true }).size).toBe(
      0,
    );
    expect(condicoesForaDoModulo({}).size).toBe(0);
    expect(condicoesForaDoModulo(null).size).toBe(0);
    expect(condicoesForaDoModulo(undefined).size).toBe(0);
  });

  it("Produção off → as 6 condições de Produção (módulo que falta = producao)", () => {
    const m = condicoesForaDoModulo({ criacao: true, entrada_saida: true, producao: false });
    expect([...m.keys()].sort()).toEqual([...PROD].sort());
    for (const faltam of m.values()) expect(faltam).toEqual(["producao"]);
  });

  it("Entrada e Saída off → as 4 de Explosão; Criação + E&S off → as mesmas 4, com os 2 módulos faltando", () => {
    const es = condicoesForaDoModulo({ criacao: true, entrada_saida: false, producao: true });
    expect([...es.keys()].sort()).toEqual([...ES].sort());
    for (const faltam of es.values()) expect(faltam).toEqual(["entrada_saida"]);
    const dois = condicoesForaDoModulo({ criacao: false, entrada_saida: false, producao: true });
    expect([...dois.keys()].sort()).toEqual([...ES].sort());
    for (const faltam of dois.values()) expect(faltam).toEqual(["criacao", "entrada_saida"]);
  });

  it("`lancado` e as condições sem `requer` nunca ficam fora (P-252 A); módulos sem relação com o kanban não mexem", () => {
    const tudoOff = condicoesForaDoModulo({
      criacao: false,
      entrada_saida: false,
      producao: false,
      financeiro: false,
      dashboard: false,
      otb: false,
    });
    expect(tudoOff.has("lancado")).toBe(false);
    expect(tudoOff.size).toBe(PROD.length + ES.length);
    expect(
      condicoesForaDoModulo({
        financeiro: false,
        dashboard: false,
        otb: false,
        produto_acabado: false,
      }).size,
    ).toBe(0);
  });
});

describe("derivação, arraste e 'faltando' com o mapa do servidor (condição de módulo desligado = true)", () => {
  // Entrada (manual) · Etapa A {cq_liberado} · Etapa B {data_aprovacao}
  const base = (cond: Record<string, boolean>, status = "entrada"): DerivacaoInput => ({
    fluxo: ["entrada", "etapa_a", "etapa_b"],
    reqs: { etapa_a: ["cq_liberado"], etapa_b: ["data_aprovacao"] },
    exc: {},
    cond,
    status,
    derivavel: true,
  });
  const comProducao = { criacao: true, entrada_saida: true, producao: true };
  const semProducao = { criacao: true, entrada_saida: true, producao: false };

  it("com Produção o card para antes de A; sem Produção passa de A e para em B (a falta é só o que se aplica)", () => {
    const com = statusDerivado(base(mapaDaRpc(comProducao)));
    expect(com.alvo).toBe("entrada");
    expect(com.primeiraFalha).toBe("etapa_a");
    expect(com.faltando).toEqual(["cq_liberado"]);
    const sem = statusDerivado(base(mapaDaRpc(semProducao)));
    expect(sem.alvo).toBe("etapa_a");
    expect(sem.primeiraFalha).toBe("etapa_b");
    expect(sem.faltando).toEqual(["data_aprovacao"]);
  });

  it("sem Produção, com a data de aprovação, o card chega ao fim (nada trava por condição de módulo)", () => {
    const d = statusDerivado(base(mapaDaRpc(semProducao, ["data_aprovacao"])));
    expect(d.alvo).toBe("etapa_b");
    expect(d.primeiraFalha).toBeNull();
    expect(d.faltando).toEqual([]);
  });

  it("arraste: sem Produção A já está cumprida (soltar) e B bloqueia só pelo que se aplica; com Produção A bloqueia por CQ", () => {
    const sem = base(mapaDaRpc(semProducao));
    expect(destinoDrop(sem, "etapa_a")).toEqual({
      acao: "soltar",
      status: "etapa_a",
      faltando: [],
    });
    const paraB = destinoDrop(sem, "etapa_b");
    expect(paraB.acao).toBe("bloquear_faltando");
    expect(paraB.faltando).toEqual(["data_aprovacao"]);
    const com = base(mapaDaRpc(comProducao));
    const paraA = destinoDrop(com, "etapa_a");
    expect(paraA.acao).toBe("bloquear_faltando");
    expect(paraA.faltando).toEqual(["cq_liberado"]);
  });

  it("'Faltam X dados' (faltandoPara + mensagemDrop) não lista a condição de módulo desligado", () => {
    const sem = base(mapaDaRpc(semProducao));
    expect(faltandoPara(sem, "etapa_b")).toEqual(["data_aprovacao"]);
    const msg = mensagemDrop(destinoDrop(sem, "etapa_b"), "etapa_b", [
      { key: "entrada", label: "Entrada" },
      { key: "etapa_a", label: "Etapa A" },
      { key: "etapa_b", label: "Etapa B" },
    ] as KanbanStatus[]);
    expect(msg).toBe("Falta 1 dado para completar: Data de Aprovação preenchida");
    expect(msg).not.toMatch(/CQ/);
    // com Produção, a mesma coluna A cobra o CQ e a mensagem o cita
    const msgCom = mensagemDrop(
      destinoDrop(base(mapaDaRpc(comProducao)), "etapa_b"),
      "etapa_b",
      [] as KanbanStatus[],
    );
    expect(msgCom).toContain("CQ liberado");
  });

  it("cascata: requisito de módulo desligado numa etapa ANTERIOR é herdado e continua contando como cumprido", () => {
    const semES = { criacao: true, entrada_saida: false, producao: true };
    const input: DerivacaoInput = {
      fluxo: ["entrada", "etapa_a", "etapa_b"],
      reqs: { etapa_a: ["enviado_cad"], etapa_b: ["data_aprovacao"] },
      exc: {},
      cond: mapaDaRpc(semES, ["data_aprovacao"]),
      status: "entrada",
      derivavel: true,
    };
    expect(statusDerivado(input).alvo).toBe("etapa_b");
  });
});

describe("textos do selo 'não se aplica'", () => {
  it("singular e plural, com os rótulos de MODULE_ROTULO", () => {
    expect(seloCondicaoNaoSeAplica(["producao"])).toBe("não se aplica (módulo Produção desligado)");
    expect(seloCondicaoNaoSeAplica(["criacao", "entrada_saida"])).toBe(
      "não se aplica (módulos Criação e Entrada e Saída desligados)",
    );
  });
  it("o motivo diz que o card segue e NÃO promete desfazer o que o avanço já liberou (REF)", () => {
    const t = motivoCondicaoNaoSeAplica(["producao"]);
    expect(t).toContain("a loja não tem o módulo Produção");
    expect(t).toContain("o card segue");
    expect(t).toContain("não desfaz");
    expect(t).toContain("REF");
  });
});

// ── diálogo de Requisitos ──────────────────────────────────────────────────────────────────────────────────────────
vi.mock("@/components/shared/CondicaoInfo", () => ({ CondicaoInfo: () => null }));
import { RequisitosStatusButton } from "@/components/admin/RequisitosStatusDialog";

async function abrir(
  props: Record<string, unknown>,
): Promise<{ root: ReturnType<typeof createRoot>; onChange: ReturnType<typeof vi.fn> }> {
  const onChange = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(RequisitosStatusButton, {
        label: "Etapa A",
        requisitos: [],
        onChange,
        ...props,
      } as unknown as Parameters<typeof RequisitosStatusButton>[0]),
    );
  });
  // abre o diálogo e expande os módulos (accordion) que têm condição de módulo
  await act(async () => {
    (container.querySelector("button") as HTMLButtonElement).click();
  });
  for (const t of Array.from(
    document.body.querySelectorAll('[role="dialog"] button[aria-expanded]'),
  )) {
    await act(async () => {
      (t as HTMLButtonElement).click();
    });
  }
  return { root, onChange };
}
const rotulos = () =>
  Array.from(document.body.querySelectorAll('[role="dialog"] label')) as HTMLLabelElement[];
const linha = (texto: string) =>
  rotulos().find((l) => l.textContent?.includes(texto)) as HTMLLabelElement;

describe("RequisitosStatusButton — condição de módulo desligado", () => {
  const modOff = () =>
    condicoesForaDoModulo({ criacao: true, entrada_saida: true, producao: false });

  it("não se aplica: esmaecida, desabilitada, com o selo e o motivo; as que se aplicam seguem normais; clique não adiciona", async () => {
    const { root, onChange } = await abrir({ condsModuloOff: modOff() });
    const cq = linha("CQ liberado");
    expect(cq, "linha da condição de Produção").toBeTruthy();
    expect(cq.className).toContain("opacity-50");
    expect(cq.textContent).toContain("não se aplica (módulo Produção desligado)");
    expect(cq.title).toContain("a loja não tem o módulo Produção");
    const caixa = cq.querySelector('button[role="checkbox"]') as HTMLButtonElement;
    expect(caixa.disabled).toBe(true);
    await act(async () => {
      caixa.click();
    });
    expect(onChange).not.toHaveBeenCalled();
    const normal = linha("Estilista definido");
    expect(normal.className).not.toContain("opacity-50");
    expect(normal.textContent).not.toContain("não se aplica");
    act(() => root.unmount());
  });

  it("já gravada: continua marcada, selo âmbar, conta fora do contador, e pode ser REMOVIDA (não re-adicionada)", async () => {
    const { root, onChange } = await abrir({
      condsModuloOff: modOff(),
      requisitos: ["cq_liberado", "estilista_definido"],
    });
    const cq = linha("CQ liberado");
    const caixa = cq.querySelector('button[role="checkbox"]') as HTMLButtonElement;
    expect(caixa.getAttribute("aria-checked")).toBe("true");
    expect(caixa.disabled).toBe(false);
    expect(cq.className).not.toContain("opacity-50");
    const selo = cq.querySelector('[data-testid="cond-nao-se-aplica"]') as HTMLElement;
    expect(selo.className).toContain("bg-amber-100");
    // contador do botão: só a que se aplica (a de módulo desligado fica gravada mas não conta)
    expect(document.body.textContent).toContain("Requisitos (1)");
    await act(async () => {
      caixa.click();
    });
    expect(onChange).toHaveBeenCalledWith(["estilista_definido"]);
    act(() => root.unmount());
  });

  it("herdada de etapa anterior: travada (sem abrir exceção para o que não se aplica), selo âmbar", async () => {
    const onExc = vi.fn();
    const { root } = await abrir({
      condsModuloOff: modOff(),
      herdados: [{ key: "cq_liberado", origem: "entrada" }],
      onExcecoesChange: onExc,
      nomeEtapa: (k: string) => k,
    });
    const cq = linha("CQ liberado");
    const caixa = cq.querySelector('button[role="checkbox"]') as HTMLButtonElement;
    expect(caixa.disabled).toBe(true);
    expect(cq.textContent).toContain("herdado");
    expect(
      (cq.querySelector('[data-testid="cond-nao-se-aplica"]') as HTMLElement).className,
    ).toContain("bg-amber-100");
    act(() => root.unmount());
  });

  it("sem `condsModuloOff` o diálogo é o de sempre (nada esmaecido); revenda: 'n/a revenda' tem precedência sobre o selo", async () => {
    const { root } = await abrir({});
    expect(rotulos().some((l) => l.textContent?.includes("não se aplica"))).toBe(false);
    act(() => root.unmount());
    document.body.replaceChildren();
    const r2 = await abrir({
      condsModuloOff: condicoesForaDoModulo({ criacao: true, entrada_saida: false }),
      condsIndisponiveis: ["enviado_cad"],
    });
    const env = linha("Enviado à Explosão");
    expect(env.textContent).toContain("n/a revenda");
    expect(env.textContent).not.toContain("não se aplica (módulo");
    const sep = linha("Separar/Enviar preenchido");
    expect(sep.textContent).toContain("não se aplica (módulo Entrada e Saída desligado)");
    act(() => r2.root.unmount());
  });
});
