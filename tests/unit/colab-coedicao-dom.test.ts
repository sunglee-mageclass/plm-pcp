// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { aplicarCoedicao, ATTR_COEDICAO, type LockInfo } from "@/lib/colab/coedicao";

// happy-dom por arquivo (docblock acima; o config global é "node"). Montamos um scope com 2 campos
// rotulados (o path é derivado do <label>, como no projeto real). Sem `id`/`name` nos inputs: eles têm
// precedência sobre o rótulo em `pathDoElemento` (daria `id:nome`, não `lbl:nome`); o hook de busca é `data-t`.
function montarScope(): HTMLElement {
  const scope = document.createElement("div");
  scope.innerHTML = `
    <div class="grid gap-1"><label>Nome</label><input data-t="nome" /></div>
    <div class="grid gap-1"><label>Cor</label><input data-t="cor" /></div>`;
  document.body.appendChild(scope);
  return scope;
}
const lk = (key: string, path: string, ts: number): LockInfo => ({ key, path, ts });

describe("aplicarCoedicao", () => {
  it("campo travado por OUTRO fica disabled + marca + valor injetado", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("[data-t=nome]")!;
    aplicarCoedicao(scope, [lk("z::9", "lbl:nome", 1000)], { "lbl:nome": "Vestido" }, "a::1", 1500);
    expect(nome.disabled).toBe(true);
    expect(nome.getAttribute(ATTR_COEDICAO)).toBe("1");
    expect(nome.value).toBe("Vestido");
  });
  it("campo LIVRE fica intocado", () => {
    const scope = montarScope();
    const cor = scope.querySelector<HTMLInputElement>("[data-t=cor]")!;
    aplicarCoedicao(scope, [lk("z::9", "lbl:nome", 1000)], {}, "a::1", 1500);
    expect(cor.disabled).toBe(false);
    expect(cor.hasAttribute(ATTR_COEDICAO)).toBe(false);
  });
  it("campo MEU não é travado", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("[data-t=nome]")!;
    aplicarCoedicao(scope, [lk("a::1", "lbl:nome", 1000)], {}, "a::1", 1500);
    expect(nome.disabled).toBe(false);
  });
  it("ao soltar o lock, reverte SÓ o que ele travou (idempotente)", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("[data-t=nome]")!;
    aplicarCoedicao(scope, [lk("z::9", "lbl:nome", 1000)], {}, "a::1", 1500);
    expect(nome.disabled).toBe(true);
    aplicarCoedicao(scope, [], {}, "a::1", 1600); // lock sumiu
    expect(nome.disabled).toBe(false);
    expect(nome.hasAttribute(ATTR_COEDICAO)).toBe(false);
  });
  it("não reverte disabled de campo que JÁ estava disabled por outra razão", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("[data-t=nome]")!;
    nome.disabled = true; // desabilitado por permissão, sem a marca de co-edição
    aplicarCoedicao(scope, [], {}, "a::1", 1500);
    expect(nome.disabled).toBe(true); // intocado
  });
  it("campo disabled por outra razão + lock de outro: não ganha a marca e CONTINUA disabled quando o lock some", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("[data-t=nome]")!;
    nome.disabled = true; // permissão/ReadOnlyScope, sem a marca de co-edição
    aplicarCoedicao(scope, [lk("z::9", "lbl:nome", 1000)], { "lbl:nome": "Vestido" }, "a::1", 1500);
    expect(nome.disabled).toBe(true);
    expect(nome.hasAttribute(ATTR_COEDICAO)).toBe(false); // não fomos nós que desabilitamos
    expect(nome.value).toBe("Vestido"); // valor ao vivo segue sendo injetado
    aplicarCoedicao(scope, [], {}, "a::1", 1600); // lock sumiu
    expect(nome.disabled).toBe(true); // a permissão segue valendo
    expect(nome.hasAttribute(ATTR_COEDICAO)).toBe(false);
  });
  it("campo marcado que foi reabilitado (re-render) é re-travado na próxima chamada", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("[data-t=nome]")!;
    const locks = [lk("z::9", "lbl:nome", 1000)];
    aplicarCoedicao(scope, locks, {}, "a::1", 1500);
    expect(nome.disabled).toBe(true);
    nome.disabled = false; // re-render do React reabilitou, a marca ficou
    expect(nome.getAttribute(ATTR_COEDICAO)).toBe("1");
    aplicarCoedicao(scope, locks, {}, "a::1", 1600);
    expect(nome.disabled).toBe(true); // re-enforcement
    expect(nome.getAttribute(ATTR_COEDICAO)).toBe("1");
  });
  it("lock expirado de outro não trava (campo livre)", () => {
    const scope = montarScope();
    const nome = scope.querySelector<HTMLInputElement>("[data-t=nome]")!;
    aplicarCoedicao(scope, [lk("z::9", "lbl:nome", 1000)], {}, "a::1", 1000 + 10_001);
    expect(nome.disabled).toBe(false);
  });
});
