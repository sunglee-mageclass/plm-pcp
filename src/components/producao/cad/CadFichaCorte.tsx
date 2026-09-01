import { cell, cellH } from "./types";
import { varianteLabel } from "@/lib/variante";
import type { AviamentoRow, EtiquetaRow, GradeRow, TecidoRow } from "./types";
import { EtiquetaLavagemArtigoPrint } from "@/components/shared/EtiquetaLavagemArtigo";
import { FichaHeader } from "@/components/producao/FichaHeader";
import { useTenantLogo } from "@/hooks/useTenantLogo";
import { useFichaData } from "./useFichaData";
import { fmtNum } from "@/lib/format";
import { PrintArea } from "@/components/shared/PrintArea";

type Props = {
  modelo: any;
  cadRow?: any;
  previsaoEntrega?: string;
  observacoesMolde?: string;
  tecidos: TecidoRow[];
  grades: GradeRow[];
  tamanhosAll: string[];
  aviamentos: AviamentoRow[];
  etiquetas?: EtiquetaRow[];
  gradeTotalGeral?: number;
  labelByNumero?: Record<number, string>;
  ocLinksByKey?: Record<string, string[]>;
  tecido1LabelById?: Map<string, string>;
};

// Quebra NATURAL: cada seção evita ser cortada no meio e pagina quando não cabe.
// (Antes era flex 0 0 50% + overflow:hidden, que cortava modelos grandes em
// silêncio e desperdiçava espaço quando havia pouco conteúdo.)
// A folha é uma TABELA com 2 linhas de ~meia folha A4 (132mm). Altura de linha de
// tabela é a forma mais confiável de impor altura no print (engines respeitam
// table-row height onde height de div às vezes falha). vertical-align:top = o
// conteúdo começa no topo de cada meia folha; a linha cresce se o conteúdo passar.
// A folha = tabela com 2 linhas de ~meia folha A4 (130mm) → 2 tipos por folha.
// (Importante imprimir com ESCALA 100%/Padrão, não 50% — senão tudo encolhe.)
const pageTableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse" };
const meiaRow: React.CSSProperties = { height: "130mm" };
const meiaCell: React.CSSProperties = { verticalAlign: "top", padding: 0 };
const meiaCellBaixo: React.CSSProperties = { verticalAlign: "top", borderTop: "1px dashed #999", paddingTop: "10px" };
const fmt2 = (n: number | null | undefined) => fmtNum(n);

export function Assinatura({ dataPrevista = false }: { dataPrevista?: boolean }) {
  // Ficha Técnica inclui "Data Prevista" entre Data e Assinatura; Ficha de Corte não.
  const labels = dataPrevista ? ["Nome", "Data", "Data Prevista", "Assinatura"] : ["Nome", "Data", "Assinatura"];
  // .doc-pe (styles.css @media print): a assinatura nunca parte no meio E não cai sozinha numa
  // folha nova — se não couber, desce junto com o fim do conteúdo (evita a folha órfã).
  return (
    <div className="doc-pe" style={{ marginTop: 54, fontSize: 12, display: "grid", gridTemplateColumns: `repeat(${labels.length}, 1fr)`, gap: 24 }}>
      {labels.map((l) => (
        <div key={l}>
          <div style={{ borderBottom: "1px solid #000", height: 16 }} />
          <div style={{ marginTop: 2 }}>{l}</div>
        </div>
      ))}
    </div>
  );
}

function varLabel(v: TecidoRow["variantes"][number]) {
  const lbl = varianteLabel({ nome: v.variante_nome, cor: v.variante_cor, apelido: v.variante_apelido });
  return lbl !== "—" ? `${v.ordem} - ${lbl}` : `${v.ordem}`;
}

/** Rótulo pequeno "· casada com {Tecido 1 · cor}, ..." (ver casar-variantes-fatia2). Sem
 *  ids ou sem mapa (ou nenhum id resolve p/ rótulo) → "" (degrada, some da célula). */
function casadaComLabel(v: TecidoRow["variantes"][number], tecido1LabelById?: Map<string, string>) {
  const ids = v.complementa_variante_ids;
  if (!ids?.length || !tecido1LabelById) return "";
  const labels = ids.map((id) => tecido1LabelById.get(id)).filter(Boolean) as string[];
  return labels.length ? `· casada com ${labels.join(", ")}` : "";
}

