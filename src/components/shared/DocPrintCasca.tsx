import type { ReactNode, CSSProperties } from "react";
import { useTenantBranding } from "@/hooks/useTenantBranding";

/**
 * Casca padronizada dos PRINTÁVEIS (documentos A4). Extraída do padrão já consolidado em
 * `RelatorioPrint`/`OcDocumentoPrint` para que TODO documento compartilhe a mesma marca,
 * rodapé e bloco de assinatura — sem tocar no MIOLO de cada um.
 *
 * São 3 peças puras, montadas por cima do conteúdo próprio de cada tela:
 *   <DocMarcaHeader titulo subtitulo dataStr />   ← cabeçalho de marca (logo + nome/CNPJ/contato)
 *   ...miolo do documento (tabelas, grade, campos — inalterado)...
 *   <DocAssinaturas tipo="servico" />             ← linhas de assinatura por TIPO de documento
 *   <DocRodape dataStr />                          ← rodapé institucional
 *
 * Impressão é sempre fundo claro com cores FIXAS de propósito (exceção de cor §Q3/§R12) — os
 * hex inline aqui são intencionais e não migram p/ token de tema. Fonte do papel = Helvetica.
 */

export const DOC_TINTA = "#1a1a1a";

// Wrapper de tipografia do papel: qualquer documento que use esta casca envolve seu conteúdo
// aqui p/ herdar a fonte Helvetica + a tinta (senão a Ficha herda a Figtree da tela — divergência
// real que a padronização corrige). NÃO é o PrintArea — cada tela segue montando o seu.
export function DocPapel({ children }: { children: ReactNode }) {
  return <div style={{ fontFamily: "Helvetica, Arial, sans-serif", color: DOC_TINTA }}>{children}</div>;
}

/**
 * Container de UMA folha que ANCORA o pé (assinatura+rodapé) no rodapé da página quando há espaço.
 * Coluna flex de altura mínima = altura útil da folha A4 (297mm − 2×12mm de margem @page ≈ 273mm);
 * o `<DocPeDocumento>` no fim usa `margin-top:auto` p/ ser empurrado pro pé. Quando o conteúdo
 * transborda, o flex cresce e o pé desce naturalmente pra próxima folha JUNTO com o fim do conteúdo
 * (o CSS `.doc-pe { break-before: avoid }` impede a folha órfã só-de-assinatura). Documentos de uma
 * folha só (Comprovante/Romaneio/Ficha) envolvem TODO o miolo aqui; a OS aplica por `<section>`.
 * `minH` sobrescreve a altura mínima (a OS mede por seção, não pela folha inteira).
 */
export function DocFolha({ children, minH = "273mm" }: { children: ReactNode; minH?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: minH }}>
      {children}
    </div>
  );
}

/**
 * Cabeçalho de marca padrão: logo (se houver) + nome/CNPJ/contato da loja + "Emitido em <data>",
 * título grande, subtítulo e a barra de 5px na cor tinta. Mesmíssima anatomia do RelatorioPrint —
 * agora um lugar só. `nomeUpper` deixa o título em caixa-alta (padrão dos documentos operacionais
 * "ORDEM DE SERVIÇO"/"ROMANEIO"; relatórios usam caixa mista).
 */
export function DocMarcaHeader({
  titulo,
  subtitulo,
  dataStr,
  dataLabel = "Emitido em",
  nomeUpper = false,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  dataStr: string;
  dataLabel?: string;
  nomeUpper?: boolean;
}) {
  const loja = useTenantBranding();
  const nomeLoja = loja.nome ?? "WISH360";
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {loja.logoUrl && <img src={loja.logoUrl} alt="" style={{ maxHeight: 38, maxWidth: 96, objectFit: "contain" }} />}
          <div style={{ fontSize: 12, color: "#444" }}>
            <b style={{ color: DOC_TINTA }}>{nomeLoja}</b>{loja.cnpj ? ` · CNPJ ${loja.cnpj}` : ""}{loja.contato ? ` · ${loja.contato}` : ""}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#888" }}>{dataLabel} {dataStr}</div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: nomeUpper ? 0.3 : -0.4, lineHeight: 1.1, textTransform: nomeUpper ? "uppercase" : "none" }}>{titulo}</div>
      {subtitulo != null && subtitulo !== "" && <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{subtitulo}</div>}
      <div style={{ height: 5, background: DOC_TINTA, margin: "10px 0 16px" }} />
    </>
  );
}

