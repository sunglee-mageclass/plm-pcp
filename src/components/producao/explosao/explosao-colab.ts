// Merge colaborativo da Explosão (Fase 3) — peças PURAS, extraídas do ExplosaoDetail para serem testáveis (Camada
// intermediária C4 / R-02). Cada seção da tela é um "blob" grão-grosso comparado por valor pelo `mergeDraft`.
import { mergeDraft, type MergeResult } from "@/lib/colab/merge";
import { calcCusto, type TecidoRow } from "@/components/producao/cad/types";
import { chaveVarianteAviamento } from "@/lib/explosao-aviamentos";

export type MetragemBlob = Record<string, { metragem_enviada: number; quantidade_folhas: number }>;
export type ExplosaoColabBlob = {
  metragemBlob: MetragemBlob;
  aviBlob: Record<string, number>;
  etiBlob: Record<string, number>;
};

/** Arredonda para a escala `numeric(10,2)` do banco (metragem_enviada, quantidade_separar, quantidade_enviar), meio para
 *  cima como o `numeric` do Postgres (12,345 -> 12,35). Vai pela notação decimal ("12.345e2") para não cair no erro de
 *  ponto flutuante de `Math.round(12.345 * 100)`. Sem isso o que o usuário digitou (12,345) difere do que o servidor devolve
 *  (12,35) e parece "mudança de outra pessoa" (R-02 / I2). */
export function escala2(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const s = String(x);
  if (/e/i.test(s)) return Math.round(x * 100) / 100;
  return Number(`${Math.round(Number(`${s}e2`))}e-2`);
}

export function metragemBlobDeTecidos(tecidos: TecidoRow[]): MetragemBlob {
  const out: MetragemBlob = {};
  for (const t of tecidos) {
    for (const v of t.variantes) {
      if (!v.id) continue; // linha nova sem id (não deveria ocorrer aqui — tecidos vêm do CAD) — ignora
      // quantidade_folhas é `integer` no banco (cast numeric->int arredonda); metragem_enviada é numeric(10,2).
      out[v.id] = { metragem_enviada: escala2(v.metragem_enviada), quantidade_folhas: Math.round(Number(v.quantidade_folhas) || 0) };
    }
  }
  return out;
}

/** Mapa de quantidades na escala do banco (numeric(10,2)). */
export function mapaEscala2(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(m)) out[k] = escala2(m[k]);
  return out;
}

/** Árvore de tecidos (TecidoRow[]) a partir das linhas cruas de `cad_tecidos` — a MESMA leitura do seed, usada no merge. */
export function arvoreTecidosDoCad(cadTecidos: any[]): TecidoRow[] {
  return cadTecidos.map((t) => ({
    id: t.id,
    numero: t.numero,
    tipo: t.tipo,
    artigo_id: t.artigo_id,
    consumo_cad: Number(t.consumo_cad ?? 0),
    loss_percent_cad: Number(t.loss_percent_cad ?? 0),
    custo_cad: calcCusto(Number(t.consumo_cad ?? 0), Number(t.loss_percent_cad ?? 0), Number(t.artigos?.preco_por_metro ?? 0)),
    tamanho_folha: Number(t.tamanho_folha ?? 0),
    preco: Number(t.artigos?.preco_por_metro ?? 0),
    largura: Number(t.artigos?.largura_estimada ?? 0),
    artigo_nome: t.artigos?.nome ? (t.artigos?.unidade_medida ? `${t.artigos.nome} [${t.artigos.unidade_medida}]` : t.artigos.nome) : null,
    etiqueta_lavagem_urls: (t.artigos?.etiqueta_lavagem_urls ?? []) as string[],
    variantes: (t.cad_tecido_variantes ?? []).map((v: any) => ({
      id: v.id,
      variante_tecido_id: v.variante_tecido_id,
      variante_nome: v.variantes_tecido?.nome_variante ?? v.variantes_tecido?.codigo_variante,
      variante_cor: v.variantes_tecido?.cor?.nome ?? null,
      variante_apelido: v.variantes_tecido?.apelido?.nome ?? null,
      multiplicador: Number(v.multiplicador ?? 1) || 1,
      ordem: v.ordem,
      quantidade_folhas: Number(v.quantidade_folhas ?? 0),
      metragem_planejada: Number(v.metragem_planejada ?? 0),
      metragem_enviada: Number(v.metragem_enviada ?? 0),
      complementa_variante_ids: v.complementa_variante_ids ?? null,
    })),
  }));
}

