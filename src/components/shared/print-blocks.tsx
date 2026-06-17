import {
  fichaCorteFieldLabel,
  fichaCorteFieldMock,
  fichaCorteFieldValue,
  type HeaderLayout,
  type PrintBlock,
} from "@/lib/print-template";

/** Conteúdo de um bloco — usado no editor (mock) e na impressão (valor real). */
export function BlockContent({
  block, logo, editor, value,
}: {
  block: PrintBlock;
  logo: string | null | undefined;
  editor?: boolean;
  value?: string;
}) {
  const style: React.CSSProperties = {
    fontWeight: block.bold ? 700 : 400,
    textAlign: block.align ?? "left",
    fontSize: block.fontSize ? `${block.fontSize}px` : undefined,
    width: "100%",
    height: "100%",
    padding: "2px 4px",
    display: "flex",
    alignItems: "center",
    justifyContent: block.align === "center" ? "center" : block.align === "right" ? "flex-end" : "flex-start",
    lineHeight: 1.2,
    overflow: "hidden",
  };
  if (block.type === "logo") {
    return logo ? (
      <img src={logo} alt="Logo" style={{ ...style, objectFit: "contain", padding: 2 }} />
    ) : (
      <div style={{ ...style, justifyContent: "center", color: "#999", border: editor ? "1px dashed #ccc" : undefined, fontSize: 11 }}>
        LOGO
      </div>
    );
  }
  if (block.type === "text") {
    return <div style={style}>{block.text ?? ""}</div>;
  }
  const label = fichaCorteFieldLabel(block.field ?? "");
  const val = editor ? fichaCorteFieldMock(block.field ?? "") : value ?? "";
  return (
    <div style={style}>
      <span><span style={{ color: "#666", fontWeight: 400 }}>{label}: </span>{val}</span>
    </div>
  );
}

/** Cabeçalho da Ficha de Corte renderizado a partir do template (impressão). */
export function FichaCorteHeaderRender({
  layout, logo, modelo, previsaoEntrega,
}: {
  layout: HeaderLayout;
  logo: string | null | undefined;
  modelo: any;
  previsaoEntrega?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gridAutoRows: `${layout.rowH}px`,
        height: layout.rows * layout.rowH,
        marginBottom: 8,
      }}
    >
      {layout.blocks.map((b) => (
        <div
          key={b.id}
          style={{
            gridColumn: `${b.x + 1} / span ${b.w}`,
            gridRow: `${b.y + 1} / span ${b.h}`,
            overflow: "hidden",
          }}
        >
          <BlockContent
            block={b}
            logo={logo}
            value={b.type === "field" ? fichaCorteFieldValue(b.field ?? "", { modelo, previsaoEntrega }) : undefined}
          />
        </div>
      ))}
    </div>
  );
}
