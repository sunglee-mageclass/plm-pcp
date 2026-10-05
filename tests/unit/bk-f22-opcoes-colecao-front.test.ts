// [backend F2.2] Front das listas sem teto de 1.000: as OPÇÕES de Coleção/Subcoleção vêm da RPC `opcoes_colecao_modelos()` (sem baixar
// cards); a lista de cards das Etapas PL pagina com `buscarTodas` (sem teto no cliente); OC Tecido não decide Salvar sem saber o modo (R7).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  paginas: [] as { de: number; ate: number }[],
  total: 0,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => h.rpc(...a),
    from: (t: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        range: (de: number, ate: number) => {
          h.paginas.push({ de, ate });
          const n = Math.max(0, Math.min(h.total, ate + 1) - de);
          return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: `${t}-${de + i}` })), error: null });
        },
      };
      return q;
    },
  },
}));

import { buscarOpcoesColecao, normalizarOpcoesColecao } from "@/lib/opcoes-colecao";

const ler = (p: string) => readFileSync(p, "utf8");

beforeEach(() => {
  h.rpc.mockReset();
  h.paginas.length = 0;
  h.total = 0;
});

describe("opções de Coleção/Subcoleção vêm da RPC", () => {
  it("chama opcoes_colecao_modelos() uma vez, sem tocar em `modelos`, e ordena/limpa o retorno", async () => {
    h.rpc.mockResolvedValue({
      data: { colecoes: ["Verão", "Alta", "Verão", ""], subcolecoes: ["B", "A"] },
      error: null,
    });
    const r = await buscarOpcoesColecao();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls[0][0]).toBe("opcoes_colecao_modelos");
    expect(h.paginas).toEqual([]); // nenhum select de cards
    expect(r).toEqual({ colecoes: ["Alta", "Verão"], subcolecoes: ["A", "B"] });
  });

  it("erro da RPC sobe (não esvazia o filtro em silêncio)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(buscarOpcoesColecao()).rejects.toMatchObject({ message: "boom" });
  });

  it("sem teto no cliente: mais de 1.000 opções passam inteiras", () => {
    const muitas = Array.from({ length: 2500 }, (_, i) => `Col ${String(i).padStart(4, "0")}`);
    const r = normalizarOpcoesColecao({ colecoes: muitas, subcolecoes: [] });
    expect(r.colecoes).toHaveLength(2500);
    expect(r.colecoes[0]).toBe("Col 0000");
  });

  it("resposta nula/estranha = listas vazias", () => {
    expect(normalizarOpcoesColecao(null)).toEqual({ colecoes: [], subcolecoes: [] });
    expect(normalizarOpcoesColecao({ colecoes: "x", subcolecoes: 3 })).toEqual({ colecoes: [], subcolecoes: [] });
  });

  it("PCP › Etapas e Dashboard › Comercial usam a RPC (com a loja na key) e não baixam cards para montar opções", () => {
    const etapas = ler("src/routes/_authenticated/pcp.etapas.tsx");
    expect(etapas).toContain("(await buscarOpcoesColecao()).colecoes");
    expect(etapas).toContain('queryKey: ["opt", "colecoes-modelos", tenantId]');
    expect(etapas).not.toMatch(/from\("modelos"\)/);

    const dash = ler("src/routes/_authenticated/dashboard.tsx");
    const i = dash.indexOf("function ComercialColecaoTab()");
    const corpo = dash.slice(i, i + 5000);
    expect(corpo).toContain('queryKey: ["comercial-opts", tenantId]');
    expect(corpo).toContain("queryFn: buscarOpcoesColecao");
  });
});

describe("lista de cards das Etapas PL sem teto de 1.000", () => {
  it("useEtapasCards pagina com buscarTodas (order created_at desc + id, .range) — nenhum .from(\"modelos\") sem .range nos 3 pontos", () => {
    const hook = ler("src/components/producao/etapas/useEtapasCards.ts");
    expect(hook).toContain("buscarTodas<");
    expect(hook).toContain('.order("created_at", { ascending: false })');
    expect(hook).toContain('.order("id", { ascending: true })');
    expect(hook).toContain(".range(de, ate)");
    const dash = ler("src/routes/_authenticated/dashboard.tsx");
    const ini = dash.indexOf("function ComercialColecaoTab()");
    // dashboard.tsx: só o corpo de ComercialColecaoTab é do escopo da F2.2 (as outras abas têm leituras próprias)
    const fontes: [string, string][] = [
      ["useEtapasCards.ts", ler("src/components/producao/etapas/useEtapasCards.ts")],
      ["pcp.etapas.tsx", ler("src/routes/_authenticated/pcp.etapas.tsx")],
      ["dashboard.tsx > ComercialColecaoTab", dash.slice(ini, ini + 5000)],
    ];
    for (const [f, t] of fontes) {
      // cada `.from("modelos")` das 3 telas é seguido de `.range(` antes do próximo `.from(` (ou não existe)
      const partes = t.split(/from\("modelos"\)/).slice(1);
      for (const p of partes) {
        const ate = p.indexOf(".from(");
        expect(p.slice(0, ate === -1 ? undefined : ate), f).toContain(".range(");
      }
    }
  });

  it("buscarTodas sobre 2.500 cards devolve os 2.500 (3 páginas de 1.000; nada de teto no cliente)", async () => {
    const { buscarTodas } = await import("@/lib/buscar-todas");
    const { supabase } = await import("@/integrations/supabase/client");
    h.total = 2500;
    const rows = await buscarTodas<{ id: string }>((de, ate) => (supabase.from("modelos") as any).select("*").range(de, ate));
    expect(rows).toHaveLength(2500);
    expect(h.paginas).toEqual([
      { de: 0, ate: 999 },
      { de: 1000, ate: 1999 },
      { de: 2000, ate: 2999 },
    ]);
  });
});

describe("R7 — OC Tecido: Salvar espera o modo OC/Rolo ser conhecido", () => {
  const oc = ler("src/routes/_authenticated/entrada-saida.oc-tecido.tsx");

  it("usa o estado do hook (pronto) e não o modo cru", () => {
    expect(oc).toContain("useModoOcRoloEstado");
    expect(oc).not.toMatch(/=\s*useModoOcRolo\(\)/);
    expect(oc).toContain("pronto: modoPronto");
  });

  it("Salvar e Marcar Recebido ficam desabilitados com motivo em PT-BR até saber o modo; handlers e mutationFn também recusam", () => {
    expect(oc).toContain("disabled={saveMutation.isPending || !modoPronto} title={motivoModo ?? undefined}");
    expect(oc).toContain("onClick={handleMarkReceived} disabled={saveMutation.isPending || !modoPronto}");
    expect(oc).toContain("o modo de trabalho da loja (OC/Rolo) ainda não foi carregado");
    expect(oc).toMatch(/const handleSave = \(\) => \{\s*\n\s*if \(!modoPronto \|\|/);
    expect(oc).toMatch(/const handleMarkReceived = \(\) => \{\s*\n\s*if \(!modoPronto \|\|/);
    expect(oc).toMatch(/const confirmarRecebimento = \(\) => \{\s*\n\s*if \(!modoPronto \|\|/);
    expect(oc).toContain("if (!modoPronto) throw new Error(MOTIVO_MODO_DESCONHECIDO);");
  });
});
