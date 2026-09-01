import type { ReactNode } from "react";
import { PrintArea } from "@/components/shared/PrintArea";
import { useTenantBranding } from "@/hooks/useTenantBranding";

/**
 * Documento imprimível de UMA OC (pedido ao fornecedor), fiel ao mockup aprovado.
 * Componente "burro": recebe um modelo NORMALIZADO; cada tela de OC (tecido/aviamento/
 * insumo/p-acabado) traduz o seu draft para este shape. Reusa a marca da loja
 * (useTenantBranding) + o portal de impressão (PrintArea) + o CSS @media print.
 *
 * É sempre o PEDIDO (qtd pedida + valores previstos) — não mostra recebido.
 * - Tecido/Aviamento/Insumo: tabela de itens (com subtotal de qtd por artigo quando aplicável).
 * - Produto Acabado: grade matriz (cor × tamanho) + linha de proporção de grade + valores.
 */

const TINTA = "#1a1a1a";
const AZ = "#eef4fb";

export type OcDocKV = { k: string; v: ReactNode };

// Linha de item comum (tecido/aviamento/insumo). `subtotalArtigo` marca a linha de total por artigo.
export type OcDocItem = {
  nome: ReactNode;            // artigo/aviamento/insumo
  variante?: ReactNode;      // cor/variante/tamanho
  qtd?: ReactNode;           // já formatado com unidade (ex.: "120 m", "35 kg", "2000 un")
  preco?: ReactNode;         // já formatado (ex.: "R$ 28,50")
  subtotal?: ReactNode;      // já formatado
  subtotalArtigo?: boolean;  // true = linha de "Total <artigo>" (agrupamento)
};

// Grade do produto acabado (matriz cor × tamanho).
export type OcDocGrade = {
  produtoTitulo: string;               // "Produto: X (REF …)"
  tamanhos: string[];                  // colunas
  proporcao?: Record<string, ReactNode>; // peso/proporção por tamanho (linha destacada)
  linhas: { cor: ReactNode; celulas: Record<string, ReactNode>; total: ReactNode }[];
  totalPorTamanho: Record<string, ReactNode>;
  totalGeral: ReactNode;
  valores?: { descricao: ReactNode; qtd: ReactNode; precoUnit: ReactNode; subtotal: ReactNode }[];
};

export type OcDocModelo = {
  numero: string;
  familiaLabel: string;                // "Tecidos" / "Aviamentos" / "Insumos" / "Produto Acabado (Revenda)"
  emitidoEm: string;                   // data formatada
  fornecedor: OcDocKV[];               // Empresa / Representante / Contato
  dados: OcDocKV[];                    // Responsável / Datas / Pagamento
  colunasItem?: { nome: string; variante: string; qtd: string; preco?: string; subtotal?: string };
  itens?: OcDocItem[];                 // tecido/aviamento/insumo
  grade?: OcDocGrade;                  // produto acabado
  totalPrevisto?: ReactNode;           // formatado
  observacoes?: { titulo: string; texto: ReactNode }[];
};

