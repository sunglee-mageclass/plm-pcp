import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolverLock, estadoDoCampo, criarThrottle, lockVivo,
  EXPIRACAO_LOCK_MS, THROTTLE_MS, type LockInfo,
} from "@/lib/colab/coedicao";

const lk = (key: string, path: string, ts: number): LockInfo => ({ key, path, ts });

describe("resolverLock", () => {
  it("sem locks → null", () => {
    expect(resolverLock([], "lbl:nome", 1000)).toBeNull();
  });
  it("um lock vivo → ele é o dono", () => {
    expect(resolverLock([lk("a::1", "lbl:nome", 1000)], "lbl:nome", 1500)?.key).toBe("a::1");
  });
  it("empate no mesmo path → menor key vence (desempate determinístico)", () => {
    const dono = resolverLock(
      [lk("b::9", "lbl:nome", 1000), lk("a::2", "lbl:nome", 1000)], "lbl:nome", 1500,
    );
    expect(dono?.key).toBe("a::2");
  });
  it("lock expirado (ts > EXPIRACAO atrás) é ignorado", () => {
    const agora = 1000 + EXPIRACAO_LOCK_MS + 1;
    expect(resolverLock([lk("a::1", "lbl:nome", 1000)], "lbl:nome", agora)).toBeNull();
  });
  it("ignora locks de outros paths", () => {
    expect(resolverLock([lk("a::1", "lbl:cor", 1000)], "lbl:nome", 1500)).toBeNull();
  });
});

describe("limite exato de expiração (semântica <=: 10000 ms ainda é VIVO, 10001 ms morto)", () => {
  const ts = 1000;
  it("lockVivo: exatamente EXPIRACAO_LOCK_MS = vivo; +1 ms = morto", () => {
    expect(lockVivo(lk("a::1", "lbl:nome", ts), ts + EXPIRACAO_LOCK_MS)).toBe(true);
    expect(lockVivo(lk("a::1", "lbl:nome", ts), ts + EXPIRACAO_LOCK_MS + 1)).toBe(false);
  });
  it("resolverLock: no limite exato o lock ainda é o dono", () => {
    expect(resolverLock([lk("a::1", "lbl:nome", ts)], "lbl:nome", ts + EXPIRACAO_LOCK_MS)?.key).toBe("a::1");
  });
  it("estadoDoCampo: no limite exato é 'meu'/'outro' (nunca 'livre')", () => {
    const agora = ts + EXPIRACAO_LOCK_MS;
    expect(estadoDoCampo("lbl:nome", [lk("a::1", "lbl:nome", ts)], "a::1", agora).estado).toBe("meu");
    expect(estadoDoCampo("lbl:nome", [lk("z::9", "lbl:nome", ts)], "a::1", agora).estado).toBe("outro");
    expect(estadoDoCampo("lbl:nome", [lk("z::9", "lbl:nome", ts)], "a::1", agora + 1).estado).toBe("livre");
  });
});

describe("estadoDoCampo", () => {
  const meu = "a::1";
  it("sem lock → livre", () => {
    expect(estadoDoCampo("lbl:nome", [], meu, 1500).estado).toBe("livre");
  });
  it("meu lock → meu", () => {
    expect(estadoDoCampo("lbl:nome", [lk(meu, "lbl:nome", 1000)], meu, 1500).estado).toBe("meu");
  });
  it("lock de outro vivo → outro, com dono", () => {
    const r = estadoDoCampo("lbl:nome", [lk("z::9", "lbl:nome", 1000)], meu, 1500);
    expect(r.estado).toBe("outro");
    expect(r.dono?.key).toBe("z::9");
  });
  it("lock de outro expirado → livre (pode assumir)", () => {
    const agora = 1000 + EXPIRACAO_LOCK_MS + 1;
    expect(estadoDoCampo("lbl:nome", [lk("z::9", "lbl:nome", 1000)], meu, agora).estado).toBe("livre");
  });
  it("meu lock vence sobre o de outro no mesmo path se minha key é menor", () => {
    const r = estadoDoCampo("lbl:nome", [lk("a::1", "lbl:nome", 1000), lk("z::9", "lbl:nome", 1000)], "a::1", 1500);
    expect(r.estado).toBe("meu");
  });
});

describe("criarThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("emite na borda de ataque imediatamente", () => {
    const spy = vi.fn();
    const t = criarThrottle<string>(spy, THROTTLE_MS);
    t.enviar("a");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith("a");
  });
  it("rajada de 7 em <100ms → 1 na borda + o último no soltar (não 7)", () => {
    const spy = vi.fn();
    const t = criarThrottle<string>(spy, THROTTLE_MS);
    for (const c of ["a","ab","abc","abcd","abcde","abcdef","abcdefg"]) t.enviar(c);
    t.soltar();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(spy).toHaveBeenLastCalledWith("abcdefg"); // o último valor SEMPRE entregue
  });
  it("após a janela, o próximo enviar emite de novo", () => {
    const spy = vi.fn();
    const t = criarThrottle<string>(spy, THROTTLE_MS);
    t.enviar("a");
    vi.advanceTimersByTime(THROTTLE_MS + 1);
    t.enviar("b");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith("b");
  });
});
