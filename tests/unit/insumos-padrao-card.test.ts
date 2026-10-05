// @vitest-environment happy-dom
// Render - card "Insumos padrao" da Config da Loja (urg R2 T11): textos do brief, vazio, linha orfa ("Insumo removido")
// com Remover, duplicado, adicionar/remover e limite de 20. Sem rede, sem Supabase.
import { describe, it, expect, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InsumosPadraoCard } from "@/components/configuracoes/InsumosPadraoCard";
import { diagnosticarLinhasInsumosPadrao, type CatalogoInsumoPadrao, type InsumoPadrao } from "@/lib/insumos-padrao";
import { IP_IDS } from "../fixtures/insumos-padrao-casos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// Radix (Select/Tooltip) usa ResizeObserver/pointer capture no happy-dom
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const { E1, E2, C1, C2, E_INEXISTENTE } = IP_IDS;
const CATALOGO: CatalogoInsumoPadrao[] = [
  { id: E1, nome: "Etiqueta", cores: [{ id: C1, nome: "Azul" }, { id: C2, nome: "Preto" }] },
  { id: E2, nome: "Botao", cores: [] },
];

function montar(value: InsumoPadrao[], extra: Partial<Parameters<typeof InsumosPadraoCard>[0]> = {}) {
  const onChange = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      createElement(InsumosPadraoCard, {
        value,
        onChange,
        catalogo: CATALOGO,
        carregando: false,
        erro: false,
        tentando: false,
        onTentarDeNovo: vi.fn(),
        diagnostico: diagnosticarLinhasInsumosPadrao(value, CATALOGO),
        ...extra,
      }),
    );
  });
  return { container, onChange, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

describe("InsumosPadraoCard", () => {
  it("titulo, descricao do brief e marca de presenca por bloco", () => {
    const { container, unmount } = montar([]);
    expect(container.textContent).toContain("Insumos padrão");
    expect(container.textContent).toContain(
      'Entram já preenchidos na seção Insumos ao criar um produto INTERNO pelo "Novo Modelo" (como rascunho — só gravam no Salvar do card). Produtos existentes não mudam.',
    );
    expect(container.querySelector('[data-colab-path="cfg:insumos_padrao"]')).not.toBeNull();
    unmount();
  });

  it("vazio: 'Nenhum insumo padrao.' e botao '+ Adicionar insumo' que acrescenta uma linha em branco", () => {
    const { container, onChange, unmount } = montar([]);
    expect(container.textContent).toContain("Nenhum insumo padrão.");
    const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "+ Adicionar insumo")!;
    expect(btn).toBeTruthy();
    act(() => { btn.click(); });
    expect(onChange).toHaveBeenCalledWith([{ etiqueta_id: "", cor_id: null, consumo: 0 }]);
    unmount();
  });

  it("linha orfa (insumo apagado do cadastro): 'Insumo removido' + mensagem em ambar + Remover tira so a linha", () => {
    const lista: InsumoPadrao[] = [
      { etiqueta_id: E1, cor_id: C1, consumo: 1 },
      { etiqueta_id: E_INEXISTENTE, cor_id: null, consumo: 2 },
    ];
    const { container, onChange, unmount } = montar(lista);
    expect(container.textContent).toContain("Insumo removido");
    expect(container.textContent).toContain("Insumo removido do cadastro — remova esta linha.");
    const remover = container.querySelectorAll('button[aria-label="Remover insumo"]');
    expect(remover).toHaveLength(2);
    act(() => { (remover[1] as HTMLButtonElement).click(); });
    expect(onChange).toHaveBeenCalledWith([lista[0]]);
    unmount();
  });

  it("par repetido mostra 'Este insumo nesta cor ja esta na lista.' na 2a linha", () => {
    const { container, unmount } = montar([
      { etiqueta_id: E1, cor_id: C1, consumo: 1 },
      { etiqueta_id: E1, cor_id: C1, consumo: 2 },
    ]);
    const msgs = Array.from(container.querySelectorAll("p")).map((p) => p.textContent);
    expect(msgs.filter((m) => m === "Este insumo nesta cor já está na lista.")).toHaveLength(1);
    unmount();
  });

  it("sem catalogo (falha): nada vira 'removido'; aviso + Tentar de novo; adicionar travado", () => {
    const lista: InsumoPadrao[] = [{ etiqueta_id: E1, cor_id: null, consumo: 1 }];
    const onTentarDeNovo = vi.fn();
    const { container, unmount } = montar(lista, { catalogo: undefined, erro: true, diagnostico: null, onTentarDeNovo });
    expect(container.textContent).not.toContain("Insumo removido");
    expect(container.textContent).toContain("Não foi possível carregar os insumos.");
    const tentar = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Tentar de novo")!;
    act(() => { tentar.click(); });
    expect(onTentarDeNovo).toHaveBeenCalled();
    const add = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "+ Adicionar insumo")!;
    expect(add.disabled).toBe(true);
    unmount();
  });

  it("limite de 20: botao Adicionar desabilitado", () => {
    const lista = Array.from({ length: 20 }, (_, i) => ({ etiqueta_id: i % 2 ? E1 : E2, cor_id: i % 2 ? (i % 4 === 1 ? C1 : C2) : null, consumo: 1 }));
    const { container, unmount } = montar(lista);
    const add = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "+ Adicionar insumo")!;
    expect(add.disabled).toBe(true);
    expect(container.textContent).toContain("20/20");
    unmount();
  });
});
