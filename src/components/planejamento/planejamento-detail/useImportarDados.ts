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
      // Acréscimo pós-T10 (M2, aprovado) — `aplicar` pode rodar bem depois do clique em "Substituir" (o
      // AlertDialog de confirmação de sobrescrita fica aberto até o usuário decidir): lê `podeEditar` por REF,
      // com o valor ATUAL, não o do clique que abriu o diálogo (`ficha` aqui é o do fechamento de `onCopiar`,
      // que pode já estar obsoleto). Se a ficha travou nesse meio-tempo (recarga alheia, card enviado à
      // Explosão por outra pessoa), não aplica nada — nem o BOM/CAD em staging, nem as Observações do bloco
      // (que gravam DE VERDADE, fora do Salvar).
      if (!ficha.podeEditarRef.current) {
        toast.error("A ficha foi travada enquanto você confirmava — nada foi importado.");
        return;
      }
      const campos = camposDoPatchNoDraft(r.patch);
      if (Object.keys(campos).length > 0) setDraftTracked((d) => ({ ...d, ...campos }));
      ficha.aplicarImportacaoBom(r.patch, r.campos);
      if (sel?.obsBloco && origem && modeloId) {
        try {
          await substituirObservacoesDoBloco(modeloId, origem.obsBlocoLinhas ?? []);
          toast.info("Observações copiadas.");
        } catch (e) {
          toast.error(mensagemErro(e, "Erro ao copiar as observações"));
        } finally {
          // Acréscimo pós-T10 (M3, aprovado) — invalida num `finally` (não só no caminho de sucesso):
          // `substituirObservacoesDoBloco` faz DELETE e depois INSERT; se o delete funcionar e o insert
          // falhar, o servidor já ficou SEM as linhas antigas — sem invalidar aqui, o cache ficava mostrando
          // as observações originais (que já não existem mais no banco), um estado fantasma na tela.
          qc.invalidateQueries({ queryKey: ["modelo-observacoes", modeloId] });
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
