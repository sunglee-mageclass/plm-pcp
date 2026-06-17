/**
 * Cabeçalho padrão das fichas de impressão (Ficha Técnica e Ficha de Corte):
 * logo da loja + título + linha com REF/nome/coleção/linha/categoria + "Data
 * prevista" em branco para preenchimento manual.
 */
export function FichaHeader({ title, modelo, logo }: { title: string; modelo: any; logo?: string | null }) {
  const m = modelo ?? {};
  const isConjunto = (m?.cat_p?.nome ?? "").trim().toLowerCase() === "conjunto";
  const versao = Number(m?.versao ?? 1);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #000", paddingBottom: 8, marginBottom: 10 }}>
      {logo && <img src={logo} alt="logo" style={{ height: 48, objectFit: "contain" }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{title}</h1>
        <div style={{ fontSize: 12 }}>
          REF: <b>{m?.ref ?? "—"}</b>{versao > 1 ? ` ↻ v${versao}` : ""} · {m?.nome ?? "—"} · {m?.colecao ?? "—"}
          {m?.linha?.nome ? ` · ${m.linha.nome}` : ""} · {m?.cat_p?.nome ?? "—"}
          {isConjunto && m?.cat_s?.nome ? ` / ${m.cat_s.nome}` : ""}
        </div>
      </div>
      <div style={{ fontSize: 12, textAlign: "right" }}>
        Data prevista<br />
        <span style={{ display: "inline-block", borderBottom: "1px solid #000", width: 130, height: 16 }} />
      </div>
    </div>
  );
}
