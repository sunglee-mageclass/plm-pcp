// Prévia pedida ao servidor com atraso (Salvar por card, Onda 2 da Camada intermediária — "nada grava antes do Salvar").
// Pede a uma RPC só-leitura (STABLE) o efeito de uma edição ainda não salva e guarda `{resultado, assinatura}`; a
// `assinatura` (jsonb `{..., assinatura}`) é a que o Salvar manda de volta para o servidor conferir que nada mudou.
// Estilo de `useChaveAtrasada`/`useSkusModelo`: atraso por `setTimeout` + guarda de efeito (`vivo`) — resposta de um efeito
// já limpo (args novos, desabilitado, desmontado) é IGNORADA. Falha da RPC NUNCA quebra a tela: resultado `null`.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface UsePreviaServidorOpcoes {
  /** nome da RPC de prévia (só leitura) */
  rpc: string;
  /** argumentos da RPC; comparados POR CONTEÚDO (objeto recriado a cada render não refaz a chamada) */
  args: Record<string, unknown>;
  /** false = não chama e limpa o resultado */
  habilitado: boolean;
  /** atraso em ms antes de chamar (padrão 300) */
  atrasoMs?: number;
}

export interface PreviaServidor<R> {
  resultado: R | null;
  /** `resultado.assinatura` quando é texto; senão null */
  assinatura: string | null;
  /** true do pedido (já no atraso) até a resposta */
  carregando: boolean;
}

export function usePreviaServidor<R = Record<string, unknown>>(
  { rpc, args, habilitado, atrasoMs = 300 }: UsePreviaServidorOpcoes,
): PreviaServidor<R> {
  const [resultado, setResultado] = useState<R | null>(null);
  const [carregando, setCarregando] = useState(false);
  // conteúdo dos args como chave estável (o objeto costuma ser recriado a cada render)
  const chave = JSON.stringify(args);
  const argsEstaveis = useMemo(() => JSON.parse(chave) as Record<string, unknown>, [chave]);

  useEffect(() => {
    if (!habilitado) {
      setResultado(null);
      setCarregando(false);
      return;
    }
    let vivo = true;
    setCarregando(true);
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc(rpc as any, argsEstaveis as any);
        if (!vivo) return;
        setResultado(error ? null : ((data ?? null) as R | null));
      } catch {
        if (!vivo) return;
        setResultado(null);
      } finally {
        if (vivo) setCarregando(false);
      }
    }, atrasoMs);
    return () => { vivo = false; clearTimeout(t); };
  }, [rpc, argsEstaveis, habilitado, atrasoMs]);

  const a = (resultado as { assinatura?: unknown } | null)?.assinatura;
  return { resultado, assinatura: typeof a === "string" ? a : null, carregando };
}
