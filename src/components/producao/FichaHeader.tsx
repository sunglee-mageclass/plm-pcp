/**
 * Cabeçalho padrão das fichas de impressão (Ficha Técnica e Ficha de Corte):
 * logo da loja + título + campos ROTULADOS minimalistas, inline. Campos: REF,
 * Modelo, Coleção, Linha, Categoria, Subcategoria (só se houver), Estilista,
 * Modelista e Piloteiro. (A "Data Prevista" não fica no cabeçalho — na Ficha
 * Técnica vai no rodapé de assinatura; na Ficha de Corte não é usada.)
 */
import { useFieldLabels } from "@/hooks/useFieldLabels";

export function FichaHeader({ title, modelo, logo }: { title: string; modelo: any; logo?: string | null }) {
  const fl = useFieldLabels();
  const m = modelo ?? {};
  const versao = Number(m?.versao ?? 1);
  const refText = `${m?.ref ?? "—"}${versao > 1 ? ` ↻ v${versao}` : ""}`;
  // 3 linhas abaixo do título. [label, valor, sempre]: "sempre" mostra mesmo vazio (—);
  // Grupo/Subcategorias só aparecem se houver.
  const linha1: [string, unknown, boolean][] = [
    [fl("ref"), refText, true],
    ["Modelo", m?.nome ?? "—", true],
    ["Coleção", m?.colecao ?? "—", true],
    ["Linha", m?.linha?.nome ?? "—", true],
  ];
  const linha2: [string, unknown, boolean][] = [
    ["Grupo", m?.cat_p?.grupo?.nome, false],
    ["Categoria", m?.cat_p?.nome ?? "—", true],
    ["Subcategoria 1", m?.sub1?.nome, false],
    ["Subcategoria 2", m?.sub2?.nome, false],
  ];
  const linha3: [string, unknown, boolean][] = [
    ["Estilista", m?.estilista?.nome ?? "—", true],
    ["Modelista", m?.modelista?.nome ?? "—", true],
    ["Piloteiro", m?.piloteiro?.nome ?? "—", true],
  ];
  const linha = (campos: [string, unknown, boolean][]) => {
    const vis = campos.filter(([, v, sempre]) => sempre || (v != null && String(v).trim() !== ""));
    if (vis.length === 0) return null;
    return vis.map(([label, v], i) => (
      <span key={label}>
        {i > 0 ? " · " : ""}
        <span style={{ color: "#555" }}>{label}:</span> <b>{String(v)}</b>
      </span>
    ));
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 8 }}>
      {logo && <img src={logo} alt="logo" style={{ height: 44, objectFit: "contain" }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 2px" }}>{title}</h1>
        <div style={{ fontSize: 11, lineHeight: 1.45 }}>{linha(linha1)}</div>
        <div style={{ fontSize: 11, lineHeight: 1.45 }}>{linha(linha2)}</div>
        <div style={{ fontSize: 11, lineHeight: 1.45 }}>{linha(linha3)}</div>
      </div>
    </div>
  );
}
