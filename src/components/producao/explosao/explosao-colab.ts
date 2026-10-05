// Merge colaborativo da Explosão (Fase 3) — peças PURAS, extraídas do ExplosaoDetail para serem testáveis (Camada
// intermediária C4 / R-02). Cada seção da tela é um "blob" grão-grosso comparado por valor pelo `mergeDraft`.
import { mergeDraft, type Conflito, type MergeResult } from "@/lib/colab/merge";
import type { TecidoRow } from "@/components/producao/cad/types";

export type MetragemBlob = Record<string, { metragem_enviada: number; quantidade_folhas: number }>;
export type ExplosaoColabBlob = {
  metragemBlob: MetragemBlob;
  aviBlob: Record<string, number>;
  etiBlob: Record<string, number>;
};

export function metragemBlobDeTecidos(tecidos: TecidoRow[]): MetragemBlob {
  const out: MetragemBlob = {};
  for (const t of tecidos) {
    for (const v of t.variantes) {
      if (!v.id) continue; // linha nova sem id (não deveria ocorrer aqui — tecidos vêm do CAD) — ignora
      out[v.id] = { metragem_enviada: Number(v.metragem_enviada) || 0, quantidade_folhas: Number(v.quantidade_folhas) || 0 };
    }
  }
  return out;
}

/** Foto do que o Salvar ENVIA (copiada na hora do envio — edições feitas durante o voo não entram). Vira o novo base 3-vias
 *  quando o save dá certo (R-02): o eco Realtime do PRÓPRIO save passa a ser igual ao base e cai no ramo no-op do merge. */
export function blobEnviadoExplosao(o: {
  tecidos: TecidoRow[];
  aviSeparar: Record<string, number>;
  etiEnviar: Record<string, number>;
}): ExplosaoColabBlob {
  return { metragemBlob: metragemBlobDeTecidos(o.tecidos), aviBlob: { ...o.aviSeparar }, etiBlob: { ...o.etiEnviar } };
}

export type AvisoMergeExplosao = "conflito" | "outra-pessoa" | null;

/** Merge 3-vias das 3 seções + qual aviso mostrar. Só avisa quando o `rev` do servidor mudou de fato. */
export function avaliarMergeExplosao(o: {
  base: ExplosaoColabBlob;
  draft: ExplosaoColabBlob;
  fresh: ExplosaoColabBlob;
  touched: ReadonlySet<string>;
  revMudou: boolean;
}): { m: MergeResult<ExplosaoColabBlob>; aviso: AvisoMergeExplosao } {
  const m = mergeDraft({ base: o.base, draft: o.draft, fresh: o.fresh, touched: o.touched });
  let aviso: AvisoMergeExplosao = null;
  if (m.conflitos.length > 0) aviso = o.revMudou ? "conflito" : null;
  else if (m.atualizados.length > 0 && o.revMudou) aviso = "outra-pessoa";
  return { m, aviso };
}

export type { Conflito };
