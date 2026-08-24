import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Nº de Pedido — hook compartilhado pelos 3 diálogos de OC (Tecido/Aviamento/Insumo).
 *
 * Preview ao vivo: ao escolher fornecedor + material (1º item), chama a RPC
 * `proximo_numero_oc` e preenche o campo Nº de Pedido automaticamente. Se o usuário
 * digitar manualmente, a trava (`editadoManual`) impede que o preview sobrescreva —
 * até o campo ficar vazio de novo (reabilita o automático).
 *
 * O hook NÃO possui o estado do número — quem chama passa `numero`/`setNumero` (os 3
 * diálogos têm estilos de estado diferentes: OC Tecido/Aviamento usam um objeto Draft;
 * OC Insumo usa `useState` plano). Ele só AUGMENTA esse estado com o preview automático.
 */

const PLACEHOLDER_POR_TIPO: Record<"tecido" | "aviamento" | "insumo", string> = {
  tecido: "T-… (escolha fornecedor e tecido)",
  aviamento: "A-… (escolha fornecedor e aviamento)",
  insumo: "I-… (escolha fornecedor e insumo)",
};

export function placeholderNumeroPedido(tipo: "tecido" | "aviamento" | "insumo"): string {
  return PLACEHOLDER_POR_TIPO[tipo];
}

export function useNumeroPedidoAuto(opts: {
  tipo: "tecido" | "aviamento" | "insumo";
  fornecedorId: string | null;
  materialId: string | null; // material do 1º item
  numero: string;
  setNumero: (v: string) => void;
  ativo: boolean; // só em modo CRIAÇÃO (não edição)
}): { onNumeroChange: (v: string) => void; placeholder: string } {
  const { tipo, fornecedorId, materialId, setNumero, ativo } = opts;

  // Ref (não state) para não causar re-render a cada edição — só precisa ser lida
  // dentro do effect, nunca precisa disparar re-render por si só.
  const editadoManual = useRef(false);

  const onNumeroChange = (v: string) => {
    editadoManual.current = v.trim() !== "";
    setNumero(v);
  };

  useEffect(() => {
    if (!ativo) return;
    if (editadoManual.current) return;

    if (!fornecedorId || !materialId) {
      setNumero("");
      return;
    }

    const timeoutId = setTimeout(() => {
      supabase
        .rpc("proximo_numero_oc" as any, {
          _tipo: tipo,
          _fornecedor_id: fornecedorId,
          _material_id: materialId,
        })
        .then(({ data, error }: { data: unknown; error: unknown }) => {
          if (error) return;
          setNumero((data as string | null) ?? "");
        });
    }, 300);

    return () => clearTimeout(timeoutId);
    // setNumero é assumido estável o bastante (setter passado pelo chamador); numero/setNumero
    // de propósito FORA das deps — o effect ESCREVE em numero, incluí-lo loopa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, fornecedorId, materialId, ativo]);

  return { onNumeroChange, placeholder: placeholderNumeroPedido(tipo) };
}
