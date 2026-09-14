import { describe, it, expect } from "vitest";
import { corDoUsuario, presencaDoCampo } from "@/lib/colab/presenca-cor";
import type { PresencaColab } from "@/hooks/useColabRegistro";

describe("presenca-cor — corDoUsuario (estável por usuário)", () => {
  it("é determinística: mesma pessoa → sempre a mesma cor", () => {
    const a = corDoUsuario("user-abc-123");
    const b = corDoUsuario("user-abc-123");
    expect(a).toEqual(b);
    expect(a.solid).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.text).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("pessoas diferentes tendem a cores diferentes (boa distribuição em UUIDs reais)", () => {
    // UUIDs realistas (bem distintos entre si, como os de auth.users) — não ids artificiais
    // quase-iguais que colidiriam no hash. Com 12 UUIDs distintos e 10 cores, esperamos boa
    // dispersão (≥7 cores distintas — tolera algumas colisões esperadas do módulo).
    const ids = [
      "3f17e45b-aeec-47f0-8917-f3f29955e2a5", "5df64566-2ed0-4a5f-b13a-d126bd5c10bf",
      "9b4e079e-e204-47ff-9d62-73665da9c5ee", "f88c3fa7-1d4c-4aa6-b454-b12fde19fc8b",
      "20c84a36-b7a0-4c26-ac59-52cb11e9d979", "37889b78-fffb-404b-8c75-18b7e50a1d9b",
      "174518a5-569f-4954-9010-24204b345508", "a1b2c3d4-e5f6-7890-abcd-ef0123456789",
      "deadbeef-cafe-babe-f00d-0123456789ab", "01234567-89ab-cdef-0123-456789abcdef",
      "fedcba98-7654-3210-fedc-ba9876543210", "11111111-2222-3333-4444-555555555555",
    ];
    const cores = new Set(ids.map((id) => corDoUsuario(id).solid));
    expect(cores.size).toBeGreaterThanOrEqual(7);
  });

  it("id vazio não quebra (retorna uma cor válida da paleta)", () => {
    const c = corDoUsuario("");
    expect(c.solid).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("presenca-cor — presencaDoCampo", () => {
  const P = (userId: string, nome: string, campoFocado: string | null): PresencaColab => ({ userId, nome, campoFocado });

  it("acha quem está no campo e devolve nome + cor da pessoa", () => {
    const presentes = [P("u1", "Maria", "preco_venda"), P("u2", "João", "nome")];
    const r = presencaDoCampo(presentes, "nome");
    expect(r?.nome).toBe("João");
    expect(r?.solid).toBe(corDoUsuario("u2").solid);
  });

  it("ninguém no campo → null", () => {
    expect(presencaDoCampo([P("u1", "Maria", "outro")], "nome")).toBeNull();
    expect(presencaDoCampo([], "nome")).toBeNull();
  });

  it("presença sem campo focado (só na tela) não casa nenhum campo", () => {
    expect(presencaDoCampo([P("u1", "Maria", null)], "nome")).toBeNull();
  });
});
