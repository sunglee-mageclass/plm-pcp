// Integração — API: parâmetros da consulta (spec §7). Inválido ⇒ null ⇒ 400 SEM tocar no banco. O teto real do `limite` é
// o max_por_pagina da loja (o banco aplica least()); aqui só formato. Cursor = base64 (D21), até 200 caracteres.
// Fix round 1 (I3 ruling): qualquer parâmetro fora dos 4 conhecidos, ou repetido, invalida a requisição inteira — evita
// que um `modo` com typo (ex. `Modo=teste` ou `modo=teste&modo=xpto`) rode silenciosamente em modo normal (que CONFIRMA
// produtos de verdade). m5 (ruling): valor vazio conta como parâmetro ausente, para os 4 — regra única, sem exceção.
export type Parametros = { modo: "normal" | "teste"; incluir: boolean; limite: number | null; cursor: string | null };

const PERMITIDOS = new Set(["modo", "incluir_integrados", "limite", "cursor"]);

export function lerParametros(url: URL): Parametros | null {
  const sp = url.searchParams;
  for (const k of new Set(sp.keys())) {
    if (!PERMITIDOS.has(k) || sp.getAll(k).length > 1) return null;
  }
  const modo = sp.get("modo") || "normal";
  if (modo !== "normal" && modo !== "teste") return null;
  const inc = sp.get("incluir_integrados") || "0";
  if (!["0", "1", "false", "true"].includes(inc)) return null;
  const lim = sp.get("limite") || null;
  let limite: number | null = null;
  if (lim !== null) {
    if (!/^\d{1,3}$/.test(lim) || Number(lim) < 1) return null;
    limite = Number(lim);
  }
  const cur = sp.get("cursor") || null;
  if (cur !== null && (cur.length > 200 || !/^[A-Za-z0-9+/=_-]+$/.test(cur))) return null;
  return { modo, incluir: inc === "1" || inc === "true", limite, cursor: cur };
}
