import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type LinhaOpt = { id: string; nome: string };
export type StatusProdutoSel = "pendente" | "reprovado";

/** Opções do seletor de Linha dos cards de Produto Acabado/Importado (a tabela `linhas` não tem `ativo`: traz todas, por nome).
 *  Mesma leitura do seletor de Linha do Plan. Tecido (`ModelCard`, F2 E). */
export function useLinhasOpts() {
  return useQuery({
    queryKey: ["produto-card-linhas-opts"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("linhas" as any) as any).select("id, nome").order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as LinhaOpt[];
    },
  });
}

/**
 * Paridade PA/PI ↔ Plan. Tecido (nov/2026, Task 6) — a linha de seletores do card do Produto Acabado/Importado:
 *  - **Linha SEMPRE** (com e sem card — complemento "Linha também sem card"): `produtos_*.linha_id`, espelhado com `modelos.linha_id`
 *    quando há card (o banco mantém os dois iguais).
 *  - **Pendente/Reprovado SÓ sem card**: com card o status é o do kanban — o `selo` (F4a, `MoverEtapaMenu`) — e NUNCA coexiste
 *    com o Select de status (decisão do dono: um só controle de status por vez). Sem card o `selo` é ignorado.
 * Só ALTERA o rascunho (`onLinha`/`onStatus`); quem grava é o Salvar. Fora do <button> do cabeçalho do card (o gatilho do selo
 * é um <button>: botão dentro de botão não existe em HTML).
 */
export function ProdutoLinhaStatusBloco({
  temCard, selo, linhaId, statusProduto, linhasOpts, onLinha, onStatus, recuado,
}: {
  temCard: boolean;
  /** Selo do kanban + "Mover para…" já montado pelo card; renderizado SÓ com card. Ausente (sem kanban) = nada. */
  selo?: ReactNode;
  linhaId: string | null;
  statusProduto: StatusProdutoSel | null;
  linhasOpts: LinhaOpt[];
  onLinha: (linhaId: string | null) => void;
  onStatus: (status: StatusProdutoSel) => void;
  /** Card com checkbox de seleção (alinha com o recuo `pl-8` do cabeçalho). */
  recuado?: boolean;
}) {
  const mostraSelo = temCard && !!selo;
  const mostraStatus = !temCard;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 ${recuado ? "pl-8" : ""}`} data-testid="produto-linha-status">
      {mostraSelo && selo}
      {mostraStatus && (
        <div className="flex items-center gap-1">
          <span className="shrink-0 text-[10px] text-muted-foreground">Status</span>
          <Select
            value={statusProduto ?? "pendente"}
            onValueChange={(v) => { if (v === "pendente" || v === "reprovado") onStatus(v); }}
          >
            <SelectTrigger
              data-testid="produto-status-select"
              aria-label="Status do produto"
              title="Status do produto (sem card). Com card, o status é o da etapa do kanban."
              className="h-7 min-w-[7rem] text-[11px] max-md:h-11 max-md:text-base"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="reprovado">Reprovado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex items-center gap-1">
        <span className="shrink-0 text-[10px] text-muted-foreground">Linha</span>
        <Select
          value={linhaId ?? "__none__"}
          onValueChange={(v) => onLinha(v === "__none__" ? null : v)}
        >
          <SelectTrigger
            data-testid="produto-linha-select"
            aria-label="Linha"
            className="h-7 min-w-[7rem] text-[11px] max-md:h-11 max-md:text-base"
          >
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">—</SelectItem>
            {linhasOpts.map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
