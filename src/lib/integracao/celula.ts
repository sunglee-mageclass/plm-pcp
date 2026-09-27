// Integração — decisão PURA de cada célula da aba Produtos: editar ou só ler (e por quê) + o "i" de quem edita. Os gates
// vêm do servidor (D24); aqui só a ordem: estado (trava) → só leitura por natureza (P-80 A) → gate → salvando.
//
// Fix round 2 (revisão T12a round 2 #2, task-12a-review.md "Re-review round 1" R1-1 + task-12a-code-review.md
// "Re-check round 1" R2): `modoCelula(campo, p, true)` continua devolvendo `{tipo:"leitura", motivo:"Salvando…"}"`
// — é o CONTRATO do brief (Step 1, teste "salvando = nada edita" verbatim), intocável. O bug do round 1 era que
// `CelulaCampo.tsx` usava ESSE resultado para decidir também a UI de "edição pendente escondida por trava"
// (`LeituraComPendencia`), e "Salvando…" acabava caindo nessa mesma UI — mostrando "Sua alteração não pode ser
// salva: Salvando…" com um botão "descartar alteração" ATIVO durante todo Salvar (podia descartar visualmente um
// valor que o servidor já tinha recebido). A separação certa: `travaOuGate(campo, p)` decide SÓ a trava/gate (sem
// olhar `salvando`) — é o que `LeituraComPendencia` deve consultar; `salvando` é tratado à parte pelo componente
// (mostra o controle normal, desabilitado, com o valor do rascunho — nunca a UI de "não pode salvar").
import type { CampoDef } from "@/lib/integracao/campos";
import type { ProdutoLista } from "@/lib/integracao/produtos";

export type ModoCelula = { tipo: "editar" } | { tipo: "leitura"; motivo: string | null; travado: boolean };
export const TEXTO_TRAVADO_INTEGRAVEL = "Integrável — travado. Volte para não integrável para editar.";
export const TEXTO_TRAVADO_INTEGRADO = "Integrado — travado. Só o super admin desfaz a integração.";

/** SÓ a trava (estado)/gate do servidor — nunca olha `salvando`. É o que decide se uma edição pendente deve virar
 *  `LeituraComPendencia` (round 2): "Salvando…" NÃO é um motivo de "sua alteração não pode ser salva" — é só um
 *  estado transitório, e a UI de descarte não deve aparecer por causa dele. */
export function travaOuGate(campo: CampoDef, p: ProdutoLista): ModoCelula {
  if (p.estado !== "nao_integravel") {
    return { tipo: "leitura", motivo: p.estado === "integrado" ? TEXTO_TRAVADO_INTEGRADO : TEXTO_TRAVADO_INTEGRAVEL, travado: true };
  }
  if (campo.tipo === "somente_leitura" || campo.key === "metatag" || campo.key === "keywords" || !campo.gate) {
    return { tipo: "leitura", motivo: null, travado: false };
  }
  const g = p.gates[campo.gate];
  if (!g.ok) return { tipo: "leitura", motivo: g.motivo, travado: false };
  return { tipo: "editar" };
}

/** Contrato original do brief (intocado): trava/gate PRIMEIRO, depois `salvando`. Usado onde o "tipo" bruto basta
 *  (a decisão fina entre "Salvando…" e "trava real" fica em `travaOuGate`, para quem precisa diferenciar). */
export function modoCelula(campo: CampoDef, p: ProdutoLista, salvando: boolean): ModoCelula {
  const base = travaOuGate(campo, p);
  if (base.tipo === "leitura") return base;
  if (salvando) return { tipo: "leitura", motivo: "Salvando…", travado: false };
  return { tipo: "editar" };
}

export function infoEdicao(campo: CampoDef, p: ProdutoLista): string | null {
  if (campo.key === "ref_sku") {
    if (p.origem === "revenda") return "REF da revenda: nasce no cadastro do Produto Acabado; editar aqui muda nos dois lugares (mão dupla).";
    if (p.origem === "importado") return "REF do importado: nasce no cadastro do Produto Importado; editar aqui muda nos dois lugares (mão dupla).";
    return "REF manual liberada (etapa já revela a REF neste card) — editar aqui edita o card também.";
  }
  if (campo.key === "preco_venda" && p.origem === "revenda") return 'Grava como preço FIXO de revenda (mesma regra do card — "última edição manda").';
  if (campo.key === "preco_venda" && p.origem === "importado") return 'Grava como preço FIXO do importado (mesma regra do card — "última edição manda").';
  if (campo.key === "foto") return "As fotos novas só sobem no Salvar da página.";
  return null;
}
