// Integração — "Nova chave" em 2 passos (mockup 7d/7e): (1) nome → Criar; (2) a chave aparece SÓ UMA VEZ, com Copiar.
// O servidor guarda só o SHA-256 (D17); fechar o passo 2 sem confirmar pede "você copiou a chave?" (a chave nunca
// fica em cache/query/log depois de fechado — `criada` é estado LOCAL do componente, que desmonta ao fechar).
//
// Fix round 1 (task-15-review.md I1 + task-15-code-review.md I2/m1-m4/m11):
// - m1 (code review): fechar durante "Criando…" (Cancelar, Esc, clique fora) desmontava o diálogo com a RPC ainda
//   em voo — a chave era criada mas NUNCA mostrada (o `setCriada` virava no-op num componente já desmontado), e uma
//   chave "fantasma" (nunca usada) aparecia na lista. Fix: Cancelar desabilita durante `criando`, e `tentarFechar`
//   ignora qualquer tentativa de fechar (X/Esc/clique fora/onOpenChange) nesse intervalo.
// - m2 (code review): a resposta da RPC não era validada — se viesse sem `chave` (ou `chave` vazia/não-string), a
//   tela mostraria uma chave em branco como se fosse válida, e a chave REAL (se criada) se perderia sem aviso.
//   Fix: valida `typeof o?.chave === "string" && o.chave !== ""` antes de aceitar; senão mostra um erro orientando
//   a checar a lista e revogar pelo `final`, se necessário.
// - m3 (code review): a confirmação "você copiou?" aparecia mesmo depois de copiar com SUCESSO (nenhuma flag
//   `copiada`), e o aviso de guardar a chave estava duplicado (descrição do dialog + caixa âmbar). Fix: só pergunta
//   se ainda NÃO copiou com sucesso nesta sessão do diálogo; o aviso aparece 1x só (a caixa âmbar).
// - m4 (code review): o fallback de cópia (sem `navigator.clipboard`) só SELECIONAVA o texto — nunca tentava
//   copiar de fato. Fix: `document.execCommand("copy")` depois do `select()`, ainda dentro do clique (síncrono);
//   se falhar também, o toast orienta a copiar à mão.
// - m11 (code review): nada mostrava de qual LOJA é a chave — o super admin opera várias lojas pelo
//   TenantSwitcher, e a chave pertence à loja ATIVA no servidor. Fix: `useTenantBranding().nome` no título/
//   descrição dos dois passos.
// - I2 (code review) + item 2 do pedido do controlador: enquanto a chave está visível, a ABA conta como suja —
//   reportado ao pai via `onVisibilidadeChave` (o pai agrega com o dirty da Configuracoes num ÚNICO
//   `useAbaSuja("api", …)`; duas chamadas concorrentes se sobrescreveriam).
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useTenantBranding } from "@/hooks/useTenantBranding";
import { mensagemErro } from "@/lib/erro-mensagem";
import { TEXTO_FECHAR_SEM_COPIAR, TEXTO_NOVA_CHAVE_GUARDE } from "@/lib/integracao/api-tela";
import { invalidarIntegracao } from "./useIntegracao";

