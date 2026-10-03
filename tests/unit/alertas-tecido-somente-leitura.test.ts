// Reforço de segurança S3a, fix round 1 — P-245 A: os botões dos Alertas de Tecido GRAVAM (Estilo OK, observação, troca,
// cancelar/reabrir rolo ou variante, receber reposição/desfazer troca) e exigem EDITAR Alertas OU OC Tecido — o MESMO OU do
// servidor (20261101100000/120000). Quem só VÊ a página não vê os botões (somem, não só desabilitam) e vê a observação só como texto.
// Render real do cartão (react-dom/server) + anti-drift do OU contra a migration.
import { describe, it, expect, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { AlertaCard, PAGINAS_EDITAR_ALERTAS, podeEditarAlertas } from "@/components/oc-tecido/CqTecido";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const nada = () => {};
const ACOES = {
  ocupado: { resol: false, resolRolo: false, reabrirRolo: false },
  onEstiloOk: nada, onTroca: nada, onCancelar: nada, onReabrir: nada, onReceber: nada,
};
const UPDATE = { mutate: nada, isPending: false } as any;
const item = (cq_alerta_status: string, extra: Record<string, unknown> = {}) => ({
  id: "i1", oc_id: "o1", oc_numero: "OC-1", artigo: "Linho", variante: "Azul", cq_observacao: "manchado na ourela",
  cq_ok: false, cq_alerta_status, is_rolo: false, usado: false, ...extra,
}) as any;
const render = (it: any, podeEditar: boolean) => renderToStaticMarkup(h(AlertaCard, { it, podeEditar, update: UPDATE, acoes: ACOES }));
const BOTOES = ["Estilo OK", "Troca", "Cancelar variante", "Cancelar rolo", "Reabrir", "Receber reposição", "Desfazer troca"];

describe("Alertas de Tecido — modo só leitura (P-245 A)", () => {
  it("quem EDITA vê os botões de cada estado e a observação editável", () => {
    expect(render(item("alertado"), true)).toContain("Estilo OK</button>");
    expect(render(item("alertado"), true)).toContain("Cancelar variante");
    expect(render(item("alertado", { is_rolo: true }), true)).toContain("Cancelar rolo");
    expect(render(item("troca_pendente"), true)).toContain("Receber reposição");
    expect(render(item("estilo_ok"), true)).toContain("Reabrir");
    expect(render(item("alertado"), true)).toContain("<textarea");
  });

  it("quem só VÊ: nenhum botão (somem) em nenhum estado; a observação vira texto (sem textarea)", () => {
    for (const st of ["alertado", "troca_pendente", "estilo_ok", "cancelado", "trocado"]) {
      for (const rolo of [false, true]) {
        const html = render(item(st, { is_rolo: rolo }), false);
        for (const b of BOTOES) expect(html, `${st} rolo=${rolo}: ${b}`).not.toContain(`${b}</button>`); // o selo "Troca pendente" fica
        expect(html).not.toContain("<button");
        expect(html).not.toContain("<textarea");
        expect(html).toContain("manchado na ourela");
        expect(html).toContain("Linho"); // o alerta continua visível
      }
    }
    expect(render(item("alertado", { cq_observacao: null }), false)).not.toContain("alerta-obs-leitura");
  });

  it("o OU da tela = o OU do servidor (Alertas OU OC Tecido)", () => {
    expect([...PAGINAS_EDITAR_ALERTAS].sort()).toEqual(["entrada_alertas_tecido", "entrada_oc_tecido"]);
    expect(podeEditarAlertas((p) => p === "entrada_oc_tecido")).toBe(true);
    expect(podeEditarAlertas((p) => p === "entrada_alertas_tecido")).toBe(true);
    expect(podeEditarAlertas((p) => p === "financeiro_parcelas")).toBe(false);
    const sql = readFileSync(ROOT + "supabase/migrations/20261101100000_seg_s3a_helper_gates_entrada.sql", "utf8");
    for (const fn of ["aplicar_resolucao_alerta_tecido", "receber_reposicao_troca", "cancelar_rolo", "reabrir_rolo", "trocar_rolo"]) {
      const corpo = sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`));
      const portao = corpo.slice(0, corpo.indexOf("$function$;"));
      expect(portao, fn).toContain("PERFORM public._seg_exige_pagina('entrada_alertas_tecido', 'entrada_oc_tecido');");
    }
    const guarda = readFileSync(ROOT + "supabase/migrations/20261101120000_seg_s3a_guarda_oc.sql", "utf8");
    expect(guarda).toContain("PERFORM public._seg_exige_pagina('entrada_oc_tecido', 'entrada_alertas_tecido');"); // ocs_tecido_itens
  });

  it("a rota usa o mesmo OU para não mostrar o selo 'somente leitura' a quem edita pela OC Tecido", () => {
    const rota = readFileSync(ROOT + "src/routes/_authenticated/entrada-saida.alertas-tecido.tsx", "utf8");
    expect(rota).toMatch(/<RequirePermission page="entrada_alertas_tecido" editarCom=\{PAGINAS_EDITAR_ALERTAS\}>/);
    const lista = readFileSync(ROOT + "src/components/oc-tecido/CqTecido.tsx", "utf8");
    expect(lista).toMatch(/const podeEditar = podeEditarAlertas\(canEdit\);/);
    expect(lista).toMatch(/<ReadOnlyScope value=\{!podeEditar\}>/); // os diálogos seguem a mesma regra
  });
});
