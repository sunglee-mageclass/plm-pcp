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
  // [label, valor, sempre]: "sempre" mostra mesmo vazio (—). Subcategoria só se houver.
  const campos: [string, unknown, boolean][] = [
    [fl("ref"), refText, true],
    ["Modelo", m?.nome ?? "—", true],
    ["Coleção", m?.colecao ?? "—", true],
    ["Linha", m?.linha?.nome ?? "—", true],
    ["Categoria", m?.cat_p?.nome ?? "—", true],
    ["Subcategoria", m?.cat_s?.nome, false],
    ["Estilista", m?.estilista?.nome ?? "—", true],
    ["Modelista", m?.modelista?.nome ?? "—", true],
    ["Piloteiro", m?.piloteiro?.nome ?? "—", true],
  ];
  const visiveis = campos.filter(([, v, sempre]) => sempre || (v != null && String(v).trim() !== ""));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #000", paddingBottom: 8, marginBottom: 10 }}>
      {logo && <img src={logo} alt="logo" style={{ height: 48, objectFit: "contain" }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{title}</h1>
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          {visiveis.map(([label, v], i) => (
            <span key={label}>
              {i > 0 ? " · " : ""}
              <span style={{ color: "#555" }}>{label}:</span> <b>{String(v)}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
