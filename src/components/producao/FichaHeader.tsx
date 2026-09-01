/**
 * Cabeçalho padrão das fichas de impressão (Ficha Técnica e Ficha de Corte):
 * FAIXA DE MARCA da loja (logo + nome/CNPJ/contato — casca padronizada, igual aos demais
 * printáveis) + título + campos ROTULADOS minimalistas, inline. Campos: REF, Modelo, Coleção,
 * Linha, Categoria, Subcategoria (só se houver), Estilista, Modelista e Piloteiro. (A "Data
 * Prevista" não fica no cabeçalho — na Ficha Técnica vai no rodapé de assinatura; na Ficha de
 * Corte não é usada.) A marca vem do `useTenantBranding` (nome/CNPJ/contato); o `logo` continua
 * aceito por prop p/ compatibilidade (as fichas já passam o `useTenantLogo`), mas se ausente
 * cai no logo da marca.
 */
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useTenantBranding } from "@/hooks/useTenantBranding";

export function FichaHeader({ title, modelo, logo }: { title: string; modelo: any; logo?: string | null }) {
  const fl = useFieldLabels();
  const loja = useTenantBranding();
  const logoSrc = logo ?? loja.logoUrl;
  const nomeLoja = loja.nome ?? "WISH360";
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
    <div style={{ fontFamily: "Helvetica, Arial, sans-serif", color: "#1a1a1a", marginBottom: 8 }}>
      {/* Faixa de marca (casca padronizada): logo + nome/CNPJ/contato. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        {logoSrc && <img src={logoSrc} alt="" style={{ maxHeight: 38, maxWidth: 96, objectFit: "contain" }} />}
        <div style={{ fontSize: 12, color: "#444" }}>
          <b style={{ color: "#1a1a1a" }}>{nomeLoja}</b>{loja.cnpj ? ` · CNPJ ${loja.cnpj}` : ""}{loja.contato ? ` · ${loja.contato}` : ""}
        </div>
      </div>
      {/* Título + campos identitários da ficha (miolo — inalterado). */}
      <div style={{ borderBottom: "2px solid #000", paddingBottom: 6 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 2px", textTransform: "uppercase", letterSpacing: 0.3 }}>{title}</h1>
        <div style={{ fontSize: 11, lineHeight: 1.45 }}>{linha(linha1)}</div>
        <div style={{ fontSize: 11, lineHeight: 1.45 }}>{linha(linha2)}</div>
        <div style={{ fontSize: 11, lineHeight: 1.45 }}>{linha(linha3)}</div>
      </div>
    </div>
  );
}
