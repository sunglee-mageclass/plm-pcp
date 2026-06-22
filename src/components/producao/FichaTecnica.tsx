import { useTenantLogo } from "@/hooks/useTenantLogo";
import { FichaHeader } from "@/components/producao/FichaHeader";
import { ModeloPhotoPrint } from "@/components/producao/cad/shared";
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
  const fotos = (m?.fotos_modelo as string[] | null) ?? [];
  const tecidoBlocks = d.tecidos.filter((t) => t.tipo === "tecido");
  const forroBlocks = d.tecidos.filter((t) => t.tipo === "forro");
  const entretelaBlocks = d.tecidos.filter((t) => t.tipo === "entretela");
  const gradeSumT = (t: string) => d.grades.reduce((s, g) => s + (Number((g.grades as any)?.[t]) || 0), 0);

  return (
    <div className="print-area">
      <FichaHeader title="FICHA TÉCNICA" modelo={m} logo={logo} />

      {/* Fotos do modelo (todas, lado a lado, respeitando a proporção) + etiqueta(s) */}
      <div className="print-section" style={{ display: "flex", gap: 16, marginBottom: 10, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0, maxWidth: "62%" }}>
          {fotos.length
            ? fotos.map((p, i) => <ModeloPhotoPrint key={i} path={p} />)
            : <span style={{ fontSize: 11, color: "#999" }}>sem foto</span>}
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
        <MaterialTable blocks={tecidoBlocks} colMaterial="Tecido" ocLinksByKey={d.ocLinksByKey} />
        {forroBlocks.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 0" }}>Forro</h3>
            <MaterialTable blocks={forroBlocks} colMaterial="Forro" ocLinksByKey={d.ocLinksByKey} />
          </>
        )}
        {entretelaBlocks.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 0" }}>Entretela</h3>
            <MaterialTable blocks={entretelaBlocks} colMaterial="Entretela" ocLinksByKey={d.ocLinksByKey} />
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
              <tr><td style={cell} colSpan={4}></td></tr>
            ) : d.aviamentos.map((a, i) => (
              <tr key={i}>
                <td style={cell}>{a.aviamento_nome ?? ""}</td>
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
                    <td style={cell}>{e.etiqueta_nome ?? ""}</td>
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
              <td style={{ ...cell, whiteSpace: "pre-wrap" }}>{d.composicao || ""}</td>
            </tr>
            {d.observacoes.map((o) => (
              <tr key={o.id}>
                <td style={cell}>{o.descricao || ""}</td>
                <td style={{ ...cell, whiteSpace: "pre-wrap" }}>{o.observacao || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Assinatura dataPrevista />
    </div>
  );
}
