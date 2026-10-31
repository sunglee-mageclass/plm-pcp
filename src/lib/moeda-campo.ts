// [urg R13 #17, Onda 2] Moeda POR CAMPO de valor da OC de Produto Importado — SÓ REGISTRO/EXIBIÇÃO.
//
// Cada campo de valor do item (valor unitário, transporte) mostra um seletor de moeda: a pessoa diz "este número está em X". Isso é RÓTULO:
// NÃO muda a cotação aplicada nem a conta (`m1ParaM2`/`m2ParaBrl`/landed em `src/lib/moeda.ts` e no servidor seguem as cotações digitadas
// no cabeçalho/etapas). Nada aqui converte valor. O landed do item é derivado no servidor em BRL e por isso NÃO tem seletor (um rótulo
// diferente de BRL mentiria); ele só entra aqui para o "padrão do slot" (BRL) ser a mesma fonte para tela/teste.
//
// Padrão de cada campo (ordem): (1) o que a pessoa escolheu NESTE item; (2) para item NOVO, o ÚLTIMO que ela escolheu naquele campo
// (convenção leve: localStorage por campo, per-viewer, com try/catch — não é dado de negócio, não vai ao servidor); (3) a moeda do SLOT
// pelo cabeçalho da OC. Item já salvo sem escolha cai no (3): o último usado NÃO reescreve o rótulo de dado antigo.
import { STORAGE_PREFIX } from "@/lib/storage-prefix-migration";

/** Campos de valor da OC de Importado que têm moeda própria. `landed` é só o slot BRL (derivado no servidor; sem seletor). */
export type CampoMoeda = "valor_unitario" | "transporte" | "landed";
/** Campos que o item guarda/permite escolher (o landed não). */
export type CampoMoedaEditavel = Exclude<CampoMoeda, "landed">;
export const CAMPOS_MOEDA_EDITAVEIS: ReadonlyArray<CampoMoedaEditavel> = ["valor_unitario", "transporte"];

/** O que o item guarda (SÓ UI: nunca vai ao Salvar nem entra no merge das linhas). Chave ausente = sem escolha. */
export type MoedasCampos = Partial<Record<CampoMoedaEditavel, string>>;

/** A moeda da OC (cabeçalho) de onde o slot de cada campo sai. */
export type MoedasOc = { moedaCompra: string; moedaIntermediaria: string | null };

const COD_VALIDO = /^[A-Z0-9]{2,6}$/;
const norm = (c: string | null | undefined): string => (c ?? "").trim().toUpperCase();
const chave = (campo: CampoMoedaEditavel) => `${STORAGE_PREFIX}oc-imp:moeda-ultima:${campo}`;

/** Moeda do SLOT pelo cabeçalho: valor unit. → moeda de compra (M1); transporte → intermediária (M2) ou a de compra se direta; landed → BRL. */
export function moedaPadraoDoSlot(campo: CampoMoeda, oc: MoedasOc): string {
  if (campo === "landed") return "BRL";
  if (campo === "transporte") return norm(oc.moedaIntermediaria) || norm(oc.moedaCompra);
  return norm(oc.moedaCompra);
}

/** Último código escolhido neste campo (neste navegador). `null` = nunca escolheu / storage indisponível / valor inválido. */
export function lerUltimaMoeda(campo: CampoMoedaEditavel): string | null {
  try {
    const v = norm(window.localStorage.getItem(chave(campo)));
    return COD_VALIDO.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Lembra o último código escolhido no campo. Código incompleto (digitando a moeda livre) e storage indisponível são ignorados em silêncio. */
export function gravarUltimaMoeda(campo: CampoMoedaEditavel, code: string | null | undefined): void {
  const v = norm(code);
  if (!COD_VALIDO.test(v)) return;
  try {
    window.localStorage.setItem(chave(campo), v);
  } catch {
    /* quota/modo privado: é conveniência por pessoa — segue sem lembrar */
  }
}

/** Moeda exibida de um campo: a escolhida no item (se houver código), senão o slot do cabeçalho. Só rótulo — nenhuma conversão. */
export function moedaEfetiva(escolhida: string | null | undefined, campo: CampoMoeda, oc: MoedasOc): string {
  return norm(escolhida) || moedaPadraoDoSlot(campo, oc);
}

/** Moeda efetiva do campo de um item (atalho para `moedaEfetiva(item.moedas?.[campo], …)`). */
export function moedaDoItem(item: { moedas?: MoedasCampos }, campo: CampoMoedaEditavel, oc: MoedasOc): string {
  return moedaEfetiva(item.moedas?.[campo], campo, oc);
}

/**
 * As escolhas iniciais de um item NOVO: para cada campo em que a pessoa já escolheu alguma vez, o ÚLTIMO usado vira o padrão (pode trocar
 * por cima). Campo sem histórico fica sem chave → segue o slot do cabeçalho (inclusive se o cabeçalho mudar depois).
 */
export function moedasParaItemNovo(): MoedasCampos {
  const out: MoedasCampos = {};
  for (const campo of CAMPOS_MOEDA_EDITAVEIS) {
    const u = lerUltimaMoeda(campo);
    if (u) out[campo] = u;
  }
  return out;
}

/**
 * Moeda do TOTAL da OC (soma de itens): se todos os itens mostram o valor unitário na MESMA moeda, é ela; se divergem (rótulos
 * diferentes entre produtos), a soma fica na moeda do cabeçalho — somar rótulos diferentes sem converter não tem moeda própria.
 * Sem itens: a do cabeçalho.
 */
export function moedaDoTotalDaOc(itens: ReadonlyArray<{ moedas?: MoedasCampos }>, oc: MoedasOc): string {
  const cab = moedaPadraoDoSlot("valor_unitario", oc);
  if (itens.length === 0) return cab;
  const todas = new Set(itens.map((i) => moedaDoItem(i, "valor_unitario", oc)));
  return todas.size === 1 ? [...todas][0] : cab;
}
