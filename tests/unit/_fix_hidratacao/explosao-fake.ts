// [camada C4] RPCs FALSAS da Explosão, em memória, sobre as linhas do FAKE: espelham o que o banco faz de relevante para o
// R-02 — cada RPC é UMA transação que sobe o `rev` do cad (1 bump), confere `_rev_base` (P0409 se diferente), e o banco
// NORMALIZA o que grava (numeric(10,2), integer). Cada RPC pode ser SEGURADA (gate) ou falhar.
// `salvar_explosao` (RPC ÚNICA, usada pela tela): grava as 3 seções numa transação e devolve { cad_id, rev, deficit }; com
// `_enviar:true` também simula a baixa do corte (marca `enviado_corte` e devolve `CTL.deficit`). As 3 estreitas
// (`salvar_explosao_metragem` / `_aviamento_separar` / `_etiqueta_enviar`) seguem aqui só por compat (a tela não as chama mais).
import { FAKE } from "./fake-supabase";

export const CTL = {
  gates: {} as Record<string, { promessa: Promise<void>; soltar: () => void } | null>,
  falhas: {} as Record<string, { code?: string; message: string } | null>,
  /** O que a baixa do corte devolve em `deficit` quando `salvar_explosao` roda com `_enviar:true` (padrão: sem falta). */
  deficit: [] as Array<{ variante: string; deficit: number }>,
};
export function segurarRpc(nome: string) {
  let soltar!: () => void;
  const promessa = new Promise<void>((r) => { soltar = r; });
  CTL.gates[nome] = { promessa, soltar };
  return () => { CTL.gates[nome] = null; soltar(); };
}
export function resetCtl() { CTL.gates = {}; CTL.falhas = {}; CTL.deficit = []; }

/** numeric(10,2) do Postgres: meio para cima na notação decimal. */
export const numeric2 = (n: number) => Number(`${Math.round(Number(`${n}e2`))}e-2`);

export async function rpcExplosao(nome: string, args: any): Promise<{ data: any; error: any }> {
  if (!/^salvar_explosao(_|$)/.test(nome)) return FAKE.supabase.rpc(nome, args);
  FAKE.chamadas.push({ tabela: `rpc:${nome}`, op: "rpc", filtros: [], payload: args });
  const g = CTL.gates[nome];
  if (g) await g.promessa;
  const f = CTL.falhas[nome];
  if (f) return { data: null, error: f };
  const cad = (FAKE.linhas.cad ?? []).find((c) => c.id === args._cad_id);
  if (!cad) return { data: null, error: { message: "cad inexistente" } };
  if (args._rev_base != null && args._rev_base !== cad.rev) {
    return { data: null, error: { code: "P0409", message: "conflito_versao: cad" } };
  }
  const gravaMetragem = (itens: any[]) => {
    for (const item of itens) {
      for (const t of FAKE.linhas.cad_tecidos ?? []) {
        const v = (t.cad_tecido_variantes ?? []).find((x: any) => x.id === item.id);
        if (v) { v.metragem_enviada = numeric2(Number(item.metragem_enviada)); v.quantidade_folhas = Math.round(Number(item.quantidade_folhas)); }
      }
    }
  };
  const gravaAviamento = (linhas: any[]) => {
    for (const l of linhas) {
      const r = (FAKE.linhas.cad_aviamentos ?? []).find((x) => x.cad_id === cad.id && x.aviamento_id === l.aviamento_id && (x.variante_aviamento_id ?? null) === (l.variante_aviamento_id ?? null));
      if (r) r.quantidade_separar = numeric2(Number(l.quantidade_separar)); // linha do BOM sem cad_aviamentos: CONTINUE
    }
  };
  const gravaEtiqueta = (linhas: any[]) => {
    for (const l of linhas) {
      const r = (FAKE.linhas.cad_etiquetas ?? []).find((x) => x.id === l.id);
      if (r) r.quantidade_enviar = numeric2(Number(l.quantidade_enviar));
    }
  };
  let deficit: typeof CTL.deficit = [];
  if (nome === "salvar_explosao") {
    // RPC única: as 3 seções na MESMA transação (lista ausente/vazia = no-op da seção); `_enviar` baixa o corte na mesma txn.
    gravaMetragem((args._variantes as any[]) ?? []);
    gravaAviamento((args._aviamentos as any[]) ?? []);
    gravaEtiqueta((args._etiquetas as any[]) ?? []);
    if (args._enviar) { cad.enviado_corte = true; deficit = CTL.deficit; }
  } else if (nome === "salvar_explosao_metragem") gravaMetragem(args._variantes as any[]);
  else if (nome === "salvar_explosao_aviamento_separar") gravaAviamento(args._linhas as any[]);
  else if (nome === "salvar_explosao_etiqueta_enviar") gravaEtiqueta(args._linhas as any[]);
  cad.rev += 1; // 1 bump por transação (Backend B2)
  if (nome === "salvar_explosao") return { data: { cad_id: cad.id, rev: cad.rev, deficit }, error: null };
  return { data: cad.id, error: null };
}
