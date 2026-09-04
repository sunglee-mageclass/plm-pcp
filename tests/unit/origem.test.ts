import { describe, it, expect } from "vitest";
import { ehOrigemComprada, normalizarOrigem, rotuloOrigem } from "@/lib/origem";

describe("origem — SSOT da família de aquisição", () => {
  describe("ehOrigemComprada", () => {
    it("revenda e importado são compradas", () => {
      expect(ehOrigemComprada("revenda")).toBe(true);
      expect(ehOrigemComprada("importado")).toBe(true);
    });
    it("interno / ausente / desconhecido NÃO são compradas (fabricadas)", () => {
      expect(ehOrigemComprada("interno")).toBe(false);
      expect(ehOrigemComprada(null)).toBe(false);
      expect(ehOrigemComprada(undefined)).toBe(false);
      expect(ehOrigemComprada("")).toBe(false);
      expect(ehOrigemComprada("qualquer")).toBe(false);
    });
  });

  describe("normalizarOrigem", () => {
    it("mantém as origens conhecidas", () => {
      expect(normalizarOrigem("revenda")).toBe("revenda");
      expect(normalizarOrigem("importado")).toBe("importado");
      expect(normalizarOrigem("interno")).toBe("interno");
    });
    it("ausente/desconhecido cai em interno", () => {
      expect(normalizarOrigem(null)).toBe("interno");
      expect(normalizarOrigem(undefined)).toBe("interno");
      expect(normalizarOrigem("outro")).toBe("interno");
    });
  });

  describe("rotuloOrigem", () => {
    it("cada origem tem seu rótulo humano", () => {
      expect(rotuloOrigem("revenda")).toBe("Revenda");
      expect(rotuloOrigem("importado")).toBe("Importado");
      expect(rotuloOrigem("interno")).toBe("Produção própria");
      expect(rotuloOrigem(null)).toBe("Produção própria");
    });
  });
});
