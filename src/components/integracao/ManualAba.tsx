// Integração — aba "Manual da API" (SÓ super admin — P-81 A; mockup 7f/9b). Índice ao lado + os 9 tópicos (a tela só existe
// em tela larga — P-87). Conteúdo em manual-conteudo.ts; comandos com o endereço do PRÓPRIO site.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { TEXTO_SO_SUPER } from "@/lib/integracao/campos";
import { Blocos as BlocosGenerico, ManualIndiceSecoes } from "@/components/shared/manual/ManualRenderer";
import type { Bloco as BlocoGenerico } from "@/components/shared/manual/tipos";
import { montarManual, type Bloco, type SecaoManual } from "./manual-conteudo";
import { ExemploDialog } from "./ExemploDialog";

// Blocos da Integração: trata o caso `exemplo` (botão "Ver resposta de exemplo" → ExemploDialog) e delega TODO o resto ao
// renderizador genérico compartilhado (@/components/shared/manual) — mesmo visual e comportamento de antes.
function Blocos({ blocos, onExemplo }: { blocos: Bloco[]; onExemplo: () => void }) {
  return (
    <div className="space-y-3 text-sm">
      {blocos.map((b, i) =>
        b.tipo === "exemplo"
          ? <Button key={i} type="button" variant="outline" onClick={onExemplo}>Ver resposta de exemplo (modo teste)</Button>
          : <BlocosGenerico key={i} blocos={[b as BlocoGenerico]} />,
      )}
    </div>
  );
}

// Dono (28/set): no site publicado o Manual usa o PRÓPRIO endereço do site (se o domínio mudar, acompanha sozinho); só
// quando aberto no Mac (localhost/127.0.0.1 — :5173/:5188) cai no endereço público, porque o ERP nunca chama o Mac.
export const ENDERECO_PUBLICO_API = "https://sistrama.sung-lee.workers.dev";
export function enderecoDoManual(origem: string): string {
  try {
    const h = new URL(origem).hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return ENDERECO_PUBLICO_API;
    return origem;
  } catch {
    return ENDERECO_PUBLICO_API;
  }
}

export function ManualAba() {
  // Release A2 (P-224 B+): os comandos levam loja=<código da loja ATIVA> (a dona das chaves da aba API)
  const tenantId = useActiveTenantId();
  const secoes: SecaoManual[] = useMemo(
    () => montarManual(enderecoDoManual(typeof window === "undefined" ? "" : window.location.origin), tenantId || null),
    [tenantId],
  );
  const [exemplo, setExemplo] = useState(false);
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-[var(--tone-info-bg)] p-3 text-sm text-[var(--tone-info-fg)]">{TEXTO_SO_SUPER}</p>
      <p className="text-sm text-muted-foreground">Linguagem simples, para o dono E para o dev.</p>
      <ManualIndiceSecoes
        secoes={secoes}
        prefixoAncora="manual"
        renderBlocos={(blocos) => <Blocos blocos={blocos} onExemplo={() => setExemplo(true)} />}
      />
      {exemplo && <ExemploDialog onFechar={() => setExemplo(false)} />}
    </div>
  );
}
