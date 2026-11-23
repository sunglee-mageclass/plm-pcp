// @vitest-environment happy-dom
// Grade "Lista tipo Excel" de Cadastro > Aviamentos (AV-2): FOTO por cor. Render real da `AviamentosGradeAba` com `supabase` mockado.
// Prova: cor COM foto mostra a miniatura (link assinado do bucket "aviamentos") e cor SEM foto mostra "inserir foto"; escolher o
// arquivo sobe pro bucket "aviamentos", grava `variantes_aviamento.foto_url` NA HORA (sem passar pelo Salvar, sem selo âmbar) e apaga
// a foto antiga; falha no upload não grava. O upload real no Storage é QA no navegador.
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import {
  aviamentoUpdates,
  clicar,
  estado,
  flush,
  montar,
  PROPS,
  remove,
  resetar,
  rpc,
  salvaLotes,
  sleep,
  toast,
  upload,
  variantesUpdates,
} from "./aviamento-grade-harness";

beforeEach(() => {
  resetar();
  estado.variantes[0].foto_url = "tenant1/av1/v1-antiga.jpg";
});

const linhaDa = (c: HTMLElement, varianteId: string) =>
  c.querySelector(`tr[data-variante-id="${varianteId}"]`) as HTMLElement;
const celulaFoto = (c: HTMLElement, varianteId: string) =>
  linhaDa(c, varianteId).querySelector('td[data-col="foto"]') as HTMLElement;
function escolherArquivo(input: HTMLInputElement, file: File) {
  return act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(60);
  });
}

