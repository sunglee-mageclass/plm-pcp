import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  tamanhoVinculadoParaSalvar,
  vinculoLigadoSemTamanho,
  vinculoAtivoDoRegistro,
  vinculoDisponivel,
} from "../../src/lib/insumo-tamanho";

const SEM_TAM = [{ tamanhos: [] as string[] }];
const COM_TAM = [{ tamanhos: ["40|M"] }];

describe("tamanhoVinculadoParaSalvar (Ruling A2: o Salvar limpa o vinculo que nao vale)", () => {
  it("ativo + sem tamanho nos blocos + formato qualquer => o tamanho", () => {
    for (const formato of ["nenhum", "ambos", "numero", "letra"]) {
      expect(tamanhoVinculadoParaSalvar({ ativo: true, tamanho: "40|M", formato, blocos: SEM_TAM })).toBe("40|M");
    }
  });

  it("ativo sem nenhum bloco => o tamanho", () => {
    expect(tamanhoVinculadoParaSalvar({ ativo: true, tamanho: "34|PPP", formato: "ambos", blocos: [] })).toBe("34|PPP");
  });

  it("bloco com tamanho marcado e formato diferente de 'nenhum' => null", () => {
    expect(tamanhoVinculadoParaSalvar({ ativo: true, tamanho: "40|M", formato: "ambos", blocos: COM_TAM })).toBeNull();
    expect(tamanhoVinculadoParaSalvar({ ativo: true, tamanho: "40|M", formato: "letra", blocos: [...SEM_TAM, ...COM_TAM] })).toBeNull();
  });

  it("formato 'nenhum' ignora tamanhos remanescentes nos blocos", () => {
    expect(tamanhoVinculadoParaSalvar({ ativo: true, tamanho: "40|M", formato: "nenhum", blocos: COM_TAM })).toBe("40|M");
  });

  it("toggle desligado => null", () => {
    expect(tamanhoVinculadoParaSalvar({ ativo: false, tamanho: "40|M", formato: "nenhum", blocos: [] })).toBeNull();
  });

  it("tamanho vazio, so espacos ou nulo => null", () => {
    for (const tamanho of ["", "   ", null, undefined]) {
      expect(tamanhoVinculadoParaSalvar({ ativo: true, tamanho, formato: "nenhum", blocos: [] })).toBeNull();
    }
  });

  it("tira so os espacos das pontas (como btrim do Postgres)", () => {
    expect(tamanhoVinculadoParaSalvar({ ativo: true, tamanho: "  M ", formato: "nenhum", blocos: [] })).toBe("M");
  });

  it("valor no formato da grade da loja ('34|PPP') segue intacto", () => {
    expect(tamanhoVinculadoParaSalvar({ ativo: true, tamanho: "34|PPP", formato: "nenhum", blocos: [] })).toBe("34|PPP");
  });
});

describe("vinculoAtivoDoRegistro (o toggle 'ligado' ao editar)", () => {
  it("ligado quando tamanho_vinculado e nao vazio apos o trim de espacos", () => {
    expect(vinculoAtivoDoRegistro("40|M")).toBe(true);
    expect(vinculoAtivoDoRegistro("34|PPP")).toBe(true);
  });
  it("desligado para null, vazio e so espacos", () => {
    expect(vinculoAtivoDoRegistro(null)).toBe(false);
    expect(vinculoAtivoDoRegistro(undefined)).toBe(false);
    expect(vinculoAtivoDoRegistro("")).toBe(false);
    expect(vinculoAtivoDoRegistro("   ")).toBe(false);
  });
  it("tab/NBSP nao contam como espaco (igual ao Postgres)", () => {
    expect(vinculoAtivoDoRegistro("\t")).toBe(true);
  });
});

