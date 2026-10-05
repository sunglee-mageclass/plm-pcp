// Camada intermediária C4 / R-02 — peças PURAS do merge da Explosão (o comportamento da TELA está em
// tests/unit/_fix_hidratacao/camada-c4-explosao-eco.test.ts). Aqui: escala do banco, comparação só por chaves do servidor (M1)
// e a decisão do aviso ("outra pessoa" / conflito) — mudança de outra pessoa continua avisando.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  avaliarMergeExplosao,
  blobDaTelaExplosao,
  blobDoServidorExplosao,
  escala2,
  metragemBlobDeTecidos,
  type ExplosaoColabBlob,
} from "@/components/producao/explosao/explosao-colab";

const tec = (m: number, f = 2): any[] => [{ variantes: [{ id: "v1", metragem_enviada: m, quantidade_folhas: f }] }];
const SEM = new Set<string>();
const blob = (m: number, avi: Record<string, number> = { a: 1 }, eti: Record<string, number> = { e: 2 }): ExplosaoColabBlob =>
  blobDaTelaExplosao({ tecidos: tec(m), aviSeparar: avi, etiEnviar: eti });

describe("escala do banco (numeric(10,2) / integer)", () => {
  it("arredonda meio para cima como o numeric do Postgres, sem o erro de ponto flutuante", () => {
    expect(escala2(12.345)).toBe(12.35);
    expect(escala2(1.005)).toBe(1.01);
    expect(escala2(0.1 + 0.2)).toBe(0.3);
    expect(escala2(10)).toBe(10);
    expect(escala2("3,5")).toBe(0); // texto não numérico vira 0 (a tela só manda number)
    expect(escala2(NaN)).toBe(0);
  });

  it("o que a tela tem (12,345) e o que o servidor devolve (12,35) são o MESMO blob", () => {
    const tela = blobDaTelaExplosao({ tecidos: tec(12.345), aviSeparar: { a: 2.675 }, etiEnviar: { e: 4.004 } });
    const srv = blobDoServidorExplosao({
      tecidos: tec(12.35),
      cadAviamentos: [{ aviamento_id: "x", variante_aviamento_id: null, quantidade_separar: 0 }],
      cadEtiquetas: [{ id: "e", quantidade_enviar: 4 }],
    });
    expect(tela.metragemBlob).toEqual({ v1: { metragem_enviada: 12.35, quantidade_folhas: 2 } });
    expect(tela.etiBlob).toEqual(srv.etiBlob);
    expect(metragemBlobDeTecidos(tec(1, 2.4))["v1"].quantidade_folhas).toBe(2);
  });
});

describe("aviso do merge (R-02: só 'outra pessoa' de verdade)", () => {
  const base = blob(0);

  it("servidor igual ao base (o que o onSuccess relê): sem aviso, mesmo com rev novo", () => {
    const r = avaliarMergeExplosao({ base: blob(10), draft: blob(10), fresh: blob(10), touched: SEM, revMudou: true });
    expect(r.aviso).toBeNull();
    expect(r.m.atualizados).toEqual([]);
  });

  it("outra pessoa mexeu numa seção que eu não toquei: 'outra-pessoa'", () => {
    const fresh = { ...blob(10), aviBlob: { a: 9 } };
    const r = avaliarMergeExplosao({ base: blob(10), draft: blob(10), fresh, touched: SEM, revMudou: true });
    expect(r.aviso).toBe("outra-pessoa");
    expect(r.m.atualizados).toEqual(["aviBlob"]);
  });

  it("outra pessoa mexeu na seção que eu estou editando: conflito", () => {
    const draft = { ...blob(10), etiBlob: { e: 7 } };
    const fresh = { ...blob(10), etiBlob: { e: 3 } };
    const r = avaliarMergeExplosao({ base: blob(10), draft, fresh, touched: new Set(["etiBlob"]), revMudou: true });
    expect(r.aviso).toBe("conflito");
    expect(r.m.conflitos.map((c) => c.path)).toEqual(["etiBlob"]);
  });

  it("sem rev novo não há aviso, mesmo com seção atualizada", () => {
    const fresh = { ...base, aviBlob: { a: 9 } };
    expect(avaliarMergeExplosao({ base, draft: base, fresh, touched: SEM, revMudou: false }).aviso).toBeNull();
  });

  it("M1 — chave do BOM sem linha no servidor (a RPC pula) não gera conflito falso numa seção que eu editei", () => {
    // outra pessoa gravou a=7; eu também digitei a=7 e tenho uma linha 'b' do BOM que o CAD não tem
    const b = blob(10, { a: 1 });
    const draft = blob(10, { a: 7, b: 2 });
    const fresh = blob(10, { a: 7 });
    const r = avaliarMergeExplosao({ base: b, draft, fresh, touched: new Set(["aviBlob"]), revMudou: true });
    expect(r.m.conflitos).toEqual([]);
    expect(r.aviso).toBeNull();
  });
});

describe("fiação (fonte)", () => {
  const src = readFileSync("src/components/producao/explosao/ExplosaoDetail.tsx", "utf8");

  it("P0409 segue igual: o onError reconcilia (e só devolve as marcas de tocado, sem re-basar o base)", () => {
    const salvar = src.slice(src.indexOf("const salvarMut = useMutation"), src.indexOf("// --- enviar para PCP"));
    const onError = salvar.slice(salvar.indexOf("onError:"));
    expect(onError).toContain('e?.code === "P0409"');
    expect(onError).toContain("reconciliarP0409()");
    expect(onError).not.toContain("baseServidorRef");
  });

  it("M3 — enviarCorte não re-basa e diz por quê", () => {
    const env = src.slice(src.indexOf("const enviarCorte = useMutation"), src.indexOf("// --- voltar ao desenvolvimento"));
    expect(env).toContain("M3");
    expect(env).not.toContain("assentandoRef");
    expect(env).toContain("podeGravarRef.current"); // F6a também vale para o Enviar
  });
});