export function NovaChaveDialog({ onFechar, onVisibilidadeChave }: { onFechar: () => void; onVisibilidadeChave?: (visivel: boolean) => void }) {
  const tenantId = useActiveTenantId();
  const lojaNome = useTenantBranding().nome;
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [criada, setCriada] = useState<{ nome: string; chave: string } | null>(null);
  const [criando, setCriando] = useState(false);
  const [copiada, setCopiada] = useState(false);
  const [pedirConfirmacao, setPedirConfirmacao] = useState(false);
  // I2/item 2: reporta ao pai (ApiAba) enquanto a chave está visível — some no cleanup (fechar ou desmontar).
  useEffect(() => {
    onVisibilidadeChave?.(criada !== null);
  }, [criada, onVisibilidadeChave]);
  useEffect(() => () => onVisibilidadeChave?.(false), [onVisibilidadeChave]);
  const criar = async () => {
    setCriando(true);
    try {
      const { data, error } = await supabase.rpc("integracao_chave_criar" as any, { _nome: nome.trim() });
      if (error) throw error;
      // m2 (code review): valida a resposta ANTES de aceitar — uma resposta sem `chave` (ou vazia) nunca deve
      // parecer uma chave válida na tela. A chave (se a RPC de fato criou uma linha) fica listada normalmente em
      // "Chaves de API" com "Nunca usada" — o super admin pode revogá-la pelo nome/final se precisar.
      const o = data as { nome?: unknown; chave?: unknown; final?: unknown } | null;
      if (!o || typeof o.chave !== "string" || o.chave === "") {
        toast.error("A chave foi criada, mas o servidor não devolveu o valor dela. Veja a lista de chaves e revogue esta se necessário.");
        void qc.invalidateQueries({ queryKey: ["integracao-chaves", tenantId] });
        invalidarIntegracao(qc, tenantId);
        return;
      }
      setCriada({ nome: typeof o.nome === "string" ? o.nome : nome.trim(), chave: o.chave });
      void qc.invalidateQueries({ queryKey: ["integracao-chaves", tenantId] });
      invalidarIntegracao(qc, tenantId);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível criar a chave."));
    } finally {
      setCriando(false);
    }
  };
  const copiar = async () => {
    if (!criada) return;
    try {
      await navigator.clipboard.writeText(criada.chave);
      toast.success("Chave copiada.");
      setCopiada(true);
    } catch {
      // m4 (code review): o fallback tentava só SELECIONAR o texto, nunca copiar de fato — `execCommand("copy")`
      // (ainda síncrono, dentro do clique) copia de verdade em navegadores sem `navigator.clipboard` (contexto não
      // seguro/permissão negada). Se ISSO também falhar, orienta a copiar manualmente.
      const el = document.getElementById("integracao-chave-gerada") as HTMLInputElement | null;
      el?.focus();
      el?.select();
      let copiouFallback = false;
      try {
        copiouFallback = document.execCommand("copy");
      } catch {
        copiouFallback = false;
      }
      if (copiouFallback) {
        toast.success("Chave copiada.");
        setCopiada(true);
      } else {
        toast.error("Não foi possível copiar — selecione o texto e copie à mão.");
      }
    }
  };
  // Fechar o passo 2 (a chave já foi gerada) sem confirmar pede "você copiou a chave?" — a chave nunca fica em
  // nenhum cache/query/log depois de fechado: `criada` é estado local deste componente, que desmonta ao fechar
  // (nada grava a chave em outro lugar; a invalidação acima já rodou, e ela invalida só ["integracao-chaves"], que
  // nunca leva a chave em si — só id/nome/final, conforme `integracao_chaves_listar`/D32).
  const tentarFechar = () => {
    // m1 (code review): nunca fecha enquanto a RPC de criação está em voo (Cancelar já desabilita, mas Esc/clique
    // fora/onOpenChange chegam aqui de qualquer jeito).
    if (criando) return;
    // m3 (code review): já copiou com sucesso nesta sessão do diálogo → fecha direto, sem perguntar de novo.
    if (criada && !copiada) setPedirConfirmacao(true);
    else onFechar();
  };
  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) tentarFechar(); }}>
        <DialogContent className="max-w-md">
          {!criada ? (
            <>
              <DialogHeader>
                <DialogTitle>Nova chave{lojaNome ? ` — loja ${lojaNome}` : ""}</DialogTitle>
                <DialogDescription>Dê um nome que diga para que serve (ex.: ERP Principal).</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1">
                <Label htmlFor="integracao-nome-chave">Nome da chave</Label>
                <Input id="integracao-nome-chave" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} disabled={criando} />
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" disabled={criando} onClick={onFechar}>Cancelar</Button>
                <Button type="button" disabled={nome.trim() === "" || criando} onClick={() => void criar()}>{criando ? "Criando…" : "Criar"}</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Chave "{criada.nome}" criada{lojaNome ? ` — loja ${lojaNome}` : ""}</DialogTitle>
                {/* m3 (code review): o aviso de guardar a chave aparece SÓ na caixa âmbar abaixo — a descrição do
                    dialog não repete o mesmo texto. */}
              </DialogHeader>
              <div className="grid gap-1">
                <Label htmlFor="integracao-chave-gerada">Chave gerada</Label>
                <div className="flex items-center gap-2">
                  <Input id="integracao-chave-gerada" readOnly value={criada.chave} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" onClick={() => void copiar()}><Copy className="h-4 w-4" />Copiar</Button>
                </div>
              </div>
              <p className="rounded-md bg-[var(--tone-warning-bg)] p-3 text-sm text-[var(--tone-warning-fg)]">{TEXTO_NOVA_CHAVE_GUARDE}</p>
              <DialogFooter>
                <Button type="button" onClick={tentarFechar}>Concluído</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={pedirConfirmacao} onOpenChange={(o) => { if (!o) setPedirConfirmacao(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Você copiou a chave?</AlertDialogTitle>
            <AlertDialogDescription>{TEXTO_FECHAR_SEM_COPIAR}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e copiar</AlertDialogCancel>
            <AlertDialogAction onClick={onFechar}>Sim, pode fechar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
