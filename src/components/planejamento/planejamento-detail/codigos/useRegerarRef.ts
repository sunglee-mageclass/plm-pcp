// "Regerar REF" por card (seção "4. Códigos" do Sheet do Planejamento) — o estado "REF a gravar", FORA do Draft (como o `useSkusAGravar`): a REF nova
// é só uma PRÉVIA (nada grava antes do Salvar). Ao iniciar, liga o "Regerar" da prévia de SKUs (`aGravar.pedirRegerar`) — então o "não salvo"/selo âmbar
// do Sheet e o "Voltar/Descartar" vêm de graça — e a prévia de SKUs passa a usar a REF nova (`refPrevia` do `useSkusModelo`). Quem grava é o Salvar do card
// (`aoSalvar` → `useSkusModelo.aplicarRegerarRef` → RPC atômica `regerar_ref_card`). Cálculo da REF = SÓ no banco (`ref_regerar_previa`).
// Regras: REF manual pede confirmação (AlertDialog na seção; o servidor também exige); digitar a REF ou mudar categoria/sub1 no rascunho CANCELA a prévia;
// o "a gravar" dos SKUs e este são mutuamente exclusivos (`podeRegerarRef`, ref-regerar.ts).
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  RPC_REF_REGERAR_PREVIA, TEXTO_MOTIVO_REF, TEXTO_REF_JA_NO_FORMATO, TEXTO_REF_PREVIA_CANCELADA, lerPreviaRefRegerar, mesmaEntradaRef,
  type EntradaRef, type PreviaRefRegerar,
} from "@/lib/ref-regerar";
import type { SkusAGravarApi } from "./useSkusModelo";

export type RefPendente = {
  /** a REF que o Salvar vai gravar (e que a prévia de SKUs usa) */
  refNova: string;
  /** a REF de antes (para "era X") */
  refAntes: string;
  /** a pessoa confirmou trocar uma REF digitada à mão (o servidor exige o flag) */
  confirmaManual: boolean;
  /** outros cards da família: só o aviso — NENHUM é tocado */
  irmaos: number;
  /** o rascunho no instante da prévia: mudar qualquer um destes CANCELA a prévia */
  capturado: EntradaRef;
};

export type ResultadoConsulta =
  | { tipo: "iniciado" }
  | { tipo: "confirmar"; previa: PreviaRefRegerar }
  | { tipo: "recusa" | "igual" | "erro" };

export function useRegerarRef(o: { modeloId: string | null; aGravar: SkusAGravarApi; entrada: EntradaRef }) {
  const [pendente, setPendente] = useState<RefPendente | null>(null);
  const [consultando, setConsultando] = useState(false);
  const ref = useRef(pendente);
  ref.current = pendente;
  const gravando = useRef(false);

  const iniciar = (previa: PreviaRefRegerar, confirmaManual: boolean): void => {
    if (!previa.pode || !previa.refNova) return;
    const proximo: RefPendente = {
      refNova: previa.refNova, refAntes: previa.refAtual, confirmaManual, irmaos: previa.irmaos,
      capturado: { ref: o.entrada.ref, categoria: o.entrada.categoria, sub1: o.entrada.sub1 },
    };
    ref.current = proximo;
    setPendente(proximo);
    o.aGravar.pedirRegerar(); // liga a prévia de SKUs ('regerar') com a REF nova e acende o "não salvo"
  };

  /** Clique no botão: pede a prévia ao servidor. Recusa/igual/erro viram toast; REF manual devolve `confirmar` (a seção abre o AlertDialog). */
  const consultar = async (): Promise<ResultadoConsulta> => {
    if (!o.modeloId) return { tipo: "erro" };
    setConsultando(true);
    try {
      const { data, error } = await supabase.rpc(RPC_REF_REGERAR_PREVIA as any, { _modelo_id: o.modeloId });
      if (error) throw error;
      const previa = lerPreviaRefRegerar(data);
      if (!previa.pode) {
        toast.error(TEXTO_MOTIVO_REF[previa.motivo ?? "desconhecido"]);
        return { tipo: "recusa" };
      }
      if (!previa.muda) {
        toast.info(TEXTO_REF_JA_NO_FORMATO);
        return { tipo: "igual" };
      }
      if (previa.tipoRef === "manual") return { tipo: "confirmar", previa };
      iniciar(previa, false);
      return { tipo: "iniciado" };
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível calcular a REF — tente de novo."));
      return { tipo: "erro" };
    } finally {
      setConsultando(false);
    }
  };

  /** "Desfazer prévia": some a REF a gravar e a prévia de SKUs; nada foi gravado. */
  const desfazer = (): void => {
    ref.current = null;
    setPendente(null);
    o.aGravar.desfazerPrevia();
  };
  /** Depois do Salvar gravar (ou desistir): só limpa o estado (o "a gravar" dos SKUs é limpo por quem aplicou). */
  const limpar = (): void => {
    ref.current = null;
    setPendente(null);
  };

  // Digitar a REF / mudar categoria ou subcategoria 1 no rascunho cancela a prévia (ela foi calculada sobre o estado SALVO).
  useEffect(() => {
    if (!pendente || gravando.current) return;
    if (mesmaEntradaRef(pendente.capturado, o.entrada)) return;
    desfazer();
    toast.info(TEXTO_REF_PREVIA_CANCELADA);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendente, o.entrada.ref, o.entrada.categoria, o.entrada.sub1]);

  // Rede de segurança: se o "Regerar" da prévia de SKUs foi desfeito por fora (botão "Desfazer prévia" do banner), a REF a gravar vai junto.
  useEffect(() => {
    if (pendente && !o.aGravar.atual().regerar) limpar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendente, o.aGravar.aGravar.regerar]);

  return {
    pendente,
    consultando,
    consultar,
    iniciar,
    desfazer,
    limpar,
    /** leitura síncrona — o Salvar roda no onSuccess do save, fora do ciclo de render */
    atual: () => ref.current,
    /** durante o `regerar_ref_card` o eco do Realtime pode trocar a REF do rascunho: não é "a pessoa mexeu" */
    marcarGravando: (v: boolean) => { gravando.current = v; },
  };
}
export type RegerarRefApi = ReturnType<typeof useRegerarRef>;
