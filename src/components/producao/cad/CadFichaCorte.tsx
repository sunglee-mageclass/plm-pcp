import { cell, cellH } from "./types";
import type { AviamentoRow, EtiquetaRow, GradeRow, TecidoRow } from "./types";
import { EtiquetaLavagemArtigoPrint } from "@/components/shared/EtiquetaLavagemArtigo";
import { FichaHeader } from "@/components/producao/FichaHeader";
import { useTenantLogo } from "@/hooks/useTenantLogo";
import { useFichaData } from "./useFichaData";
import { fmtNum } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { FichaCorteHeaderRender } from "@/components/shared/print-blocks";
import { isHeaderLayout } from "@/lib/print-template";
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
};

// Quebra NATURAL: cada seção evita ser cortada no meio e pagina quando não cabe.
// (Antes era flex 0 0 50% + overflow:hidden, que cortava modelos grandes em
// silêncio e desperdiçava espaço quando havia pouco conteúdo.)
const pageStyle: React.CSSProperties = {};
const halfStyle: React.CSSProperties = { breakInside: "avoid", marginBottom: 10 };
const fmt2 = (n: number | null | undefined) => fmtNum(n);

export function Assinatura({ dataPrevista = false }: { dataPrevista?: boolean }) {
  // Ficha Técnica inclui "Data Prevista" entre Data e Assinatura; Ficha de Corte não.
  const labels = dataPrevista ? ["Nome", "Data", "Data Prevista", "Assinatura"] : ["Nome", "Data", "Assinatura"];
  return (
    <div style={{ marginTop: 54, fontSize: 12, display: "grid", gridTemplateColumns: `repeat(${labels.length}, 1fr)`, gap: 24 }}>
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
  const cor = v.variante_cor || v.variante_nome;
  return `Variante ${v.ordem}${cor ? ` - ${cor}` : ""}`;
}

/** Tabela de variantes (mesmo esquema p/ tecido e p/ forro/entretela). */
export function MaterialTable({ blocks, colMaterial, ocLinksByKey }: { blocks: TecidoRow[]; colMaterial: string; ocLinksByKey?: Record<string, string[]> }) {
  const rows = blocks.flatMap((t) =>
    (t.variantes ?? []).filter((v) => v.variante_tecido_id).map((v) => ({ t, v })),
  );
  if (rows.length === 0) return null;
  const cw = ["15%", "15%", "14%", "9%", "11%", "9%", "12%", "15%"];
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
          <th style={chW}>Consumo</th>
          <th style={chW}>Metr. Planejada</th>
          <th style={chW}>Qtd Folhas</th>
          <th style={chW}>Tamanho da Folha</th>
          <th style={chW}>Metr. a Enviar/Separar</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ t, v }, i) => {
          const ocs = ocLinksByKey?.[`${t.tipo}-${t.numero}-${v.ordem}-${v.variante_tecido_id}`] ?? [];
          return (
            <tr key={i}>
              <td style={cW}>{varLabel(v)}</td>
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

export function CadFichaCorte({ modelo, tecidos, grades, tamanhosAll, aviamentos, etiquetas, gradeTotalGeral, previsaoEntrega, labelByNumero, ocLinksByKey, observacoesMolde }: Props) {
  const tenantLogo = useTenantLogo();
  const tenantId = useActiveTenantId();
  // Cabeçalho personalizado pelo Editor de Impressão (print_templates), se houver.
  const { data: tplRow } = useQuery({
    queryKey: ["print-template", "ficha_corte", tenantId],
    enabled: !!tenantId,
    queryFn: async () =>
      (await supabase.from("print_templates" as any).select("layout").eq("doc_type", "ficha_corte").eq("tenant_id", tenantId).maybeSingle()).data,
  });
  const headerLayout = isHeaderLayout((tplRow as any)?.layout) ? (tplRow as any).layout : null;

  const totalGeral = gradeTotalGeral ?? grades.reduce((s, g) => s + (Number(g.grade_total) || 0), 0);
  const gradeSumT = (t: string) => grades.reduce((s, g) => s + (Number((g.grades as any)?.[t]) || 0), 0);
  const fmtTam = (t: string | null) => {
    if (!t) return "Geral";
    const [num, sig] = t.split("|");
    return sig ? `${sig} · ${num}` : t;
  };
  const tecidoBlocks = tecidos.filter((t) => t.tipo === "tecido");
  const forroBlocks = tecidos.filter((t) => t.tipo === "forro");
  const entretelaBlocks = tecidos.filter((t) => t.tipo === "entretela");
  const forroEntretela = [...forroBlocks, ...entretelaBlocks];

  // Cabeçalho: usa o template do Editor de Impressão se a loja tiver um; senão o
  // padrão (FichaHeader, igual à Ficha Técnica).
  const pageHeader = headerLayout ? (
    <FichaCorteHeaderRender layout={headerLayout} logo={tenantLogo} modelo={modelo} previsaoEntrega={previsaoEntrega} />
  ) : (
    <FichaHeader title="FICHA DE CORTE" modelo={modelo} logo={tenantLogo} />
  );

  return (
    <PrintArea>
      {/* ===== Página 1 ===== */}
      <div style={pageStyle}>
        {/* Metade de cima: cabeçalho + Tecido */}
        <div className="print-section" style={halfStyle}>
          {pageHeader}
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Tecido</h3>
          <MaterialTable blocks={tecidoBlocks} colMaterial="Tecido" ocLinksByKey={ocLinksByKey} />
          <Etiquetas blocks={tecidoBlocks} />
          <Assinatura />
        </div>

        {/* Metade de baixo: Forro e Entretela (tabelas separadas) */}
        <div className="print-section" style={{ ...halfStyle, borderTop: "1px dashed #999", paddingTop: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Forro</h3>
          <MaterialTable blocks={forroBlocks} colMaterial="Forro" ocLinksByKey={ocLinksByKey} />
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 0" }}>Entretela</h3>
          <MaterialTable blocks={entretelaBlocks} colMaterial="Entretela" ocLinksByKey={ocLinksByKey} />
          <Etiquetas blocks={forroEntretela} />
          <Assinatura />
        </div>
      </div>

      {/* ===== Página 2 ===== */}
      <div style={{ ...pageStyle, pageBreakBefore: "always", breakBefore: "page" }}>
        {/* Metade de cima: Explosão de Aviamentos */}
        <div className="print-section" style={halfStyle}>
          {pageHeader}
          <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 0 }}>Explosão de Aviamentos</h3>
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
              {aviamentos.map((a, i) => (
                <tr key={i}>
                  <td style={cell}>{a.aviamento_nome ?? ""}</td>
                  <td style={cell}>{fmt2(a.consumo)}</td>
                  <td style={cell}>{fmt2(a.quantidade_enviar)}</td>
                  <td style={cell}>{fmt2(a.quantidade_separar)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {(etiquetas ?? []).length > 0 && (
            <>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 10 }}>TAG/Etiquetas</h3>
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
                  {(etiquetas ?? []).map((e, i) => {
                    const base = e.tamanho ? gradeSumT(e.tamanho) : totalGeral;
                    return (
                      <tr key={i}>
                        <td style={cell}>{e.etiqueta_nome ?? ""}</td>
                        <td style={cell}>{fmtTam(e.tamanho)}</td>
                        <td style={cell}>{fmt2(e.consumo)}</td>
                        <td style={cell}>{fmt2(e.consumo * base)}</td>
                        <td style={cell}>{fmt2(e.quantidade_enviar)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          <Assinatura />
        </div>

        {/* Metade de baixo: Grade */}
        <div className="print-section" style={{ ...halfStyle, borderTop: "1px dashed #999", paddingTop: 10 }}>
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
        </div>
      </div>
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
    />
  );
}