const box: React.CSSProperties = { border: "1px solid #e6e6e6", borderRadius: 7, padding: "10px 12px" };
const cap: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "#666", marginBottom: 6 };
const kvRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "2px 0" };
const secTitle: React.CSSProperties = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: TINTA, margin: "18px 0 7px", paddingBottom: 4, borderBottom: `2px solid ${TINTA}` };
const th: React.CSSProperties = { borderBottom: "2px solid #333", padding: "6px 8px", background: "#f0f0f0", fontWeight: 700, fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase", color: TINTA, textAlign: "left" };
const td: React.CSSProperties = { borderBottom: "1px solid #e6e6e6", padding: "5px 8px", fontSize: 11, color: TINTA };
const num: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const center: React.CSSProperties = { textAlign: "center" };

export function OcDocumentoPrint({ modelo }: { modelo: OcDocModelo }) {
  const loja = useTenantBranding();
  const nomeLoja = loja.nome ?? "WISH360";
  const col = modelo.colunasItem;

  return (
    <PrintArea>
      <div style={{ fontFamily: "Helvetica, Arial, sans-serif", color: TINTA }}>
        {/* Cabeçalho de marca */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {loja.logoUrl && <img src={loja.logoUrl} alt="" style={{ maxHeight: 38, maxWidth: 96, objectFit: "contain" }} />}
            <div style={{ fontSize: 12, color: "#444" }}>
              <b style={{ color: TINTA }}>{nomeLoja}</b>{loja.cnpj ? ` · CNPJ ${loja.cnpj}` : ""}{loja.contato ? ` · ${loja.contato}` : ""}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#888" }}>Emitido em {modelo.emitidoEm}</div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.4, lineHeight: 1.1 }}>Pedido de Compra</div>
        <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>Nº <b>{modelo.numero}</b> · {modelo.familiaLabel}</div>
        <div style={{ height: 5, background: TINTA, margin: "10px 0 16px" }} />

        {/* Fornecedor + Dados do pedido */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
          <div style={box}>
            <div style={cap}>Fornecedor</div>
            {modelo.fornecedor.map((kv, i) => (
              <div key={i} style={kvRow}><span style={{ color: "#555" }}>{kv.k}</span><span style={{ fontWeight: 600, textAlign: "right" }}>{kv.v}</span></div>
            ))}
          </div>
          <div style={box}>
            <div style={cap}>Dados do pedido</div>
            {modelo.dados.map((kv, i) => (
              <div key={i} style={kvRow}><span style={{ color: "#555" }}>{kv.k}</span><span style={{ fontWeight: 600, textAlign: "right" }}>{kv.v}</span></div>
            ))}
          </div>
        </div>

        {/* ITENS (tecido/aviamento/insumo) */}
        {modelo.itens && col && (
          <>
            <div style={secTitle}>Itens</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>{col.nome}</th>
                  <th style={th}>{col.variante}</th>
                  <th style={{ ...th, ...num }}>{col.qtd}</th>
                  {col.preco && <th style={{ ...th, ...num }}>{col.preco}</th>}
                  {col.subtotal && <th style={{ ...th, ...num }}>{col.subtotal}</th>}
                </tr>
              </thead>
              <tbody>
                {modelo.itens.map((it, i) => it.subtotalArtigo ? (
                  <tr key={i}>
                    <td style={{ ...td, ...num, background: "#f6f7f9", fontWeight: 700, fontSize: 10.5, color: "#444" }} colSpan={2}>Total {it.nome}</td>
                    <td style={{ ...td, ...num, background: "#f6f7f9", fontWeight: 700, fontSize: 10.5, color: "#444" }}>{it.qtd}</td>
                    {col.preco && <td style={{ ...td, background: "#f6f7f9" }} />}
                    {col.subtotal && <td style={{ ...td, background: "#f6f7f9" }} />}
                  </tr>
                ) : (
                  <tr key={i} className={i % 2 === 1 ? "rel-az" : undefined}>
                    <td style={td}>{it.nome}</td>
                    <td style={td}>{it.variante}</td>
                    <td style={{ ...td, ...num }}>{it.qtd}</td>
                    {col.preco && <td style={{ ...td, ...num }}>{it.preco}</td>}
                    {col.subtotal && <td style={{ ...td, ...num }}>{it.subtotal}</td>}
                  </tr>
                ))}
              </tbody>
              {modelo.totalPrevisto != null && (
                <tfoot>
                  <tr>
                    <td style={{ ...num, borderTop: "2px solid #333", fontWeight: 800, fontSize: 12, paddingTop: 8, paddingRight: 8 }} colSpan={2 + (col.preco ? 1 : 0)}>Total previsto</td>
                    <td style={{ ...num, borderTop: "2px solid #333", fontWeight: 800, fontSize: 12, paddingTop: 8, paddingRight: 8 }}>{modelo.totalPrevisto}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </>
        )}

        {/* GRADE (produto acabado) */}
        {modelo.grade && (
          <>
            <div style={secTitle}>{modelo.grade.produtoTitulo}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Cor / Variante</th>
                  {modelo.grade.tamanhos.map((t) => <th key={t} style={{ ...th, ...center }}>{t}</th>)}
                  <th style={{ ...th, ...num }}>Total</th>
                </tr>
                {modelo.grade.proporcao && (
                  <tr>
                    <td style={{ ...td, background: AZ, fontSize: 10, fontWeight: 600, color: "#555", textTransform: "uppercase", letterSpacing: 0.3 }}>Peso (proporção)</td>
                    {modelo.grade.tamanhos.map((t) => <td key={t} style={{ ...td, ...center, background: AZ, fontSize: 10, fontWeight: 600, color: "#555" }}>{modelo.grade!.proporcao![t] ?? "—"}</td>)}
                    <td style={{ ...td, background: AZ }} />
                  </tr>
                )}
              </thead>
              <tbody>
                {modelo.grade.linhas.map((r, i) => (
                  <tr key={i} className={i % 2 === 1 ? "rel-az" : undefined}>
                    <td style={td}>{r.cor}</td>
                    {modelo.grade!.tamanhos.map((t) => <td key={t} style={{ ...td, ...center }}>{r.celulas[t] ?? "—"}</td>)}
                    <td style={{ ...td, ...num, fontWeight: 700 }}>{r.total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...td, fontWeight: 700, background: "#fafafa" }}>Total por tamanho</td>
                  {modelo.grade.tamanhos.map((t) => <td key={t} style={{ ...td, ...center, fontWeight: 700, background: "#fafafa" }}>{modelo.grade!.totalPorTamanho[t] ?? "—"}</td>)}
                  <td style={{ ...td, ...num, fontWeight: 700, background: "#fafafa" }}>{modelo.grade.totalGeral}</td>
                </tr>
              </tfoot>
            </table>

            {modelo.grade.valores && modelo.grade.valores.length > 0 && (
              <>
                <div style={secTitle}>Valores</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Descrição</th>
                      <th style={{ ...th, ...num }}>Qtd total</th>
                      <th style={{ ...th, ...num }}>Preço unitário</th>
                      <th style={{ ...th, ...num }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelo.grade.valores.map((v, i) => (
                      <tr key={i}>
                        <td style={td}>{v.descricao}</td>
                        <td style={{ ...td, ...num }}>{v.qtd}</td>
                        <td style={{ ...td, ...num }}>{v.precoUnit}</td>
                        <td style={{ ...td, ...num }}>{v.subtotal}</td>
                      </tr>
                    ))}
                  </tbody>
                  {modelo.totalPrevisto != null && (
                    <tfoot>
                      <tr>
                        <td style={{ ...num, borderTop: "2px solid #333", fontWeight: 800, fontSize: 12, paddingTop: 8, paddingRight: 8 }} colSpan={3}>Total previsto</td>
                        <td style={{ ...num, borderTop: "2px solid #333", fontWeight: 800, fontSize: 12, paddingTop: 8, paddingRight: 8 }}>{modelo.totalPrevisto}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </>
            )}
          </>
        )}

        {/* Observações */}
        {modelo.observacoes?.map((o, i) => o.texto ? (
          <div key={i} style={{ marginTop: 16, ...box }}>
            <div style={cap}>{o.titulo}</div>
            <div style={{ fontSize: 11, color: "#444" }}>{o.texto}</div>
          </div>
        ) : null)}

        {/* Assinaturas */}
        <div style={{ display: "flex", gap: 40, marginTop: 34 }}>
          <div style={{ flex: 1, borderTop: "1px solid #999", paddingTop: 5, fontSize: 10, color: "#777", textAlign: "center" }}>Autorizado por</div>
          <div style={{ flex: 1, borderTop: "1px solid #999", paddingTop: 5, fontSize: 10, color: "#777", textAlign: "center" }}>Recebido pelo fornecedor</div>
        </div>

        {/* Rodapé institucional */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, paddingTop: 6, borderTop: "1px solid #ddd", fontSize: 11, color: "#999" }}>
          <span>Documento gerado pelo WISH360</span>
          <span>{nomeLoja} · {modelo.emitidoEm}</span>
        </div>
      </div>
    </PrintArea>
  );
}
