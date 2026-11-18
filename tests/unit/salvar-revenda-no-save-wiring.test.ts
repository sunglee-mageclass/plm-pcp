// Salvar por card da revenda (C7, Task 2) — fiação (asserções de fonte): o Salvar único grava markup/preço fixo da revenda
// (bloco gêmeo do n1 do importado) com a base CONGELADA no ponto síncrono inicial, e o PlanejamentoDetail espelha o ref a cada render.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const hook = readFileSync(ROOT + "src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts", "utf8");
const detail = readFileSync(ROOT + "src/components/planejamento/PlanejamentoDetail.tsx", "utf8");

describe("Salvar por card da revenda — fiação", () => {
  it("o hook congela revendaSaveRef ANTES de qualquer await e grava as 2 RPCs só do grupo que mudou, depois do n1", () => {
    expect(hook).toMatch(/revendaSaveRef\?: RefObject</);
    const iCong = hook.indexOf("const revendaCongelada = revendaSaveRef?.current ?? null;");
    const iPrimeiroAwait = hook.indexOf("await lerGradeServidorComprado(");
    expect(iCong).toBeGreaterThan(0);
    expect(iCong).toBeLessThan(iPrimeiroAwait);
    const iN1 = hook.indexOf('d.origem === "importado" && piOn && podeEditarPreco');
    const iBloco = hook.indexOf('d.origem === "revenda" && revendaCongelada');
    expect(iBloco).toBeGreaterThan(iN1);
    expect(hook).toMatch(/payloadRevendaParaSalvar\(/);
    expect(hook).toMatch(/if \(pay\.markups\)[\s\S]*salvar_markups_produto_acabado/);
    expect(hook).toMatch(/if \(pay\.fixos\)[\s\S]*salvar_precos_fixo_produto_acabado/);
    expect(hook).toMatch(/travaIntegracao\??\.has\("preco_venda"\)/);
    // a permissão do comprado é o OU do ref (podeEditarPrecoComprado), NÃO `podeEditarPreco` (mais estrito): o bloco não a repete.
    expect(hook).not.toMatch(/d\.origem === "revenda" && revendaCongelada && podeEditarPreco/);
  });

  it("o onSuccess do Salvar invalida os 4 caches que as mutations onBlur invalidavam", () => {
    // `["modelo", modeloId]` ⊂ `["modelo"]` (todo save) e `["produtos-acabados"]` ⊂ o predicate `startsWith("produtos-acabados")` (revenda).
    expect(hook).toContain('queryKey: ["modelo"]');
    expect(hook).toContain('startsWith("produtos-acabados")');
    expect(hook).toContain('queryKey: ["pa-produto-modelo", modeloId]');
    expect(hook).toContain('queryKey: ["modelos-planejamento"]');
  });

  it("o PlanejamentoDetail monta o ref (espelho síncrono) e o passa ao hook", () => {
    expect(detail).toMatch(/const revendaSaveRef = useRef</);
    expect(detail).toMatch(/revendaSaveRef\.current =/);
    // base com preço 0 normalizado para null (como o n1): senão 0 !== null dispara a RPC de preço fixo em todo Salvar.
    expect(detail).toMatch(/preco_atacado: \(draft\.preco_atacado \?\? 0\) > 0 \? draft\.preco_atacado : null/);
    expect(detail).toMatch(/preco_venda: \(draft\.preco_venda \?\? 0\) > 0 \? draft\.preco_venda : null/);
    expect(detail).toMatch(/usePlanejamentoSave\(\{[\s\S]*revendaSaveRef,/);
  });
});
