// Integração — API: parâmetros da consulta (spec §7). Inválido ⇒ null ⇒ 400 SEM tocar no banco. O teto real do `limite` é
// o max_por_pagina da loja (o banco aplica least()); aqui só formato. Cursor = base64 (D21), até 200 caracteres.
export type Parametros = { modo: "normal" | "teste"; incluir: boolean; limite: number | null; cursor: string | null };

export function lerParametros(url: URL): Parametros | null {
  const sp = url.searchParams;
  const modo = sp.get("modo") ?? "normal";
  if (modo !== "normal" && modo !== "teste") return null;
  const inc = sp.get("incluir_integrados") ?? "0";
  if (!["0", "1", "false", "true"].includes(inc)) return null;
  const lim = sp.get("limite");
  let limite: number | null = null;
  if (lim !== null && lim !== "") {
    if (!/^\d{1,3}$/.test(lim) || Number(lim) < 1) return null;
    limite = Number(lim);
  }
  const cur = sp.get("cursor");
  if (cur !== null && cur !== "" && (cur.length > 200 || !/^[A-Za-z0-9+/=_-]+$/.test(cur))) return null;
  return { modo, incluir: inc === "1" || inc === "true", limite, cursor: cur ? cur : null };
}
