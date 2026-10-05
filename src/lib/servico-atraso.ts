// [urg R5] Alertas de atraso de serviço e da peça de foto — PURO (sem React).
// `hojeISO` = todayISOInStoreTZ(useStoreTimezone()) (fuso da loja). Mesma regra do OcPrazoBadge: "Vence hoje" no DIA da data
// prevista e "Atrasado N dias" a partir do DIA SEGUINTE (differenceInCalendarDays + parseISO). Não há "Faltam N dias" (Ruling 13).
import { differenceInCalendarDays, parseISO } from "date-fns";
import { isServicoPL } from "@/lib/servico-confeccao";

export type Atraso = { estado: "vence_hoje" | "atrasado"; dias: number } | null; // null = no prazo / sem previsão / entregue

/** entregue preenchida ou prevista vazia → null; prevista > hoje → null; = hoje → vence_hoje; < hoje → atrasado (hoje − prevista). */
export function atrasoPorData(
  prevista: string | null | undefined,
  entregue: string | null | undefined,
  hojeISO: string,
): Atraso {
  if (entregue || !prevista) return null;
  const dif = differenceInCalendarDays(parseISO(hojeISO), parseISO(prevista));
  if (Number.isNaN(dif) || dif < 0) return null;
  if (dif === 0) return { estado: "vence_hoje", dias: 0 };
  return { estado: "atrasado", dias: dif };
}

/** Bloco ausente/parcial (card sem prazos, select antigo) = sem alerta: o quadro nunca pode quebrar por causa do selo. */
export function atrasoServico(
  b: { data_prevista?: string | null; data_entregue?: string | null } | null | undefined,
  hojeISO: string,
): Atraso {
  if (!b) return null;
  return atrasoPorData(b.data_prevista, b.data_entregue, hojeISO);
}

/** Só com `peca_foto = true`; previsão = `peca_foto_previsao`; entregue = `peca_foto_data`. */
export function atrasoPecaFoto(
  b:
    | {
        peca_foto?: boolean | null;
        peca_foto_previsao?: string | null;
        peca_foto_data?: string | null;
      }
    | null
    | undefined,
  hojeISO: string,
): Atraso {
  if (!b || !b.peca_foto) return null;
  return atrasoPorData(b.peca_foto_previsao, b.peca_foto_data, hojeISO);
}

/** atrasado de mais dias > vence_hoje > null. */
export function piorAtraso(lista: readonly Atraso[]): Atraso {
  let pior: Atraso = null;
  for (const a of lista) {
    if (!a) continue;
    if (!pior) pior = a;
    else if (a.estado === "atrasado" && (pior.estado === "vence_hoje" || a.dias > pior.dias))
      pior = a;
  }
  return pior;
}

export function textoAtraso(a: NonNullable<Atraso>, tipo: "servico" | "peca_foto"): string {
  if (a.estado === "vence_hoje")
    return tipo === "servico" ? "Vence hoje" : "Peça de foto vence hoje";
  const dias = `${a.dias} dia${a.dias > 1 ? "s" : ""}`;
  return tipo === "servico" ? `Atrasado ${dias}` : `Peça de foto atrasada ${dias}`;
}

/** Bloco como a lista do PCP o lê (linha de `producao_terceirizados` ativa + nome da categoria). Campos ausentes = vazio. */
export type BlocoAtrasoLista = {
  interno?: boolean | null;
  nome?: string | null;
  data_prevista?: string | null;
  data_entregue?: string | null;
  peca_foto?: boolean | null;
  peca_foto_previsao?: string | null;
  peca_foto_data?: string | null;
};

export type TipoAtraso = "servico" | "peca_foto";

/**
 * Lista do PCP › Serviços: PIOR atraso do produto entre [serviço de cada bloco ativo] + [peça de foto dos blocos PL externos, só com
 * o módulo `etapas_pl`]. `tipo` = de qual dos dois é o vencedor (o badge diz o que está atrasado; empate: o primeiro listado).
 * `detalhes` = uma frase por atraso ("Costura — Atrasado 2 dias"), para o `title` do badge. Lista/bloco ausente = sem alerta.
 */
export function atrasosDoProduto(
  blocos: readonly (BlocoAtrasoLista | null | undefined)[] | null | undefined,
  hojeISO: string,
  comEtapasPl: boolean,
): { pior: Atraso; tipo: TipoAtraso | null; detalhes: string[] } {
  const achados: { a: NonNullable<Atraso>; tipo: TipoAtraso }[] = [];
  const detalhes: string[] = [];
  for (const b of blocos ?? []) {
    if (!b) continue;
    const nome = b.nome || "Serviço";
    const s = atrasoServico(b, hojeISO);
    if (s) {
      achados.push({ a: s, tipo: "servico" });
      detalhes.push(`${nome} — ${textoAtraso(s, "servico")}`);
    }
    if (comEtapasPl && !b.interno && isServicoPL(nome)) {
      const p = atrasoPecaFoto(b, hojeISO);
      if (p) {
        achados.push({ a: p, tipo: "peca_foto" });
        detalhes.push(`${nome} — ${textoAtraso(p, "peca_foto")}`);
      }
    }
  }
  const pior = piorAtraso(achados.map((x) => x.a));
  const tipo = achados.find((x) => x.a === pior)?.tipo ?? null;
  return { pior, tipo, detalhes };
}
