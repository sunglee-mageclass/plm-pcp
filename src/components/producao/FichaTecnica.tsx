import { useTenantLogo } from "@/hooks/useTenantLogo";
import { ModeloPhoto } from "@/components/producao/cad/shared";
import { MaterialTable, Etiquetas, Assinatura } from "@/components/producao/cad/CadFichaCorte";
import { cell, cellH } from "@/components/producao/cad/types";
import { fmtNum } from "@/lib/format";
import { useFichaData } from "@/components/producao/cad/useFichaData";

const fmt = (n: any) => fmtNum(n);
const fmtTam = (t: string | null) => {
  if (!t) return "Geral";
  const [num, sig] = t.split("|");
  return sig ? `${sig} · ${num}` : t;
};

/** Ficha Técnica (documento de impressão). Carrega os dados salvos do CAD do modelo. */
export function FichaTecnica({ modeloId }: { modeloId: string }) {
  const d = useFichaData(modeloId);
  const logo = useTenantLogo();
  const m: any = d.modelo;
  const foto = (m?.fotos_modelo as string[] | null)?.[0] ?? null;
  const isConjunto = (m?.cat_p?.nome ?? "").trim().toLowerCase() === "conjunto";
  const tecidoBlocks = d.tecidos.filter((t) => t.tipo === "tecido");
  const forroBlocks = d.tecidos.filter((t) => t.tipo === "forro");
  const entretelaBlocks = d.tecidos.filter((t) => t.tipo === "entretela");
  const gradeSumT = (t: string) => d.grades.reduce((s, g) => s + (Number((g.grades as any)?.[t]) || 0), 0);

  return (
    <div className="print-area">
      {/* Cabeçalho fixo */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #000", paddingBottom: 8, marginBottom: 10 }}>
        {logo && <img src={logo} alt="logo" style={{ height: 48, objectFit: "contain" }} />}
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>FICHA TÉCNICA</h1>
          <div style={{ fontSize: 12 }}>
            REF: <b>{m?.ref ?? "—"}</b> · {m?.nome ?? "—"} · {m?.colecao ?? "—"}
            {m?.linha?.nome ? ` · ${m.linha.nome}` : ""} · {m?.cat_p?.nome ?? "—"}
            {isConjunto && m?.cat_s?.nome ? ` / ${m.cat_s.nome}` : ""}
          </div>
        </div>
        <div style={{ fontSize: 12, textAlign: "right" }}>
          Data prevista<br />
          <span style={{ display: "inline-block", borderBottom: "1px solid #000", width: 130, height: 16 }} />
        </div>
      </div>

      {/* Foto do modelo + etiqueta(s) de lavagem */}
      <div className="print-section" style={{ display: "flex", gap: 16, marginBottom: 10 }}>
        <div style={{ width: 160, height: 200, border: "1px solid #999", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
          {foto ? <ModeloPhoto path={foto} alt={m?.nome ?? "modelo"} fit="contain" /> : <span style={{ fontSize: 11, color: "#999" }}>sem foto</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Etiquetas blocks={d.tecidos} />
        </div>
      </div>

      {/* Grade por variante */}
      <div className="print-section" style={{ marginTop: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Grade</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
          <thead>
            <tr style={{ background: "#eee" }}>
              <th style={cellH}>Variante</th>
              {d.tamanhosAll.map((t) => <th key={t} style={cellH}>{fmtTam(t)}</th>)}
              <th style={cellH}>Total</th>
            </tr>
          </thead>
          <tbody>
            {d.grades.map((g) => (
              <tr key={g.variante_numero}>
                <td style={cell}>{d.labelByNumero[g.variante_numero] ?? `Variante ${g.variante_numero}`}</td>
                {d.tamanhosAll.map((t) => <td key={t} style={cell}>{(g.grades as any)[t] ?? 0}</td>)}
                <td style={cell}>{g.grade_total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Consumo e metragem de tecido */}
      <div className="print-section" style={{ marginTop: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Tecido</h3>
        <MaterialTable blocks={tecidoBlocks} colMaterial="Tecido" />
        {forroBlocks.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 0" }}>Forro</h3>
            <MaterialTable blocks={forroBlocks} colMaterial="Forro" />
          </>
        )}
        {entretelaBlocks.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 0" }}>Entretela</h3>
            <MaterialTable blocks={entretelaBlocks} colMaterial="Entretela" />
          </>
        )}
      </div>

      {/* Explosão de aviamentos */}
      <div className="print-section" style={{ marginTop: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Explosão de Aviamentos</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
          <thead>
            <tr style={{ background: "#eee" }}>
              <th style={cellH}>Aviamento</th>
              <th style={cellH}>Consumo</th>
              <th style={cellH}>Quantidade Planejada</th>
              <th style={cellH}>Quantidade a Enviar</th>
            </tr>
          </thead>
          <tbody>
            {d.aviamentos.length === 0 ? (
              <tr><td style={cell} colSpan={4}>—</td></tr>
            ) : d.aviamentos.map((a, i) => (
              <tr key={i}>
                <td style={cell}>{a.aviamento_nome ?? "—"}</td>
                <td style={cell}>{fmt(a.consumo)}</td>
                <td style={cell}>{fmt(a.quantidade_enviar)}</td>
                <td style={cell}>{fmt(a.quantidade_separar)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Explosão de TAG/Etiquetas */}
      {d.etiquetas.length > 0 && (
        <div className="print-section" style={{ marginTop: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>TAG/Etiquetas</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={cellH}>Etiqueta</th>
                <th style={cellH}>Tamanho</th>
                <th style={cellH}>Consumo</th>
                <th style={cellH}>Quantidade Planejada</th>
                <th style={cellH}>Quantidade a Enviar</th>
              </tr>
            </thead>
            <tbody>
              {d.etiquetas.map((e, i) => {
                const base = e.tamanho ? gradeSumT(e.tamanho) : d.gradeTotalGeral;
                return (
                  <tr key={i}>
                    <td style={cell}>{e.etiqueta_nome ?? "—"}</td>
                    <td style={cell}>{fmtTam(e.tamanho)}</td>
                    <td style={cell}>{fmt(e.consumo)}</td>
                    <td style={cell}>{fmt(e.consumo * base)}</td>
                    <td style={cell}>{fmt(e.quantidade_enviar)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Observações (última tabela) */}
      <div className="print-section" style={{ marginTop: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>Observações</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: "#eee" }}>
              <th style={{ ...cellH, width: "28%" }}>Descrição</th>
              <th style={cellH}>Observação</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>Composição</td>
              <td style={{ ...cell, whiteSpace: "pre-wrap" }}>{d.composicao || "—"}</td>
            </tr>
            {d.observacoes.map((o) => (
              <tr key={o.id}>
                <td style={cell}>{o.descricao || "—"}</td>
                <td style={{ ...cell, whiteSpace: "pre-wrap" }}>{o.observacao || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Assinatura />
    </div>
  );
}
