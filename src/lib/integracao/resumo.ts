// Integração — o resumo do "Tenho certeza — integrar" (mockup 3): vem de integracao_previa = o dado SALVO no banco, nunca o
// rascunho da tela. Quem entra (completo, não integrável, não reprovado, com assinatura), quem fica fora e por quê, e as
// assinaturas que o integracao_marcar confere (P0409 integracao_mudou se o produto mudou no meio). PURO.
//
// Adaptações do executor sobre o brief da Task 13 (ver task-13-report.md):
// - O shape REAL de `integracao_previa` (migration 2, `20261007110000_integracao_2_retrato.sql:529-568`) manda
//   `assinatura` no NÍVEL DO PRODUTO (`jsonb_build_object('modelo_id',…,'assinatura', public._integracao_assinar(...))`),
//   não dentro de `retrato`/de uma linha — `produtoDe` lê `o.assinatura` direto (o brief já assumia isso: `ProdutoPrevia`
//   tem `assinatura` como campo próprio, então nenhuma adaptação de fato aqui, só confirmado contra o SQL).
// - O campo do produto no jsonb do servidor é `retrato` (objeto `{campos, linhas}`), IGUAL ao brief; `LinhaPrevia` lê
//   `l.valores`/`l.fotos` da mesma forma que `produtos.ts` já faz para `Retrato`/`LinhaRetrato` (mesmo padrão de leitura
//   tolerante, `obj`/`arr`/`txt`).
import { ordenarCampos, type CampoKey } from "@/lib/integracao/campos";
import { TEXTO_PRECISA_CUSTO, formatarValor, textoFaltas, textoFotos, type Falta } from "@/lib/integracao/produtos";

export type LinhaPrevia = { tipo: "produto" | "variante"; valores: Partial<Record<string, string | null>>; fotos: string[] };
export type ProdutoPrevia = {
  modeloId: string; nome: string; ref: string | null; estado: string; reprovado: boolean; completo: boolean; faltas: Falta[];
  linhas: LinhaPrevia[]; assinatura: string | null;
};
export type ResumoIntegrar = {
  campos: CampoKey[]; precisaVerCustos: boolean; podeVerCustos: boolean; entram: ProdutoPrevia[];
  // Fix round 1 T13 (revisão T13 #7, code-review m7): `modeloId`/`ref` além de `nome` — a UI usa `modeloId` como
  // key do React (nunca `nome`, que colide quando 2 produtos têm o mesmo nome) e mostra a REF ao lado do nome.
  fora: { modeloId: string; nome: string; ref: string | null; motivo: string }[]; sublinhas: number; bloqueio: string | null;
};
export const MOTIVO_MIN = 3;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);

function produtoDe(v: unknown): ProdutoPrevia {
  const o = obj(v);
  const ass = txt(o.assinatura);
  return {
    modeloId: txt(o.modelo_id) ?? "", nome: txt(o.nome) ?? "", ref: txt(o.ref), estado: txt(o.estado) ?? "nao_integravel",
    reprovado: o.reprovado === true, completo: o.completo === true,
    faltas: arr(o.faltas).map(obj).map((f) => ({ campo: txt(f.campo) ?? "", texto: txt(f.texto) ?? "" })),
    linhas: arr(obj(o.retrato).linhas).map(obj).map((l): LinhaPrevia => ({
      tipo: l.tipo === "variante" ? "variante" : "produto",
      valores: Object.fromEntries(Object.entries(obj(l.valores)).map(([k, x]) => [k, x === null || x === undefined ? null : String(x)])),
      fotos: arr(l.fotos).filter((f): f is string => typeof f === "string"),
    })),
    assinatura: ass && /^[0-9a-f]{64}$/.test(ass) ? ass : null,
  };
}
function motivoFora(p: ProdutoPrevia): string | null {
  if (p.estado === "integravel") return "Já está integrável.";
  if (p.estado === "integrado") return "Já integrado.";
  if (p.reprovado) return "Produto reprovado.";
  if (!p.completo) return textoFaltas(p.faltas) || "Produto incompleto.";
  if (!p.assinatura) return "Não foi possível conferir o produto — recarregue a página.";
  return null;
}
export function lerResumo(raw: unknown): ResumoIntegrar {
  const o = obj(raw);
  const produtos = arr(o.produtos).map(produtoDe).filter((p) => p.modeloId !== "");
  const entram = produtos.filter((p) => motivoFora(p) === null);
  const fora = produtos.filter((p) => motivoFora(p) !== null)
    .map((p) => ({ modeloId: p.modeloId, nome: p.nome, ref: p.ref, motivo: motivoFora(p) as string }));
  const precisaVerCustos = o.precisa_ver_custos === true;
  const podeVerCustos = o.pode_ver_custos !== false;
  const bloqueio = precisaVerCustos && !podeVerCustos ? TEXTO_PRECISA_CUSTO
    : entram.length === 0 ? "Nenhum produto selecionado pode ser integrado." : null;
  return {
    campos: ordenarCampos(arr(o.campos).filter((c): c is string => typeof c === "string")), precisaVerCustos, podeVerCustos,
    entram, fora, sublinhas: entram.reduce((s, p) => s + p.linhas.filter((l) => l.tipo === "variante").length, 0), bloqueio,
  };
}
export const itensMarcar = (r: ResumoIntegrar): { modelo_id: string; assinatura: string }[] =>
  r.entram.map((p) => ({ modelo_id: p.modeloId, assinatura: p.assinatura as string }));
export function celulaResumo(campo: CampoKey, linha: LinhaPrevia, produto: boolean): string {
  if (campo === "foto") return produto ? textoFotos(linha.fotos.length) : "—";
  return formatarValor(campo, linha.valores[campo] ?? null);
}
export function listaNomes(nomes: string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}
export function textoVoltar(nomes: string[]): string {
  return nomes.length === 1
    ? `${nomes[0]} volta para Não integrável e é destravado. Fica registrado no Log. Só é possível porque a API ainda não levou este produto.`
    : `${listaNomes(nomes)} voltam para Não integrável e são destravados. Fica registrado no Log. Só é possível porque a API ainda não levou estes produtos.`;
}
export function textoDesfazer(nome: string, ref: string | null): string {
  return `${nome}${ref ? ` (${ref})` : ""} volta para Não integrável. Os campos travados são destravados. Esta ação é registrada no Log.`;
}
