// [camada C2] Fiação (asserções de fonte, complementam os testes de comportamento das telas): as ações aprovadas SÓ chegam ao servidor
// pelo diálogo; o `confirm()` nativo do Financeiro saiu; "Lançar"/"Confirmar" (Seção 2, P-263 B) continuam diretos.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("[camada C2] fiação das confirmações", () => {
  const fin = ler("src/routes/_authenticated/financeiro.tsx");
  it("Financeiro: sem confirm() nativo; Recalcular usa o diálogo", () => {
    // (ignora comentários) nenhuma chamada confirm(...) fora de comentário
    expect(fin.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")).not.toMatch(/(?<![\w.])confirm\(/);
    expect(fin).toContain("textoRecalcularParcelas");
  });
  it("Financeiro: as 3 mutações de desmarcar pago só são chamadas por dentro dos botões com confirmação", () => {
    // 2 lugares de OC (detalhe + lista) e 2 de Serviço (detalhe + lista), todos via DesmarcarPagoBtn / DesmarcarPagoServicoBtn
    expect(fin).toContain("<DesmarcarPagoBtn parcela={parcela} onClick={() => desmarcarPagoMut.mutate()}");
    expect(fin).toContain("<DesmarcarPagoBtn parcela={p} onClick={() => desmarcarMut.mutate(p.id)}");
    expect(fin).toContain("<DesmarcarPagoServicoBtn row={r} onConfirmar={() => togglePago.mutate({ id: r.parcela_id, pago: false })}");
    expect(fin).toContain("<DesmarcarPagoServicoBtn row={row} onConfirmar={() => onTogglePago(false)}");
    // nenhum <Button> cru chama as mutações de desmarcar
    expect(fin).not.toMatch(/<Button[^>]*onClick=\{\(\) => (desmarcarPagoMut\.mutate\(\)|desmarcarMut\.mutate\(p\.id\)|togglePago\.mutate\(\{ id: r\.parcela_id, pago: false \}\)|onTogglePago\(false\))/);
  });
  it("CQ / Direcionamento / OTB / Lançamento: nenhum botão chama a mutação de desfazer direto", () => {
    const cq = ler("src/routes/_authenticated/expedicao.cq.$modeloId.tsx");
    expect(cq).not.toMatch(/onClick=\{\(\) => desmarcarMut\.mutate\(\)\}/);
    expect(cq).not.toMatch(/onClick=\{\(\) => cqPosRef\.current\?\.desmarcar\(\)\}/);
    const dir = ler("src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx");
    expect(dir).not.toMatch(/onClick=\{\(\) => desmarcarMut\.mutate\(\)\}/);
    expect(ler("src/components/otb/ColecaoSheet.tsx")).not.toMatch(/onClick=\{\(\) => desconfirmar\.mutate\(\)\}/);
    expect(ler("src/components/otb/ColecaoPVSheet.tsx")).not.toMatch(/onClick=\{\(\) => desconfirmar\.mutate\(\)\}/);
    expect(ler("src/components/planejamento/PlanejamentoDetail.tsx")).not.toMatch(/onClick=\{\(\) => lancar\.mutate\(false\)\}/);
  });
  it("Seção 2 NÃO implementada (P-263 A): Lançar e Confirmar CQ seguem diretos", () => {
    expect(ler("src/components/planejamento/PlanejamentoDetail.tsx")).toContain("onClick={() => lancar.mutate(true)}");
    expect(ler("src/routes/_authenticated/expedicao.cq.$modeloId.tsx")).toContain("onClick={() => confirmMut.mutate()}");
  });
  it("Apagar tudo (P-262 A): marcas do servidor vêm de UM arquivo (TODO C1) e as 4 telas usam o guarda", () => {
    const m = ler("src/lib/apagar-tudo.ts");
    expect(m).toContain('MARCA_APAGAR_TUDO_SERVICOS = "_apagar_tudo"');
    expect(m).toContain('MARCA_APAGAR_TUDO_ITENS_OC = "_apagar_itens"');
    expect(m).toContain("TODO(C1)");
    for (const f of [
      "src/routes/_authenticated/pcp.servicos.$modeloId.tsx",
      "src/routes/_authenticated/entrada-saida.oc-tecido.tsx",
      "src/routes/_authenticated/entrada-saida.oc-aviamento.tsx",
      "src/routes/_authenticated/entrada-saida.oc-insumo.tsx",
    ]) expect(ler(f), f).toContain("exigirConfirmacaoApagarTudo(");
    // Direcionamento NÃO ganha este diálogo (a tela sempre monta lojas × variantes)
    expect(ler("src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx")).not.toContain("apagar-tudo");
  });
  it("Apagar tudo (OC): a frase do diálogo diz a verdade quando a lista esvaziou SEM clicar em remover (M3 pós-review)", () => {
    for (const f of ["tecido", "aviamento"])
      expect(ler(`src/routes/_authenticated/entrada-saida.oc-${f}.tsx`), f)
        .toContain('motivo: itemsLiveRef.current.length > 0 ? "sem_linha_valida" : "removeu"');
    const ins = ler("src/routes/_authenticated/entrada-saida.oc-insumo.tsx");
    expect(ins).toContain('motivo: trocouFornecedor ? "troca_fornecedor" : "removeu"');
    expect(ins).toContain("const trocouFornecedor =");
  });
  it("Etapas PL: só 'Reprovado' pede confirmação ('Aprovado' segue direto)", () => {
    const e = ler("src/components/producao/etapas/EtapaCardView.tsx");
    expect(e).toContain('if (v === "reprovado")');
    expect(e).toContain('onChange("pt_aprovacao", v || null)');
  });
});