/**
 * Rodapé institucional padrão: "Documento gerado pelo WISH360" · nome loja · data. Fica sempre
 * no fim do documento (fora das seções que quebram página). `label` deixa trocar
 * "Documento"→"Relatório" p/ os relatórios sem duplicar o markup.
 */
export function DocRodape({ dataStr, label = "Documento" }: { dataStr: string; label?: string }) {
  const loja = useTenantBranding();
  const nomeLoja = loja.nome ?? "WISH360";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, paddingTop: 6, borderTop: "1px solid #ddd", fontSize: 11, color: "#999" }}>
      <span>{label} gerado pelo WISH360</span>
      <span>{nomeLoja} · {dataStr}</span>
    </div>
  );
}

// Bloco de assinaturas por TIPO de documento. Cada tipo declara os campos que fazem sentido:
// - compra: documento de PEDIDO ao fornecedor (OC) → autoriza + fornecedor recebe.
// - servico: OS que acompanha a peça ao terceirizado → quem recebe assina + data a punho.
// - expedicao: romaneio de direcionamento → separado por + conferido por.
// - recibo: comprovante de pagamento → recebido por + data.
// - nenhuma: documento sem assinatura (relatórios).
export type DocAssinaturaTipo = "compra" | "servico" | "expedicao" | "recibo" | "nenhuma";

const CAMPOS_ASSINATURA: Record<Exclude<DocAssinaturaTipo, "nenhuma">, string[]> = {
  compra: ["Autorizado por", "Recebido pelo fornecedor"],
  servico: ["Recebido por", "Data"],
  expedicao: ["Separado por", "Conferido por"],
  recibo: ["Recebido por", "Data"],
};

/**
 * Linhas de assinatura padronizadas. Traço `1px #999` + rótulo pequeno centralizado (padrão do
 * OcDocumentoPrint), com os campos escolhidos pelo `tipo`. `nenhuma` não renderiza nada.
 */
export function DocAssinaturas({ tipo }: { tipo: DocAssinaturaTipo }) {
  if (tipo === "nenhuma") return null;
  const campos = CAMPOS_ASSINATURA[tipo];
  const linha: CSSProperties = { flex: 1, borderTop: "1px solid #999", paddingTop: 5, fontSize: 10, color: "#777", textAlign: "center" };
  return (
    <div style={{ display: "flex", gap: 40, marginTop: 34 }}>
      {campos.map((c) => <div key={c} style={linha}>{c}</div>)}
    </div>
  );
}

/**
 * Pé do documento = assinatura (por tipo) + rodapé institucional, agrupados. Resolve a "folha
 * órfã" (assinatura sozinha numa página nova):
 *  - `className="doc-pe"` aplica no papel `break-inside/break-before: avoid` (styles.css @media
 *    print) — o par nunca parte E o navegador não força uma quebra logo antes dele, então se não
 *    couber ele desce JUNTO com o fim do conteúdo, nunca sozinho.
 *  - `marginTop:auto` empurra o pé pro rodapé da folha QUANDO está dentro de um <DocFolha> (coluna
 *    flex de altura da folha) e sobra espaço — a ancoragem no pé.
 * Substitui o par solto `<DocAssinaturas/> + <DocRodape/>`; use um OU outro, não os dois.
 */
export function DocPeDocumento({ tipo, dataStr, rodapeLabel }: { tipo: DocAssinaturaTipo; dataStr: string; rodapeLabel?: string }) {
  return (
    <div className="doc-pe" style={{ marginTop: "auto" }}>
      <DocAssinaturas tipo={tipo} />
      <DocRodape dataStr={dataStr} label={rodapeLabel} />
    </div>
  );
}
