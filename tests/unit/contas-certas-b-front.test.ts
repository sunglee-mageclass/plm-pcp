// Contas certas — bloco B, parte FRONT (helpers puros + asserções de fonte).
//  • item 7: `pecasReaisLiberadas` (Realizado só com CQ liberado) — fonte única do Planejamento e do Dashboard Comercial;
//  • item 8: `moLinhaVaiReabrir` + dica âmbar no MaoObraEditor (linha aprovada/reprovada com valor/serviço mudado);
//  • item 9b: `numeroDaPrevia` + as 2 prévias leem `ref_proximo_numero`.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cqLiberado, pecasReaisLiberadas } from "@/lib/cq-status";
import {
  moLinhaVaiReabrir,
  TEXTO_MO_VAI_REABRIR,
  TEXTO_MO_SALVE_ANTES,
  type MoLinha,
} from "@/lib/mao-obra";
import { numeroDaPrevia } from "@/lib/ref-montar";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");

// ─────────────────────────────── item 7 ───────────────────────────────
type Row = Parameters<typeof pecasReaisLiberadas>[0] extends (infer R)[] | null | undefined
  ? R
  : never;
const cad = (
  modelo: string,
  cq: { status?: string; status_pos?: string } | null,
  total: number[],
  pos: "sem" | "ativo" | "inativo" = "sem",
): Row => ({
  modelo_id: modelo,
  controle_qualidade: cq ? [cq] : [],
  producao_terceirizados:
    pos === "sem"
      ? []
      : [{ ativo: pos === "ativo", categorias_terceirizado: { etapa: "pos_costura" } }],
  cad_grades: total.map((t) => ({ grade_total_real: t })),
});

describe("item 7 — pecasReaisLiberadas (Realizado só com CQ liberado)", () => {
  it("sem CQ: fora", () => {
    expect(pecasReaisLiberadas([cad("m1", null, [10, 5])])).toEqual({});
  });
  it("CQ pendente: fora", () => {
    expect(pecasReaisLiberadas([cad("m1", { status: "pendente" }, [10])])).toEqual({});
  });
  it("Pré confirmado, sem pós-costura: conta", () => {
    expect(pecasReaisLiberadas([cad("m1", { status: "confirmado" }, [10, 5])])).toEqual({ m1: 15 });
  });
  it("Pré confirmado COM pós-costura ativo e Pós pendente: fora", () => {
    expect(
      pecasReaisLiberadas([
        cad("m1", { status: "confirmado", status_pos: "pendente" }, [10], "ativo"),
      ]),
    ).toEqual({});
  });
  it("pós-costura INATIVO não exige o Pós: conta", () => {
    expect(
      pecasReaisLiberadas([
        cad("m1", { status: "confirmado", status_pos: "pendente" }, [10], "inativo"),
      ]),
    ).toEqual({ m1: 10 });
  });
  it("tudo liberado (Pré + Pós): conta; vários CADs do mesmo modelo somam; strings numéricas ok; soma 0 fica fora", () => {
    const rows = [
      cad("m1", { status: "confirmado", status_pos: "confirmado" }, [10], "ativo"),
      {
        ...cad("m1", { status: "confirmado" }, []),
        cad_grades: [{ grade_total_real: "7" as unknown as number }],
      },
      cad("m2", { status: "confirmado" }, [0]),
      { ...cad("m3", { status: "confirmado" }, [3]), modelo_id: null },
    ];
    expect(pecasReaisLiberadas(rows)).toEqual({ m1: 17 });
    expect(pecasReaisLiberadas(null)).toEqual({});
  });
  it("usa o MESMO gate `cqLiberado` (não duplica o predicado)", () => {
    const r = cad("m1", { status: "confirmado", status_pos: "pendente" }, [4], "ativo");
    expect(cqLiberado(r)).toBe(false);
    expect(pecasReaisLiberadas([r])).toEqual({});
    expect(ler("src/lib/cq-status.ts")).toMatch(/if \(!cqLiberado\(row\)\) continue;/);
  });
  it("fonte: Dashboard (Comercial) e lista do Planejamento usam o helper e não somam grade_total_real por conta própria", () => {
    const dash = ler("src/routes/_authenticated/dashboard.tsx");
    const plan = ler("src/routes/_authenticated/criacao.planejamento.tsx");
    for (const src of [dash, plan]) {
      expect(src).toMatch(/import \{[^}]*\bpecasReaisLiberadas\b[^}]*\} from "@\/lib\/cq-status"/);
      expect(src).toMatch(/return pecasReaisLiberadas\(/);
      expect(src).not.toMatch(/grade_total_real \?\? 0\)/); // nada de reduce próprio sobre a grade real
    }
    // a query do Comercial embeda o CQ + serviços (sem isso o helper veria "sem CQ" e zeraria tudo)
    expect(dash).toMatch(
      /controle_qualidade\(status, status_pos\), producao_terceirizados\(ativo, categorias_terceirizado\(etapa\)\), cad_grades\(grade_total_real\)/,
    );
  });
});

