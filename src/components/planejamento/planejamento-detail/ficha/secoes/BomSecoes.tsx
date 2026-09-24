// F3.2/F3.3 — seções vindas do Desenvolvimento no Sheet unificado (Tecidos/Forros/Entretelas · Aviamentos · Insumos ·
// Grade · CAD), na ordem do mockup aprovado. Reusa os componentes só-props do Dev SEM modificá-los (Tecidos = cópia local
// TecidosBomSecao, decisão F3 #10; CAD = CadTecidosSection da Produção). Somente-leitura pela trava ÚNICA (R2): sem
// permissão ou enviado à Explosão (F3.1 — o "Editar" destrava BOM e CAD). Avisos = os da F3.1 (`AvisoCamposDev`).
// "Apagar grade preenchida?" portado do Dev (:3221-3237).
import type { ReactNode } from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ModeloAviamentosSection } from "@/components/desenvolvimento/modelo-detail/ModeloAviamentosSection";
import { ModeloEtiquetasSection } from "@/components/desenvolvimento/modelo-detail/ModeloEtiquetasSection";
import { ModeloGradeSection } from "@/components/desenvolvimento/modelo-detail/ModeloGradeSection";
import { CadTecidosSection } from "@/components/producao/cad/CadTecidosSection";
import type { EstoqueArtigo } from "@/components/planejamento/planejamento-detail/campos";
import { AvisoCamposDev } from "./AvisoCamposDev";
import { TecidosBomSecao } from "../TecidosBomSecao";
import type { FichaTecnica } from "../useFichaTecnica";
import { SecaoBom } from "./SecaoBom";
import { SeloBadge } from "./SeloBadge";
import type { SecaoSheetKey } from "../selos-secoes";

// Avisos da trava ÚNICA (R2), IGUAIS aos da F3.1 (`AvisoCamposDev`): sem a trava interina "tem CAD", o "Editar" destrava
// BOM e CAD como os demais campos do Dev (F3.3) — "enviado" usa a MESMA frase.
function AvisoSomenteLeitura({ motivo }: { motivo: FichaTecnica["motivoSomenteLeitura"] }) {
  if (motivo === "permissao") return <AvisoCamposDev motivo="sem_permissao" />;
  if (motivo === "enviado") return <AvisoCamposDev motivo="enviado" />;
  return null;
}

// Ficha ainda não carregada; se a query do CAD falhou, diz (a carga espera o CAD — Task 4 — e não pode ficar muda).
function Carregando({ erro }: { erro: boolean }) {
  return erro ? (
    <p className="flex items-center gap-1.5 py-2 text-xs text-destructive">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />Não foi possível carregar o CAD — recarregue o card.
    </p>
  ) : (
    <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</p>
  );
}

export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, proporcoes, numeros }: {
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
  /** F3.3 — numeração dinâmica do Sheet (selos-secoes.ts `numerarSecoes`). */
  numeros?: Partial<Record<SecaoSheetKey, number>>;
}) {
  if (!ficha.habilitada) return null;
  const { estado, handlers, dados } = ficha;
  const carregando = !ficha.carregado;
  const corpo = (node: ReactNode) => (carregando ? <Carregando erro={dados.cadErro} /> : (
    <>
      <AvisoSomenteLeitura motivo={ficha.motivoSomenteLeitura} />
      <fieldset disabled={!ficha.podeEditar} className="contents">{node}</fieldset>
    </>
  ));

  return (
    <>
      <SecaoBom id="tecidos" titulo="Tecidos / Forros / Entretelas" numero={numeros?.tecidos} selo={<SeloBadge selo={ficha.selos.tecidos} />}>
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

      <SecaoBom id="aviamentos" titulo="Aviamentos" numero={numeros?.aviamentos} selo={<SeloBadge selo={ficha.selos.aviamentos} />}>
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

      <SecaoBom id="insumos" titulo="Insumos" numero={numeros?.insumos} selo={<SeloBadge selo={ficha.selos.insumos} />}>
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

      <SecaoBom id="grade" titulo="Grade" numero={numeros?.grade} selo={<SeloBadge selo={ficha.selos.grade} />}>
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

      {/* F3.3 — seção CAD (Dev :2881-2912): o MESMO `CadTecidosSection` (reusado SEM modificar — decisão 8), sem a coluna
          "a Separar/Enviar" (é da Explosão). Grava no MESMO Salvar do BOM (decisão F3 #7). Antes da Ordem de Criação e
          sem CAD fica só-leitura (D2 — o Planejamento não cria o CAD antes da Ordem). */}
      <SecaoBom id="cad" titulo="CAD" numero={numeros?.cad} selo={<SeloBadge selo={ficha.seloCad} />}>
        {corpo(
          ficha.cad.linhas.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nenhum tecido/variante planejado neste modelo. Adicione tecidos na seção Tecidos / Forros / Entretelas.</p>
          ) : (
            <>
              {ficha.cadAntesDaOrdem && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  O CAD é criado depois da Ordem de Criação — até lá esta seção só mostra o que os tecidos vão levar.
                </p>
              )}
              <CadTecidosSection
                tecidos={ficha.cad.linhas}
                updateTec={ficha.cad.handlers.updateTec}
                updateVar={ficha.cad.handlers.updateVar}
                autoFolhas={ficha.cad.autoFolhas}
                onToggleAutoFolhas={ficha.cad.handlers.setAutoFolhas}
                readOnly={!ficha.cadGravavel}
                hideSeparar
              />
            </>
          ),
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
