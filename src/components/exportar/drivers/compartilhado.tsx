// Peças COMUNS dos drivers tecido/aviamento/insumo do Exportar dados: lista de opções da loja (categorias/materiais/tipos),
// o Select de filtro com "Todos" explícito e a chamada genérica da RPC do tipo. O produto tem as próprias (drivers/produto.tsx).
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { lerRespostaExport, SENTINELA_TODOS, type RespostaExport } from "./tipos";

export type OpcaoFiltro = { id: string; nome: string };

/** Opções de uma tabela de cadastro da LOJA ATIVA (queryKey com a loja; filtro explícito por `tenant_id`, não só por RLS —
 *  super admin enxerga todas as lojas pela RLS). Erro vira `isError` (a tela mostra "Tentar de novo"), nunca lista vazia calada. */
export function useOpcoesLoja(tabela: "categorias_tecido" | "categorias_aviamento" | "materiais_aviamento" | "tipos_insumo") {
  const tenantId = useActiveTenantId();
  return useQuery({
    queryKey: ["exportar-opcoes", tabela, tenantId],
    enabled: !!tenantId,
    retry: 1,
    queryFn: async (): Promise<OpcaoFiltro[]> => {
      const { data, error } = await (supabase as any).from(tabela).select("id, nome").eq("tenant_id", tenantId).order("nome");
      if (error) throw error;
      return (data ?? []) as OpcaoFiltro[];
    },
  });
}

/** Chama a RPC de export do tipo e normaliza a resposta. */
export async function chamarRpcExport(rpc: string, args: Record<string, unknown>): Promise<RespostaExport> {
  const { data, error } = await supabase.rpc(rpc as any, args as any);
  if (error) throw error;
  return lerRespostaExport(data);
}

/** Select de um filtro de recorte: "Todos" é uma escolha explícita (valor sentinela); `value` undefined = nada escolhido (placeholder). */
export function FiltroSelect(props: {
  id: string;
  rotulo: string;
  placeholder: string;
  rotuloTodos: string;
  value: string | undefined;
  opcoes: OpcaoFiltro[] | undefined;
  carregando: boolean;
  erro: boolean;
  onRetry: () => void;
  onChange: (v: string) => void;
  textoErro: string;
  textoVazio: string;
}) {
  const { id, rotulo, placeholder, rotuloTodos, value, opcoes, carregando, erro, onRetry, onChange, textoErro, textoVazio } = props;
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{rotulo}</Label>
      <Select value={value} onValueChange={onChange} disabled={!opcoes}>
        <SelectTrigger id={id} className="min-w-0 [&>span]:truncate">
          <SelectValue placeholder={carregando ? "Carregando…" : placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINELA_TODOS}>{rotuloTodos}</SelectItem>
          {(opcoes ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
      {erro && (
        <p className="text-xs text-destructive">
          {textoErro}{" "}
          <button type="button" className="underline" onClick={onRetry}>Tentar de novo</button>
        </p>
      )}
      {opcoes && opcoes.length === 0 && <p className="text-xs text-muted-foreground">{textoVazio}</p>}
    </div>
  );
}