// ─────────────────────────────── item 8 ───────────────────────────────
const L = (o: Partial<MoLinha>): MoLinha => ({
  id: "l1",
  categoria_terceirizado_id: "c1",
  aprovado: true,
  valor: 50,
  ...o,
});

describe("item 8 — moLinhaVaiReabrir (P-163 A)", () => {
  it("aprovada no servidor + valor mudou no rascunho → reabre", () => {
    expect(moLinhaVaiReabrir(L({ valor: 60 }), L({}))).toBe(true);
  });
  it("REPROVADA no servidor + valor mudou → reabre", () => {
    expect(moLinhaVaiReabrir(L({ aprovado: false, valor: 40 }), L({ aprovado: false }))).toBe(true);
  });
  it("trocou o serviço → reabre", () => {
    expect(moLinhaVaiReabrir(L({ categoria_terceirizado_id: "c2" }), L({}))).toBe(true);
  });
  it("mesmo valor (50 × 50.0; 0 × vazio) → não reabre", () => {
    expect(moLinhaVaiReabrir(L({ valor: 50.0 }), L({}))).toBe(false);
    expect(moLinhaVaiReabrir(L({ valor: null }), L({ valor: 0 }))).toBe(false);
  });
  it("pendente no servidor, linha nova (sem id) ou sem base → nunca reabre", () => {
    expect(moLinhaVaiReabrir(L({ valor: 99 }), L({ aprovado: null }))).toBe(false);
    expect(moLinhaVaiReabrir(L({ id: null, valor: 99 }), L({ id: null }))).toBe(false);
    expect(moLinhaVaiReabrir(L({ valor: 99 }), undefined)).toBe(false);
    expect(moLinhaVaiReabrir(L({ id: "l2", valor: 99 }), L({ id: "l1" }))).toBe(false);
  });
  it("fonte: o MaoObraEditor mostra a dica SÓ quando a linha vai reabrir; o Planejamento passa o baseline", () => {
    const ed = ler("src/components/planejamento/MaoObraEditor.tsx");
    expect(ed).toMatch(
      /const vaiReabrir = moLinhaVaiReabrir\(l, linhaId != null \? linhasBase\?\.find\(\(b\) => b\.id === linhaId\) : undefined\);/,
    );
    expect(ed).toMatch(/\{vaiReabrir && \(/);
    expect(ed).toMatch(/\{TEXTO_MO_VAI_REABRIR\}/);
    // vale para aprovada E reprovada (a reprovada nunca foi aprovada: "nova aprovação")
    expect(TEXTO_MO_VAI_REABRIR).toBe(
      "Mudar o valor, o serviço ou o fornecedor volta este serviço para pendente — precisa de nova aprovação.",
    );
    expect(ler("src/components/planejamento/PlanejamentoDetail.tsx")).toMatch(
      /linhasBase=\{moLinhasBase\}/,
    );
    // ícone alinhado ao topo (texto quebra a 360 px) e Aprovar/Reprovar travados até salvar
    expect(ed).toMatch(
      /items-start gap-1 text-xs text-amber-700[^"]*">\s*<AlertTriangle className="mt-0\.5 h-3 w-3 shrink-0" \/>/,
    );
    expect(ed).toMatch(
      /disabled=\{rowPending \|\| !persistida \|\| vaiReabrir\} onClick=\{\(\) => linhaId && onAprovar\(linhaId\)\}/,
    );
    expect(ed).toMatch(
      /disabled=\{rowPending \|\| !persistida \|\| vaiReabrir\} onClick=\{\(\) => linhaId && setRepro\(\{ linhaId \}\)\}/,
    );
    expect(ed).toMatch(/vaiReabrir \? TEXTO_MO_SALVE_ANTES/);
    expect(TEXTO_MO_SALVE_ANTES).toBe("Salve o novo valor antes de aprovar ou reprovar");
  });

  it("I-1: o editor enxuto dos cards de Produto Acabado/Importado também avisa e trava", () => {
    const mini = ler("src/components/planejamento/MaoObraCardMini.tsx");
    expect(mini).toMatch(
      /const vaiReabrir = moLinhaVaiReabrir\(l, linhaId != null \? linhasBase\?\.find\(\(b\) => b\.id === linhaId\) : undefined\);/,
    );
    expect(mini).toMatch(/\{vaiReabrir && \(/);
    expect(mini).toMatch(/\{TEXTO_MO_VAI_REABRIR\}/);
    expect((mini.match(/!persistida \|\| vaiReabrir/g) ?? []).length).toBe(2);
    expect(ler("src/hooks/useMaoObraModelo.ts")).toMatch(
      /linhas, setLinhas, linhasBase, catsServico/,
    );
    for (const card of [
      "src/components/produto-acabado/ProdutoCard.tsx",
      "src/components/produto-importado/ProdutoImportadoCard.tsx",
    ]) {
      expect(ler(card)).toMatch(/linhasBase=\{mo\.linhasBase\}/);
    }
  });

  it("I-2: Lançar antes do Salvar — a linha que vai reabrir conta como pendente e bloqueia com 'salve antes'", () => {
    const det = ler("src/components/planejamento/PlanejamentoDetail.tsx");
    expect(det).toMatch(
      /const moReabreAoSalvar = moLinhas\.some\(\(l\) => l\.id != null && moLinhaVaiReabrir\(l, moLinhasBase\.find/,
    );
    expect(det).toMatch(
      /const maoObraPendente = !\(moEstadoLocal === "sem_servico" \|\| moEstadoLocal === "aprovada"\) \|\| moReabreAoSalvar;/,
    );
    // [modularidade F3] os bloqueios saíram para `bloqueiosLancar` (src/lib/lancar.ts), usado na mutation e no tooltip.
    expect(det).toMatch(/bloqueiosLancar\(\{[^}]*moReabreAoSalvar \}\)/);
    expect(ler("src/lib/lancar.ts")).toMatch(
      /if \(e\.moReabreAoSalvar\) b\.push\(TEXTO_LANCAR_MO_REABRE\)/,
    );
    expect(ler("src/lib/lancar.ts")).toMatch(/TEXTO_LANCAR_MO_REABRE = "Salve antes: a mão de obra alterada volta para pendente/);
  });
});

// ─────────────────────────────── item 9b ───────────────────────────────
describe("item 9b — prévia da REF usa o número do servidor", () => {
  it("numeroDaPrevia: RPC manda; sem resposta cai no 'Começar em' e, sem ele, em 10000000", () => {
    expect(numeroDaPrevia(100000000, 100000000)).toBe(100000000);
    expect(numeroDaPrevia(10000275, 5)).toBe(10000275); // contador já passou do "Começar em"
    expect(numeroDaPrevia(null, 20000000)).toBe(20000000);
    expect(numeroDaPrevia(undefined, undefined)).toBe(10000000);
  });
  it("fonte: Config da Loja (Formato da REF) e '+ Novo produto' chamam ref_proximo_numero e usam numeroDaPrevia", () => {
    const card = ler("src/components/configuracoes/FormatoRefCard.tsx");
    const novo = ler("src/components/produto-acabado/NovoProdutoDialog.tsx");
    expect(card).toMatch(
      /supabase\.rpc\("ref_proximo_numero" as any, \{ _num_inicio: numInicioDeb \}\)/,
    );
    // debounce ~300 ms e erro NÃO cai calado no número antigo
    expect(card).toMatch(/setTimeout\(\(\) => setNumInicioDeb\(numInicio\), 300\)/);
    expect(card).toMatch(/\{proximoErro && \(/);
    expect(novo).toMatch(/\{proximoErro && <span/);
    expect(card).toMatch(/const numeroExemplo = numeroDaPrevia\(numInicioValidoParaServidor\(numInicioDeb\) \? proximoServidor : null, numInicio\);/);
    expect(novo).toMatch(/supabase\.rpc\("ref_proximo_numero" as any, \{\}\)/);
    expect(novo).toMatch(
      /const numeroExemplo = numeroDaPrevia\(proximoServidor, refConfig\?\.num_inicio\);/,
    );
  });
});
