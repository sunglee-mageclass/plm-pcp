// Realtime Onda 2 / Task 4 — telas de Admin editáveis ganham o anel de presença de campo. Teste de FONTE.
// Escolha de canal por tela (super admin NÃO tem tenant único; presença = só {nome, campoFocado}):
//  - identidade: GLOBAL (system_settings singleton) → canal sem tenant;
//  - lojas / usuarios: por REGISTRO editado (tenant.id / user.id) no Sheet de edição, cross-tenant;
// FICAM FORA: dashboard.tsx (só-leitura, ruling) e usuarios-loja.tsx (sem campo de texto editável
// existente: só "Novo" Dialog + PapelSelect/Switch, que são botões Radix e commitam na hora).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const telas: Array<{ arq: string; canal: RegExp }> = [
  { arq: "src/routes/_authenticated/admin/identidade.tsx", canal: /colab-canvas:admin-identidade:global/ },
  { arq: "src/routes/_authenticated/admin/lojas.tsx", canal: /colab-canvas:admin-lojas:\$\{tenant\.id\}/ },
  { arq: "src/routes/_authenticated/admin/usuarios.tsx", canal: /colab-canvas:admin-usuarios:\$\{user\.id\}/ },
];

for (const { arq, canal } of telas) {
  describe(arq, () => {
    const src = readFileSync(arq, "utf8");
    it("usa presença de página + overlay com canal nomeado", () => {
      expect(src).toMatch(/useColabPresencaPagina/);
      expect(src).toMatch(/<ColabPresenceOverlay /);
      expect(src).toMatch(canal);
    });
    it("tem o PAR onFocusCapture + onBlurCapture (blur limpa o foco) com guarda contains", () => {
      expect(src).toMatch(/onFocusCapture/);
      expect(src).toMatch(/onBlurCapture=\{\(\) => setCampoFocado\(null\)\}/);
      expect(src).toMatch(/scope\.contains\(alvo\)/);
      expect((src.match(/onBlurCapture/g) ?? []).length).toBe((src.match(/onFocusCapture/g) ?? []).length);
    });
  });
}

describe("identidade: overlay da página fica abaixo do AlertDialog de confirmar", () => {
  it("passa abaixoDeModal", () => {
    expect(readFileSync("src/routes/_authenticated/admin/identidade.tsx", "utf8")).toMatch(/ColabPresenceOverlay [^>]*abaixoDeModal/);
  });
  it("liga o canal só para super admin", () => {
    expect(readFileSync("src/routes/_authenticated/admin/identidade.tsx", "utf8")).toMatch(/isSuperAdmin \? "colab-canvas:admin-identidade:global" : null/);
  });
});

describe("Dashboard continua intocado (só-leitura)", () => {
  it("sem presença de campo", () => {
    const src = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
    expect(src).not.toMatch(/ColabPresenceOverlay|useColabPresencaPagina/);
  });
});