/** Tabela de variantes (mesmo esquema p/ tecido e p/ forro/entretela). */
export function MaterialTable({ blocks, colMaterial, ocLinksByKey, tecido1LabelById }: { blocks: TecidoRow[]; colMaterial: string; ocLinksByKey?: Record<string, string[]>; tecido1LabelById?: Map<string, string> }) {
  const rows = blocks.flatMap((t) =>
    (t.variantes ?? []).filter((v) => v.variante_tecido_id).map((v) => ({ t, v })),
  );
  if (rows.length === 0) return null;
  // Cabeçalhos abreviados → numerais estreitos e UNIFORMES (7%); texto (Variante/
  // Material/OC) ganha o espaço. Tabela mais baixa, cabe na meia folha.
  const cw = ["18%", "24%", "23%", "7%", "7%", "7%", "7%", "7%"];
  const chW: React.CSSProperties = { ...cellH, overflowWrap: "anywhere", wordBreak: "break-word" };
  const cW: React.CSSProperties = { ...cell, overflowWrap: "anywhere", wordBreak: "break-word" };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4, tableLayout: "fixed" }}>
      <colgroup>{cw.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
      <thead>
        <tr style={{ background: "#eee" }}>
          <th style={chW}>Variante</th>
          <th style={chW}>{colMaterial}</th>
          <th style={chW}>OC(s)</th>
          <th style={chW}>Cons.</th>
          <th style={chW}>Metr. Plan.</th>
          <th style={chW}>Qtd Folhas</th>
          <th style={chW}>Tam. Folha</th>
          <th style={chW}>Metr. a Enviar</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ t, v }, i) => {
          const ocs = ocLinksByKey?.[`${t.tipo}-${t.numero}-${v.ordem}-${v.variante_tecido_id}`] ?? [];
          const casada = casadaComLabel(v, tecido1LabelById);
          return (
            <tr key={i}>
              <td style={cW}>
                {varLabel(v)}
                {casada && <div style={{ fontSize: 9, color: "#999" }}>{casada}</div>}
              </td>
              <td style={cW}>{t.artigo_nome ?? ""}</td>
              <td style={cW}>{ocs.length ? ocs.map((n) => `OC ${n}`).join(", ") : ""}</td>
              <td style={cW}>{fmt2(t.consumo_cad)}</td>
              <td style={cW}>{fmt2(v.metragem_planejada)}</td>
              <td style={cW}>{fmt2(v.quantidade_folhas)}</td>
              <td style={cW}>{fmt2(t.tamanho_folha)}</td>
              <td style={cW}>{fmt2(v.metragem_enviada)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Etiquetas({ blocks }: { blocks: TecidoRow[] }) {
  const withEt = blocks.filter((t) => t.artigo_id && (t.etiqueta_lavagem_urls ?? []).length > 0);
  if (withEt.length === 0) return null;
  return (
    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 12 }}>
      {withEt.map((t, i) => (
        <div key={i} style={{ fontSize: 11 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Etiqueta — {t.artigo_nome}</div>
          <EtiquetaLavagemArtigoPrint artigoId={t.artigo_id} />
        </div>
      ))}
    </div>
  );
}

export function CadFichaCorte({ modelo, tecidos, grades, tamanhosAll, aviamentos, etiquetas, gradeTotalGeral, previsaoEntrega, labelByNumero, ocLinksByKey, observacoesMolde, tecido1LabelById }: Props) {
  const tenantLogo = useTenantLogo();

  const totalGeral = gradeTotalGeral ?? grades.reduce((s, g) => s + (Number(g.grade_total) || 0), 0);
  const gradeSumT = (t: string) => grades.reduce((s, g) => s + (Number((g.grades as any)?.[t]) || 0), 0);
  const gradeTams = Array.from(new Set(grades.flatMap((g) => Object.keys((g.grades as any) ?? {}).filter((t) => (Number((g.grades as any)[t]) || 0) > 0)))).sort();
  const fmtTam = (t: string | null) => {
    if (!t) return "Geral";
    const [num, sig] = t.split("|");
    return sig ? `${sig} · ${num}` : t;
  };
  const tecidoBlocks = tecidos.filter((t) => t.tipo === "tecido");
  const forroBlocks = tecidos.filter((t) => t.tipo === "forro");
  const entretelaBlocks = tecidos.filter((t) => t.tipo === "entretela");
  const forroEntretela = [...forroBlocks, ...entretelaBlocks];

  // Cabeçalho padrão (FichaHeader), igual à Ficha Técnica. O cabeçalho customizado do
  // Editor de Impressão foi descontinuado — a Ficha de Corte usa sempre o padrão.
  const pageHeader = <FichaHeader title="FICHA DE CORTE" modelo={modelo} logo={tenantLogo} />;

  return (
    <PrintArea>
      {/* ===== Página 1 ===== (tabela: 2 linhas de meia folha) */}
      <table style={pageTableStyle}><tbody>
        <tr style={meiaRow}>
          <td className="print-section" style={meiaCell}>
            {pageHeader}
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Tecido</h3>
            <MaterialTable blocks={tecidoBlocks} colMaterial="Tecido" ocLinksByKey={ocLinksByKey} tecido1LabelById={tecido1LabelById} />
            <Etiquetas blocks={tecidoBlocks} />
            <Assinatura />
          </td>
        </tr>
        <tr style={meiaRow}>
          <td className="print-section" style={meiaCellBaixo}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Forro</h3>
            <MaterialTable blocks={forroBlocks} colMaterial="Forro" ocLinksByKey={ocLinksByKey} tecido1LabelById={tecido1LabelById} />
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 0" }}>Entretela</h3>
            <MaterialTable blocks={entretelaBlocks} colMaterial="Entretela" ocLinksByKey={ocLinksByKey} tecido1LabelById={tecido1LabelById} />
            <Etiquetas blocks={forroEntretela} />
            <Assinatura />
          </td>
        </tr>
      </tbody></table>

      {/* ===== Página 2 ===== */}
      <table style={{ ...pageTableStyle, pageBreakBefore: "always", breakBefore: "page" }}><tbody>
        <tr style={meiaRow}>
          <td className="print-section" style={meiaCell}>
            {pageHeader}
            <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 0 }}>Explosão de Aviamentos</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={cellH}>Aviamento</th>
                <th style={cellH}>Variante</th>
                <th style={cellH}>Consumo</th>
                <th style={cellH}>Quantidade Planejada</th>
                <th style={cellH}>Quantidade a Enviar</th>
              </tr>
            </thead>
            <tbody>
              {aviamentos.map((a, i) => (
                <tr key={i}>
                  <td style={cell}>{a.aviamento_nome ?? ""}</td>
                  <td style={cell}>{a.variante_label ?? "—"}</td>
                  <td style={cell}>{fmt2(a.consumo)}</td>
                  <td style={cell}>{fmt2(a.quantidade_enviar)}</td>
                  <td style={cell}>{fmt2(a.quantidade_separar)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {(etiquetas ?? []).length > 0 && (
            <>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 10 }}>Insumos</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
                <thead>
                  <tr style={{ background: "#eee" }}>
                    <th style={cellH}>Insumo</th>
                    <th style={cellH}>Cor</th>
                    <th style={cellH}>Tamanho</th>
                    <th style={cellH}>Qtd Planejada</th>
                    <th style={cellH}>Qtd a Enviar</th>
                  </tr>
                </thead>
                <tbody>
                  {(etiquetas ?? []).flatMap((e, i) => {
                    // Explode pela GRADE quando o insumo tem tamanho (mesmo sem enviar_por_tamanho
                    // gravado — reflete o cadastro atual). Sem tamanho → uma linha "Geral".
                    if (e.semTamanho || gradeTams.length === 0) {
                      return [(
                        <tr key={i}>
                          <td style={cell}>{e.etiqueta_nome ?? ""}</td>
                          <td style={cell}>{e.cor_nome ?? "—"}</td>
                          <td style={cell}>Geral</td>
                          <td style={cell}>{fmt2(e.consumo * totalGeral)}</td>
                          <td style={cell}>{fmt2(e.quantidade_enviar)}</td>
                        </tr>
                      )];
                    }
                    return gradeTams.map((t, j) => {
                      const planej = e.consumo * gradeSumT(t);
                      return (
                        <tr key={`${i}-${j}`}>
                          <td style={cell}>{j === 0 ? (e.etiqueta_nome ?? "") : ""}</td>
                          <td style={cell}>{j === 0 ? (e.cor_nome ?? "—") : ""}</td>
                          <td style={cell}>{fmtTam(t)}</td>
                          <td style={cell}>{fmt2(planej)}</td>
                          <td style={cell}>{fmt2(e.enviarPorTamanho[t] ?? planej)}</td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </>
          )}

            <Assinatura />
          </td>
        </tr>

        {/* Metade de baixo: Grade */}
        <tr style={meiaRow}>
          <td className="print-section" style={meiaCellBaixo}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Grade</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={cellH}>Variante</th>
                {tamanhosAll.map((t) => <th key={t} style={cellH}>{fmtTam(t)}</th>)}
                <th style={cellH}>Total</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.variante_numero}>
                  <td style={cell}>{labelByNumero?.[g.variante_numero] ?? `Variante ${g.variante_numero}`}</td>
                  {tamanhosAll.map((t) => <td key={t} style={cell}>{g.grades[t] ?? 0}</td>)}
                  <td style={cell}>{g.grade_total}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 0" }}>Observação de Partes do Molde</h3>
          <p style={{ fontSize: 11, whiteSpace: "pre-wrap", border: "1px solid #ccc", padding: 6, marginTop: 4, minHeight: 28 }}>
            {observacoesMolde?.trim() || ""}
          </p>
          </td>
        </tr>
      </tbody></table>
      <div style={{ fontSize: 8, color: "#999", textAlign: "right", marginTop: 4 }}>ficha · build 0623f</div>
    </PrintArea>
  );
}

/**
 * Ficha de Corte (documento de impressão) carregada só pelo modeloId — usa os
 * dados SALVOS do CAD (mesma fonte da Ficha Técnica). Permite imprimir a Ficha de
 * Corte sem abrir o CAD (ícone de impressão na lista).
 */
export function FichaCorteDoc({ modeloId }: { modeloId: string }) {
  const d = useFichaData(modeloId);
  return (
    <CadFichaCorte
      modelo={d.modelo}
      cadRow={d.cadRow}
      previsaoEntrega={d.previsaoEntrega}
      observacoesMolde={d.observacoesMolde}
      tecidos={d.tecidos}
      grades={d.grades}
      tamanhosAll={d.tamanhosAll}
      aviamentos={d.aviamentos}
      etiquetas={d.etiquetas}
      gradeTotalGeral={d.gradeTotalGeral}
      labelByNumero={d.labelByNumero}
      ocLinksByKey={d.ocLinksByKey}
      tecido1LabelById={d.tecido1LabelById}
    />
  );
}
