// Integração — R4/D38: CPU do código da rota (sem I/O de verdade) por tamanho de página. Sintético: a loja real não tem 500
// integráveis. Mede, por requisição: JSON.parse do retorno do banco (o que o supabase-js faz no Worker) + JSON.parse dos links
// assinados + tratarRequisicao (fotos, confirmar, montarResposta, JSON.stringify) + leitura do corpo. SÓ IMPRIME p50/p95 —
// nenhum limiar de tempo aqui (R10 do r2: tempo varia com a máquina). A régua é a da D38, lida pelo controlador. Fora de
// tests/unit de propósito: não roda no gate de todo commit.
import { describe, it, expect } from "vitest";
import { tratarRequisicao, type DepsRota } from "@/lib/integracao/api/rota";
import type { RespostaLer } from "@/lib/integracao/api/resposta";

const T = "11111111-1111-4111-8111-111111111111";
const COLS = 18; // todas as colunas do catálogo marcadas; a última é a Foto
const VARIANTES = 6; // + 1 linha de produto = 7 linhas por produto

function pagina(n: number): { banco: string; assinadas: string } {
  const chaves = Array.from({ length: COLS }, (_, i) => (i === COLS - 1 ? "foto" : `c${i}`));
  const fotos: string[] = [];
  const produtos = Array.from({ length: n }, (_, p) => {
    const f = [0, 1, 2].map((k) => `${T}/fotos_modelo/${p}-${k}.jpg`);
    fotos.push(...f);
    return {
      modelo_id: `m${p}`, estado: "integravel", assinatura: `s${p}`.padEnd(64, "0"), integrado_em: null,
      linhas: [
        { tipo: "produto", loja_nome: "Loja X",
          valores: [...Array.from({ length: COLS - 1 }, (_, i) => `Produto ${p} — campo ${i} com um texto de tamanho médio`), f] },
        ...Array.from({ length: VARIANTES }, (_, v) => ({ tipo: "variante", loja_nome: "Loja X",
          valores: [...Array.from({ length: COLS - 1 }, (_, i) => `Variante ${p}.${v} — campo ${i}`), []] })),
      ],
    };
  });
  const banco = JSON.stringify({
    status: "ok", modo: "normal", acesso_id: "ac", chave_id: "k", tenant_id: T, loja: { id: T, nome: "Loja X" },
    colunas: chaves.map((c) => c.toUpperCase()), chaves_colunas: chaves, proximo_cursor: null, validade_foto_dias: 7, produtos,
  });
  const assinadas = JSON.stringify(fotos.map((c) => ({
    path: c, error: null, signedUrl: `https://x.supabase.co/storage/v1/object/sign/modelos/${c}?token=${"t".repeat(180)}`,
  })));
  return { banco, assinadas };
}

function deps({ banco, assinadas }: { banco: string; assinadas: string }): DepsRota {
  return {
    hashChave: async () => "h",
    ler: async () => JSON.parse(banco) as RespostaLer,
    assinarFotos: async () => {
      const a = JSON.parse(assinadas) as { path: string; signedUrl: string | null; error: string | null }[];
      return new Map(a.map((d) => [d.path, d.error ? null : d.signedUrl]));
    },
    confirmar: async (_k, _a, e) => ({
      status: "ok", confirmados: e.produtos.map((p) => ({ modelo_id: p.modelo_id, integrado_em: "2026-09-27T12:00:00.000Z" })),
    }),
    limpar: async () => undefined,
    depois: () => undefined,
    tetoIp: async () => true,
    agora: () => new Date("2026-09-27T12:00:00.000Z"),
    origem: "https://site",
  };
}

async function medir(n: number) {
  const d = deps(pagina(n));
  const req = () => new Request("https://site/api/integracao/v1/produtos?limite=500", {
    headers: { authorization: "Bearer wish_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "cf-connecting-ip": "203.0.113.5" },
  });
  for (let i = 0; i < 3; i++) await (await tratarRequisicao(req(), d)).text(); // aquecimento (JIT)
  const ms: number[] = [];
  let bytes = 0;
  let linhas = 0;
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    const r = await tratarRequisicao(req(), d);
    const corpo = await r.text();
    ms.push(performance.now() - t0);
    expect(r.status).toBe(200);
    bytes = corpo.length;
    linhas = (JSON.parse(corpo) as { linhas: unknown[] }).linhas.length;
  }
  ms.sort((a, b) => a - b);
  const p50 = ms[9];
  const p95 = ms[18];
  console.log(`[carga-api] ${n} produtos (${linhas} linhas, ${Math.round(bytes / 1024)} KB): p50 ${p50.toFixed(2)} ms · p95 ${p95.toFixed(2)} ms`);
  return { p50, p95, linhas };
}

describe("Integração — CPU da rota por tamanho de página (R4/D38; só imprime)", () => {
  // 50 = PADRÃO (P-89 A); 100 = acima disso a tela avisa do plano gratuito; 200/500 = só com Workers Paid (registro).
  for (const n of [50, 100, 200, 500]) {
    it(`${n} produtos`, async () => {
      const r = await medir(n);
      expect(r.linhas).toBe(n * (VARIANTES + 1)); // correção da montagem — tempo NÃO é conferido aqui (R10)
    });
  }
});
