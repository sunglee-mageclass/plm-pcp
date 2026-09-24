// F3.2 — seções 5-8 do Sheet unificado (Tecidos/Forros/Entretelas · Aviamentos · Insumos · Grade), na ordem
// do mockup aprovado. Reusa os componentes só-props do Dev SEM modificá-los; Tecidos é a cópia local
// (TecidosBomSecao, decisão F3 #10). Somente-leitura pela trava ÚNICA (R2 do G-plano conjunto): sem permissão ou
// enviado à Explosão (vêm da F3.1) e a trava interina "tem CAD" (até a F3.3). Os avisos seguem os da F3.1
// (`AvisoCamposDev`). "Apagar grade preenchida?" portado do Dev (:3221-3237).
import type { ReactNode } from "react";
import { AlertTriangle, Check, ExternalLink, Info, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { CondicaoInfo } from "@/components/shared/CondicaoInfo";
import { ModeloAviamentosSection } from "@/components/desenvolvimento/modelo-detail/ModeloAviamentosSection";
import { ModeloEtiquetasSection } from "@/components/desenvolvimento/modelo-detail/ModeloEtiquetasSection";
import { ModeloGradeSection } from "@/components/desenvolvimento/modelo-detail/ModeloGradeSection";
import type { EstoqueArtigo } from "@/components/planejamento/planejamento-detail/campos";
import { AvisoCamposDev } from "./AvisoCamposDev";
import { TecidosBomSecao } from "../TecidosBomSecao";
import type { FichaTecnica } from "../useFichaTecnica";
import type { SeloSecao } from "../selos-bom";
import { SecaoBom } from "./SecaoBom";

const TOM: Record<SeloSecao["tone"], StatusTone> = { ok: "success", info: "info", warn: "warning", muted: "neutral" };

function SeloBadge({ selo }: { selo: SeloSecao }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusBadge tone={TOM[selo.tone]} title={selo.title} className="gap-1 rounded-full px-2 py-0.5 text-[11px] normal-case tracking-normal">
        {selo.tone === "ok" ? <Check className="h-3 w-3" /> : selo.tone === "warn" ? <AlertTriangle className="h-3 w-3" /> : null}
        {selo.texto}
      </StatusBadge>
      {selo.condicaoUnica && <CondicaoInfo descricao={selo.condicaoUnica.descricao} aviso={selo.condicaoUnica.aviso} />}
    </span>
  );
}

// Avisos da trava ÚNICA (R2 do G-plano conjunto), alinhados aos da F3.1 (`AvisoCamposDev`): "permissao" usa o MESMO
// componente/texto; "enviado" começa pela MESMA frase da F3.1, mas diz que o "Editar" não libera o BOM (a trava interina
// "tem CAD" segue até a F3.3 — card enviado sempre tem CAD); "cad" explica a trava interina. Mesmo estilo visual.
const TEXTO_AVISO_BOM: Record<"enviado" | "cad", string> = {
  enviado: "Enviado à Explosão: os campos vindos do Desenvolvimento ficam travados. Tecidos, aviamentos, insumos e grade seguem só-leitura aqui mesmo com “Editar” — altere-os no Desenvolvimento.",
  cad: "Este modelo já tem CAD: para não desalinhar o CAD e a Explosão, tecidos, aviamentos, insumos e grade ficam só-leitura aqui — altere-os no Desenvolvimento.",
};

// T9 m3 — trava "carregando" (a query de CAD, que decide a trava única, ainda não resolveu). Linha curta e
// discreta, MESMO estilo dos outros avisos (`Info`/`text-muted-foreground`, sem cor solta). Se a query der
// erro, a trava não pode ficar muda pra sempre — troca pro aviso de erro (`AlertTriangle`, mesma família de
// primitivo já usada pelos selos §Q, sem hex/hsl solto).
function AvisoSomenteLeitura({ motivo, cadErro, onAbrirDev }: {
  motivo: FichaTecnica["motivoSomenteLeitura"];
  cadErro?: boolean;
  onAbrirDev?: () => void;
}) {
  if (motivo === "permissao") return <AvisoCamposDev motivo="sem_permissao" />;
  if (motivo === "carregando") {
    if (cadErro) {
      return (
        <p className="flex items-center gap-1.5 py-1 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />Não foi possível verificar o CAD — recarregue o card.
        </p>
      );
    }
    return (
      <p className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />Carregando…
      </p>
    );
  }
  if (motivo !== "enviado" && motivo !== "cad") return null;
  return (
    <div data-testid="aviso-bom-somente-leitura" className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{TEXTO_AVISO_BOM[motivo]}</span>
      {onAbrirDev && (
        <Button type="button" variant="outline" size="sm" onClick={onAbrirDev}>
          <ExternalLink className="h-3.5 w-3.5 mr-1" />Abrir no Desenvolvimento
        </Button>
      )}
    </div>
  );
}

