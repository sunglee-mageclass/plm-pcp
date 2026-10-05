// Camada intermediária C4 / R-02 — o eco do PRÓPRIO Salvar da Explosão não pode avisar "atualizada por outra pessoa".
// Causa: o onSuccess zerava os "tocados" mas não re-basava o base 3-vias; o refetch do próprio save virava "seção não-tocada
// + servidor mudou" (atualizados>0 e rev novo). Fix: o base passa a ser o blob ENVIADO. Mudança de OUTRA pessoa continua avisando.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  avaliarMergeExplosao,
  blobEnviadoExplosao,
  metragemBlobDeTecidos,
  type ExplosaoColabBlob,
} from "@/components/producao/explosao/explosao-colab";

const tec = (m: number, f: number): any[] => [{ variantes: [{ id: "v1", metragem_enviada: m, quantidade_folhas: f }] }];
const SEM = new Set<string>();

describe("R-02 — eco do próprio save", () => {
  const baseAntigo: ExplosaoColabBlob = { metragemBlob: metragemBlobDeTecidos(tec(0, 0)), aviBlob: { a: 1 }, etiBlob: { e: 2 } };

  it("sem re-base (o bug): o refetch do próprio save acusa 'outra pessoa'", () => {
    const fresh = blobEnviadoExplosao({ tecidos: tec(10, 2), aviSeparar: { a: 1 }, etiEnviar: { e: 2 } });
    const r = avaliarMergeExplosao({ base: baseAntigo, draft: fresh, fresh, touched: SEM, revMudou: true });
    expect(r.aviso).toBe("outra-pessoa");
  });

  it("com o base = blob enviado: o eco do próprio save não avisa nada (no-op)", () => {
    const enviado = blobEnviadoExplosao({ tecidos: tec(10, 2), aviSeparar: { a: 5 }, etiEnviar: { e: 2 } });
    const fresh: ExplosaoColabBlob = JSON.parse(JSON.stringify(enviado)); // o que o servidor devolve = o que mandei
    const r = avaliarMergeExplosao({ base: enviado, draft: enviado, fresh, touched: SEM, revMudou: true });
    expect(r.aviso).toBeNull();
    expect(r.m.atualizados).toEqual([]);
    expect(r.m.conflitos).toEqual([]);
  });

  it("mudança de OUTRA pessoa depois do meu save continua avisando", () => {
    const enviado = blobEnviadoExplosao({ tecidos: tec(10, 2), aviSeparar: { a: 5 }, etiEnviar: { e: 2 } });
    const fresh: ExplosaoColabBlob = { ...enviado, aviBlob: { a: 9 } };
    const r = avaliarMergeExplosao({ base: enviado, draft: enviado, fresh, touched: SEM, revMudou: true });
    expect(r.aviso).toBe("outra-pessoa");
    expect(r.m.atualizados).toEqual(["aviBlob"]);
  });

  it("outra pessoa mexe na seção que eu voltei a editar: conflito (aviso de conflito)", () => {
    const enviado = blobEnviadoExplosao({ tecidos: tec(10, 2), aviSeparar: { a: 5 }, etiEnviar: { e: 2 } });
    const draft: ExplosaoColabBlob = { ...enviado, etiBlob: { e: 7 } };
    const fresh: ExplosaoColabBlob = { ...enviado, etiBlob: { e: 3 } };
    const r = avaliarMergeExplosao({ base: enviado, draft, fresh, touched: new Set(["etiBlob"]), revMudou: true });
    expect(r.aviso).toBe("conflito");
    expect(r.m.conflitos.map((c) => c.path)).toEqual(["etiBlob"]);
  });

  it("sem rev novo não há aviso, mesmo com seção atualizada (comportamento anterior preservado)", () => {
    const fresh: ExplosaoColabBlob = { ...baseAntigo, aviBlob: { a: 9 } };
    expect(avaliarMergeExplosao({ base: baseAntigo, draft: baseAntigo, fresh, touched: SEM, revMudou: false }).aviso).toBeNull();
  });

  it("blobEnviadoExplosao é uma cópia: editar o estado depois do envio não muda o base", () => {
    const avi = { a: 1 }, eti = { e: 2 };
    const enviado = blobEnviadoExplosao({ tecidos: tec(1, 1), aviSeparar: avi, etiEnviar: eti });
    avi.a = 99; eti.e = 99;
    expect(enviado.aviBlob).toEqual({ a: 1 });
    expect(enviado.etiBlob).toEqual({ e: 2 });
  });
});

describe("R-02 — fiação no ExplosaoDetail (fonte)", () => {
  const src = readFileSync("src/components/producao/explosao/ExplosaoDetail.tsx", "utf8");
  const salvar = src.slice(src.indexOf("const salvarMut = useMutation"), src.indexOf("// --- enviar para PCP"));

  it("o mutationFn captura o blob ANTES das RPCs e o onSuccess o adota como base", () => {
    expect(salvar.indexOf("blobEnviadoRef.current = blobEnviadoExplosao(")).toBeGreaterThan(-1);
    expect(salvar.indexOf("blobEnviadoRef.current = blobEnviadoExplosao(")).toBeLessThan(salvar.indexOf('supabase.rpc("salvar_explosao_metragem"'));
    const onSuccess = salvar.slice(salvar.indexOf("onSuccess:"), salvar.indexOf("onError:"));
    expect(onSuccess).toContain("baseServidorRef.current = blobEnviadoRef.current");
    expect(onSuccess.indexOf("baseServidorRef.current")).toBeLessThan(onSuccess.indexOf("invalidateQueries"));
  });

  it("P0409 segue igual: o onError reconcilia e NÃO re-basa", () => {
    const onError = salvar.slice(salvar.indexOf("onError:"));
    expect(onError).toContain('e?.code === "P0409"');
    expect(onError).toContain("reconciliarP0409()");
    expect(onError).not.toContain("baseServidorRef");
  });

  it("os toasts do merge vêm do aviso decidido pela função pura", () => {
    expect(src).toContain('aviso === "outra-pessoa"');
    expect(src).toContain('aviso === "conflito"');
  });
});
