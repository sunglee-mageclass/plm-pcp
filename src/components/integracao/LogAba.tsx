// Integração — aba Log (mockup 8; N11 por papel — o servidor já filtra: não-super recebe só ações de PRODUTO).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { mensagemErro } from "@/lib/erro-mensagem";
import { ROTULO_ACAO, TEXTO_LOG_NAO_SUPER, lerLog, textoDetalhe } from "@/lib/integracao/log";
import { fmtDataHora } from "@/lib/integracao/produtos";
import { chaveLog } from "./useIntegracao";

export function LogAba() {
  const tenantId = useActiveTenantId();
  const tz = useStoreTimezone();
  const [pagina, setPagina] = useState(1);
  const q = useQuery({
    queryKey: [...chaveLog(tenantId), pagina],
    enabled: !!tenantId,
    // Fix round 1 (task-17-18-review.md Minor 1): placeholder INLINE por tenant, mesmo padrão de
    // `useIntegracaoLista` (produtos.ts) — mantém o dado anterior só quando a query cujo dado seria reaproveitado é
    // DESTE mesmo tenant (queryKey[1] é sempre o tenantId, ver `chaveLog`). Com `tenantId === ""` (releitura de
    // active-tenant-id falhou) a query fica `enabled:false`, mas o placeholder mantém a última página conhecida —
    // nunca vaza a loja X pra tela sob a loja Y.
    placeholderData: (prev, query) => (!tenantId || query?.queryKey[1] === tenantId ? prev : undefined),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("integracao_log_listar" as any, { _pagina: pagina });
      if (error) throw error;
      return lerLog(data);
    },
  });
  const d = q.data;
  const totalPaginas = d ? Math.max(1, Math.ceil(d.total / d.porPagina)) : 1;
  return (
    <div className="space-y-3">
      {d && !d.superAdmin && <p className="text-sm text-muted-foreground">{TEXTO_LOG_NAO_SUPER}</p>}
      {/* Fix round 1 (Important 1): o banner de erro fica ACIMA da tabela e NUNCA a substitui — uma falha de
          refetch (relist depois de integrar/desfazer, ou refetchOnWindowFocus com a rede fora) preserva o Log já
          carregado. Só quando não há dado nenhum (1ª carga falhando) é que não existe tabela para mostrar embaixo. */}
      {q.isError && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{mensagemErro(q.error, "Erro ao carregar o Log.")}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void q.refetch()}>Tentar de novo</Button>
        </div>
      )}
      {d && (
        <div className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Ação</th><th className="px-3 py-2">Quem</th><th className="px-3 py-2">Quando</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Detalhe</th></tr>
            </thead>
            <tbody>
              {d.linhas.map((l) => (
                <tr key={l.id} className="border-t align-top">
                  <td className="whitespace-nowrap px-3 py-2">{ROTULO_ACAO[l.acao] ?? l.acao}</td>
                  <td className="px-3 py-2">{l.quem}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDataHora(l.quando, tz, true)}</td>
                  <td className="px-3 py-2">
                    {l.modeloId ? (
                      <Link to="/criacao/planejamento" search={{ modelo: l.modeloId }} className="text-primary hover:underline">{l.modeloNome ?? "produto"}</Link>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">{textoDetalhe(l)}</td>
                </tr>
              ))}
              {d.linhas.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Nada registrado ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {!d && !q.isError && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {d && d.total > d.porPagina && (
        <div className="flex items-center justify-end gap-2 text-sm">
          {/* Minor 2: mesmo numa página sem dado nenhum ainda (falha de carga isolada dessa página), "Anterior"
              segue habilitado por posição (`pagina > 1`) — nunca preso numa página N+1 morta. */}
          <Button type="button" size="sm" variant="outline" disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>Anterior</Button>
          <span className="text-muted-foreground">
            Página {pagina} de {totalPaginas}
            {q.isFetching && <span className="ml-1 text-xs">· Atualizando…</span>}
          </span>
          <Button type="button" size="sm" variant="outline" disabled={pagina >= totalPaginas} onClick={() => setPagina((n) => n + 1)}>Próxima</Button>
        </div>
      )}
      {!d && q.isError && pagina > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button type="button" size="sm" variant="outline" onClick={() => setPagina((n) => n - 1)}>Anterior</Button>
        </div>
      )}
    </div>
  );
}