describe("vinculoDisponivel (switch habilitado so p/ insumo sem tamanho nas variantes)", () => {
  it("disponivel com formato 'nenhum' ou sem tamanho marcado", () => {
    expect(vinculoDisponivel("nenhum", COM_TAM)).toBe(true);
    expect(vinculoDisponivel("ambos", SEM_TAM)).toBe(true);
    expect(vinculoDisponivel("ambos", [])).toBe(true);
  });
  it("indisponivel com tamanho marcado e formato diferente de 'nenhum'", () => {
    expect(vinculoDisponivel("ambos", COM_TAM)).toBe(false);
  });
});

describe("vinculoLigadoSemTamanho (Salvar bloqueado: switch ligado sem tamanho escolhido)", () => {
  it("true quando o vinculo vale (ligado e disponivel) e nao ha tamanho", () => {
    for (const tamanho of [null, undefined, "", "   "]) {
      expect(vinculoLigadoSemTamanho({ ativo: true, tamanho, formato: "nenhum", blocos: [] })).toBe(true);
    }
  });
  it("false com tamanho escolhido", () => {
    expect(vinculoLigadoSemTamanho({ ativo: true, tamanho: "40|M", formato: "nenhum", blocos: [] })).toBe(false);
  });
  it("false com o switch desligado", () => {
    expect(vinculoLigadoSemTamanho({ ativo: false, tamanho: null, formato: "nenhum", blocos: [] })).toBe(false);
  });
  it("false quando o vinculo nao vale (tamanho marcado nas variantes): o Salvar so limpa (A2)", () => {
    expect(vinculoLigadoSemTamanho({ ativo: true, tamanho: null, formato: "ambos", blocos: COM_TAM })).toBe(false);
  });
});

describe("cadastro.etiquetas.tsx (fonte)", () => {
  it("bloqueia o Salvar com a mensagem de campo e a nome-celula quebra linha", () => {
    const f = readFileSync(resolve(__dirname, "../../src/routes/_authenticated/cadastro.etiquetas.tsx"), "utf8");
    expect(f).toContain("Escolha o tamanho ou desligue o vínculo.");
    expect(f).toMatch(/if \(vinculoLigadoSemTamanho\(/);
    expect(f).toMatch(/<span className="flex flex-wrap items-center gap-2 min-w-0">/);
  });

  const src = readFileSync(resolve(__dirname, "../../src/routes/_authenticated/cadastro.etiquetas.tsx"), "utf8");

  it("textos aprovados verbatim", () => {
    expect(src).toContain("Vincular a um tamanho");
    expect(src).toContain("Escolha o tamanho");
    expect(src).toContain(
      "Use para insumo que vai só nas peças de UM tamanho (ex.: etiqueta de tamanho M). Na Explosão a quantidade passa a ser consumo × peças desse tamanho, e o custo por peça é rateado. Só vale para insumo sem tamanho nas variantes.",
    );
    expect(src).toContain(
      'Disponível só para insumo sem tamanho nas variantes (formato "Nenhum" ou nenhum tamanho marcado).',
    );
    expect(src).toContain("Só tam. ");
  });

  it("le a coluna na lista e manda no insert/update (mesmo payload)", () => {
    expect(src).toMatch(/\.select\("[^"]*tamanho_vinculado[^"]*"\)/);
    expect(src).toMatch(/tamanho_vinculado:\s*tamanhoVinculadoParaSalvar\(/);
  });

  it("invalida as 3 keys depois de salvar", () => {
    for (const k of ["plan-ficha-etiquetas-cat", "ft-etiquetas-semtamanho", "insumos-tamanho-vinculado"]) {
      expect(src).toContain(`queryKey: ["${k}"]`);
    }
  });

  it("usa Switch + InfoHover + StatusBadge e respeita readOnly", () => {
    expect(src).toContain('from "@/components/ui/switch"');
    expect(src).toContain('from "@/components/shared/InfoHover"');
    expect(src).toContain('from "@/components/shared/StatusBadge"');
    expect(src).toMatch(/<Switch[\s\S]{0,400}disabled=\{readOnly/);
  });

  it("Switch + Select empilham no mobile", () => {
    expect(src).toMatch(/flex-col[^"]*sm:flex-row/);
  });
});