export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, proporcoes, onAbrirDev }: {
  ficha: FichaTecnica;
  modeloId: string;
  estoque: Record<string, EstoqueArtigo>;
  /** `modelos.ordem_criacao_enviada` — antes dela, avisa que cor+grade já reservam tecido. */
  ordemEnviada: boolean;
  /**
   * DESVIO do brief (Step 3 pedia expor `proporcoes` no retorno de `useFichaTecnica`, mas essa task foi
   * instruída a NÃO tocar em `useFichaTecnica.ts` — arquivo em revisão da Task 7 em paralelo). `proporcoes`
   * já é um parâmetro de ENTRADA de `useFichaTecnica` (`a.proporcoes`, vindo do `Draft` do Planejamento —
   * `useFichaBom.ts:366` grava em `draft.proporcoes`), então quem monta `<BomSecoes>` já tem o mesmo valor
   * à mão (o `Draft` do Planejamento) sem precisar que o orquestrador o devolva. Ver task-9-report.md.
   */
  proporcoes: Record<string, number>;
  onAbrirDev?: () => void;
}) {
  if (!ficha.habilitada) return null;
  const { estado, handlers, dados } = ficha;
  const carregando = !ficha.carregado;
  const corpo = (node: ReactNode) => (carregando ? (
    <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</p>
  ) : (
    <>
      <AvisoSomenteLeitura motivo={ficha.motivoSomenteLeitura} cadErro={dados.cadErro} onAbrirDev={onAbrirDev} />
      <fieldset disabled={!ficha.podeEditar} className="contents">{node}</fieldset>
    </>
  ));

  return (
    <>
      <SecaoBom id="tecidos" titulo="Tecidos / Forros / Entretelas" selo={<SeloBadge selo={ficha.selos.tecidos} />}>
        {!carregando && !ordemEnviada && ficha.podeEditar && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            As cores e a grade deste modelo já reservam tecido no estoque, mesmo antes da Ordem de Criação.
          </p>
        )}
        {corpo(
          <TecidosBomSecao
            modeloId={modeloId}
            blocks={estado.blocks}
            artigos={dados.artigos}
            artigosForro={dados.artigosForro}
            artigosEntretela={dados.artigosEntretela}
            grades={estado.grades}
            onChangeBlock={handlers.updateBlock}
            onChangeVariante={handlers.updateBlockVariante}
            onChangeOcLinks={handlers.updateBlockOcLinks}
            camposCopiados={ficha.camposCopiados}
            onCampoEditado={ficha.onCampoEditado}
            estoque={estoque}
            disabled={!ficha.podeEditar}
          />,
        )}
      </SecaoBom>

      <SecaoBom id="aviamentos" titulo="Aviamentos" selo={<SeloBadge selo={ficha.selos.aviamentos} />}>
        {corpo(
          <ModeloAviamentosSection
            rows={estado.aviamentos}
            aviamentos={dados.aviamentos}
            onChangeRow={handlers.updateAviamento}
            onAdd={handlers.addAviamento}
            onRemove={handlers.removeAviamento}
            camposCopiados={ficha.camposCopiados}
            onCampoEditado={ficha.onCampoEditado}
          />,
        )}
      </SecaoBom>

      <SecaoBom id="insumos" titulo="Insumos" selo={<SeloBadge selo={ficha.selos.insumos} />}>
        {corpo(
          <ModeloEtiquetasSection
            rows={estado.etiquetas}
            etiquetas={dados.etiquetaOpts}
            etiquetaMap={dados.etiquetaMap}
            onChangeRow={handlers.updateEtiqueta}
            onAdd={handlers.addEtiqueta}
            onRemove={handlers.removeEtiqueta}
            camposCopiados={ficha.camposCopiados}
            onCampoEditado={ficha.onCampoEditado}
          />,
        )}
      </SecaoBom>

      <SecaoBom id="grade" titulo="Grade" selo={<SeloBadge selo={ficha.selos.grade} />}>
        {corpo(
          <ModeloGradeSection
            tamanhos={dados.tamanhos}
            proporcoes={proporcoes}
            onChangeProporcao={handlers.updateProporcao}
            grades={estado.grades}
            onChangeGradeTotal={handlers.updateGradeTotal}
            onChangeGradeCell={handlers.updateGradeCell}
            tecido1Variantes={ficha.tecido1Info}
            gradeAuto={ficha.gradeAuto}
            onToggleGradeAuto={handlers.toggleGradeAuto}
            camposCopiados={ficha.camposCopiados}
            onCampoEditado={ficha.onCampoEditado}
          />,
        )}
      </SecaoBom>

      <AlertDialog open={!!ficha.confirmGrade} onOpenChange={(o) => { if (!o) ficha.setConfirmGrade(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar grade preenchida?</AlertDialogTitle>
            <AlertDialogDescription>{ficha.confirmGrade?.msg}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { ficha.confirmGrade?.onConfirm(); ficha.setConfirmGrade(null); }}>
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