/** Blob do que o SERVIDOR tem (relido das 3 queries do CAD), na escala do banco. */
export function blobDoServidorExplosao(o: {
  tecidos: TecidoRow[];
  cadAviamentos: any[];
  cadEtiquetas: any[];
}): ExplosaoColabBlob {
  const aviBlob: Record<string, number> = {};
  for (const c of o.cadAviamentos) {
    const k = chaveVarianteAviamento(c.aviamento_id, c.variante_aviamento_id ?? null);
    aviBlob[k] = (aviBlob[k] ?? 0) + Number(c.quantidade_separar ?? 0);
  }
  const etiBlob: Record<string, number> = {};
  for (const e of o.cadEtiquetas) etiBlob[e.id] = Number(e.quantidade_enviar ?? 0);
  return { metragemBlob: metragemBlobDeTecidos(o.tecidos), aviBlob: mapaEscala2(aviBlob), etiBlob: mapaEscala2(etiBlob) };
}

/** Blob do que a TELA tem (rascunho), na escala do banco. */
export function blobDaTelaExplosao(o: {
  tecidos: TecidoRow[];
  aviSeparar: Record<string, number>;
  etiEnviar: Record<string, number>;
}): ExplosaoColabBlob {
  return { metragemBlob: metragemBlobDeTecidos(o.tecidos), aviBlob: mapaEscala2(o.aviSeparar), etiBlob: mapaEscala2(o.etiEnviar) };
}

/** Só as chaves que EXISTEM no servidor (M1): linha do BOM sem `cad_aviamentos` correspondente não é gravada pela RPC
 *  (`CONTINUE`), logo nunca volta no refetch — comparar essa chave daria "mudou" a cada Salvar. */
function soChavesDe<T>(m: Record<string, T>, ref: Record<string, unknown>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(m)) if (k in ref) out[k] = m[k];
  return out;
}
function restringir(b: ExplosaoColabBlob, fresh: ExplosaoColabBlob): ExplosaoColabBlob {
  return {
    metragemBlob: soChavesDe(b.metragemBlob, fresh.metragemBlob),
    aviBlob: soChavesDe(b.aviBlob, fresh.aviBlob),
    etiBlob: soChavesDe(b.etiBlob, fresh.etiBlob),
  };
}

export type AvisoMergeExplosao = "conflito" | "outra-pessoa" | null;

/** Merge 3-vias das 3 seções + qual aviso mostrar. Só avisa quando o `rev` do servidor mudou de fato. Compara só as chaves
 *  que existem no servidor (M1). */
export function avaliarMergeExplosao(o: {
  base: ExplosaoColabBlob;
  draft: ExplosaoColabBlob;
  fresh: ExplosaoColabBlob;
  touched: ReadonlySet<string>;
  revMudou: boolean;
}): { m: MergeResult<ExplosaoColabBlob>; aviso: AvisoMergeExplosao } {
  const m = mergeDraft({
    base: restringir(o.base, o.fresh),
    draft: restringir(o.draft, o.fresh),
    fresh: o.fresh,
    touched: o.touched,
  });
  let aviso: AvisoMergeExplosao = null;
  if (m.conflitos.length > 0) aviso = o.revMudou ? "conflito" : null;
  else if (m.atualizados.length > 0 && o.revMudou) aviso = "outra-pessoa";
  return { m, aviso };
}
