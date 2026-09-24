// F3.3 — "Importar dados" no Sheet do Planejamento. PORTA de ModeloDetailPanel.tsx:2328-2400 (aplicarPatch /
// overwritesDoPatch / onCopiar) + :3239-3259 (diálogos). O diálogo é o do Dev (ImportarDadosDialog), reusado SEM
// modificar. Staging: tudo vai para o rascunho/BOM/CAD (realce amarelo que some ao editar) e só o Salvar grava — EXCETO
// as Observações (bloco), que gravam NA HORA (substitui; o bloco é auto-save — CLAUDE.md, "criacao").
import { useState, type Dispatch, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { ModeloParaCopia, ResultadoCopia, Selecao } from "@/components/desenvolvimento/importar/importar-copia";
import type { Draft } from "@/components/planejamento/modelo-shared";
import { camposDoPatchNoDraft, itensSobrescritos } from "./ficha/importar-ficha";
import { substituirObservacoesDoBloco } from "./ficha/persistir-bom";
import type { FichaTecnica } from "./ficha/useFichaTecnica";

export function useImportarDados({ modeloId, ficha, draft, setDraftTracked, qc }: {
  modeloId: string | null;
  ficha: FichaTecnica;
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  qc: QueryClient;
}) {
  const [aberto, setAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState<{ itens: string[]; aplicar: () => void } | null>(null);

  const onCopiar = (r: ResultadoCopia, origem?: ModeloParaCopia, sel?: Selecao) => {
    const aplicar = async () => {
      const campos = camposDoPatchNoDraft(r.patch);
      if (Object.keys(campos).length > 0) setDraftTracked((d) => ({ ...d, ...campos }));
      ficha.aplicarImportacaoBom(r.patch, r.campos);
      if (sel?.obsBloco && origem && modeloId) {
        try {
          await substituirObservacoesDoBloco(modeloId, origem.obsBlocoLinhas ?? []);
          qc.invalidateQueries({ queryKey: ["modelo-observacoes", modeloId] });
          toast.info("Observações copiadas.");
        } catch (e) {
          toast.error(mensagemErro(e, "Erro ao copiar as observações"));
        }
      }
    };
    const itens = itensSobrescritos(r.patch, {
      observacoesTecnicas: draft.observacoes_tecnicas, custosAdicionais: draft.custos_adicionais, proporcoes: draft.proporcoes,
      blocks: ficha.estado.blocks, aviamentos: ficha.estado.aviamentos, etiquetas: ficha.estado.etiquetas, grades: ficha.estado.grades,
    }, !!sel?.obsBloco);
    if (itens.length === 0) { void aplicar(); return; }
    setConfirmacao({ itens, aplicar: () => { void aplicar(); setConfirmacao(null); } });
  };

  return { aberto, setAberto, confirmacao, setConfirmacao, onCopiar };
}