describe("Foto por cor na grade de Aviamentos", () => {
  it("cor COM foto mostra a miniatura (link assinado do bucket 'aviamentos') e cor SEM foto mostra 'inserir foto'", async () => {
    const t = await montar(PROPS());
    const comFoto = celulaFoto(t.container, "v1");
    expect((comFoto.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe(
      "https://assinado.test/aviamentos/tenant1/av1/v1-antiga.jpg",
    );
    expect(comFoto.querySelector('[aria-label^="Trocar foto"]')).not.toBeNull();
    const semFoto = celulaFoto(t.container, "v2");
    expect(semFoto.querySelector("img")).toBeNull();
    expect(semFoto.textContent).toContain("inserir foto");
    expect(semFoto.querySelector('[aria-label^="Inserir foto"]')).not.toBeNull();
    await t.desmontar();
  });

  it("clicar na miniatura abre o lightbox (ampliar) com a imagem grande", async () => {
    const t = await montar(PROPS());
    await clicar(celulaFoto(t.container, "v1").querySelector('[role="button"]'));
    await flush(20);
    const dentro = document.body.querySelector('[role="dialog"] img') as HTMLImageElement | null;
    expect(dentro?.getAttribute("src")).toBe(
      "https://assinado.test/aviamentos/tenant1/av1/v1-antiga.jpg",
    );
    await t.desmontar();
  });

  it("escolher o arquivo sobe pro bucket 'aviamentos', grava foto_url NA HORA (sem Salvar, sem selo) e apaga a foto antiga", async () => {
    const t = await montar(PROPS());
    const input = celulaFoto(t.container, "v1").querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input.accept).toBe("image/*");
    await escolherArquivo(input, new File(["x"], "Botão 01.PNG", { type: "image/png" }));
    await flush(60);

    expect(upload).toHaveBeenCalledTimes(1);
    const [bucket, path, , opts] = upload.mock.calls[0];
    expect(bucket).toBe("aviamentos");
    expect(path).toMatch(/^tenant1\/av1\/v1-\d+\.png$/); // loja/aviamento/cor-timestamp.ext (a 1ª pasta é a loja: RLS do bucket)
    expect(opts).toEqual({ upsert: true });
    expect(variantesUpdates).toHaveLength(1);
    expect(variantesUpdates[0]).toMatchObject({ id: "v1", payload: { foto_url: path } });
    expect(remove).toHaveBeenCalledWith("aviamentos", ["tenant1/av1/v1-antiga.jpg"]);
    expect(toast.success).toHaveBeenCalledWith("Foto atualizada.");
    // fora do rascunho: nenhum selo âmbar, nenhum UPDATE de aviamento, nenhuma chamada de lote
    expect(t.container.querySelectorAll("[data-selo-nao-salvo]")).toHaveLength(0);
    expect(aviamentoUpdates).toHaveLength(0);
    expect(salvaLotes()).toHaveLength(0);
    expect(rpc.mock.calls.filter((c) => c[0] !== "get_user_tenant_id")).toHaveLength(0);
    // a grade releu: a miniatura agora é a nova
    expect(celulaFoto(t.container, "v1").querySelector("img")!.getAttribute("src")).toBe(
      `https://assinado.test/aviamentos/${path}`,
    );
    await t.desmontar();
  });

  it("cor sem foto: sobe sem apagar nada; falha no upload mostra o erro e não grava", async () => {
    const t = await montar(PROPS());
    estado.falhaUpload = true;
    await escolherArquivo(
      celulaFoto(t.container, "v2").querySelector('input[type="file"]') as HTMLInputElement,
      new File(["x"], "foto.jpg", { type: "image/jpeg" }),
    );
    await flush(40);
    expect(variantesUpdates).toHaveLength(0);
    expect(remove).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();

    estado.falhaUpload = false;
    await escolherArquivo(
      celulaFoto(t.container, "v2").querySelector('input[type="file"]') as HTMLInputElement,
      new File(["x"], "foto.jpg", { type: "image/jpeg" }),
    );
    await flush(60);
    expect(variantesUpdates).toHaveLength(1);
    expect(remove).not.toHaveBeenCalled(); // não havia foto antiga
    await t.desmontar();
  });

  it("arquivo que não é imagem é recusado (nada sobe)", async () => {
    const t = await montar(PROPS());
    await escolherArquivo(
      celulaFoto(t.container, "v2").querySelector('input[type="file"]') as HTMLInputElement,
      new File(["x"], "planilha.xlsx", { type: "application/vnd.ms-excel" }),
    );
    await flush(30);
    expect(upload).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    await t.desmontar();
  });

  it("foto e rascunho são independentes: com a cor suja, a foto grava na hora e o rascunho segue sujo e intacto", async () => {
    const t = await montar(PROPS());
    const { digitar, porLabel, linhas, botaoSalvar } = await import("./aviamento-grade-harness");
    await digitar(
      porLabel(linhas(t.container)[2], "Nome da variante da cor de Botão")[0],
      "Texto novo",
    );
    await escolherArquivo(
      celulaFoto(t.container, "v2").querySelector('input[type="file"]') as HTMLInputElement,
      new File(["x"], "foto.jpg", { type: "image/jpeg" }),
    );
    await flush(60);
    expect(variantesUpdates).toHaveLength(1);
    expect(porLabel(linhas(t.container)[2], "Nome da variante da cor de Botão")[0].value).toBe(
      "Texto novo",
    );
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    await clicar(botaoSalvar());
    await flush(60);
    // o lote de cores NÃO leva a foto (a RPC não toca foto_url): ela só mudou pelo upload
    expect(Object.keys(salvaLotes()[0][1]._variantes[1]).sort()).toEqual([
      "codigo_variante",
      "cor_apelido_id",
      "cor_id",
      "id",
      "nome_variante",
      "preco",
    ]);
    await t.desmontar();
  });

  it("somente leitura: sem botão de envio (só a miniatura)", async () => {
    const t = await montar(PROPS());
    // o harness não liga o modo leitura da tela; o contrato aqui é o da célula: sem `onEnviar` não há <input type=file>
    const { CelulaAviamento } = await import("@/components/aviamento/grade/CelulaAviamento");
    const { createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { COLUNAS_AVIAMENTO } = await import("@/lib/aviamento-grade/colunas");
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        createElement(CelulaAviamento, {
          coluna: COLUNAS_AVIAMENTO.find((c) => c.key === "foto")!,
          ariaLabel: "Foto",
          foto: { path: null },
        }),
      );
    });
    expect(el.querySelector('input[type="file"]')).toBeNull();
    expect(el.querySelector("button")).toBeNull();
    await act(async () => {
      root.unmount();
    });
    await t.desmontar();
  });
});
