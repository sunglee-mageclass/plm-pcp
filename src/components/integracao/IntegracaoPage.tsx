// Integração + API — tela (spec §6). Abas por papel: src/lib/integracao/abas.ts.
//
// revisão T15 #1 (code-review I1, "wrong-store save"): o `TenantSwitcher` troca a loja NO SERVIDOR
// (`callSet`) ANTES de navegar (`navigate("/home")`) — com a aba Campos/API suja, `useUnsavedGuard`
// bloqueia essa navegação, e se o super admin escolhe "continuar editando", a página fica aberta com
// `tenantId` = loja NOVA mas o rascunho de cada aba (`ed`/`rascunhos`) continua sendo o da loja
// ANTIGA. Um Salvar nesse instante grava o rascunho da loja antiga NA loja nova (o rev muitas vezes
// bate, porque toda loja que nunca salvou tem rev 0 — o P0409 não pega esse caso). Fix: TODO o
// conteúdo da aba ativa (e a guarda `sujas`) é remontado por `key={tenantId}` — trocar de loja
// desmonta qualquer rascunho de qualquer aba, sem exceção (defesa em profundidade: `CamposAba`/
// `ApiAba` TAMBÉM guardam `tenantId` no `Edicao` congelado e recusam salvar se ele mudou, ver os
// próprios arquivos). Se havia algo sujo no momento da troca, mostra um toast em PT avisando que o
// rascunho foi descartado.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Construction } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useAuth } from "@/hooks/useAuth";
import { ROTULO_ABA, abasVisiveis, type Aba } from "@/lib/integracao/abas";
import { GuardaIntegracaoContext } from "./guard";
import { ProdutosAba } from "./ProdutosAba";
import { CamposAba } from "./CamposAba";
import { ApiAba } from "./ApiAba";

function AbaPendente() {
  return <EmptyState icon={Construction} title="Em construção" description="Esta aba chega nas próximas tasks do plano da Integração." />;
}
// Cada task da tela troca a sua entrada (Tasks 12b, 14, 15, 16 e 17).
const CONTEUDO_ABA: Record<Aba, ComponentType> = {
  produtos: ProdutosAba,
  campos: CamposAba,
  api: ApiAba,
  manual: AbaPendente,
  log: AbaPendente,
};

export function IntegracaoPage() {
  const { isSuperAdmin, user } = useAuth();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const abas = abasVisiveis(isSuperAdmin);
  const [aba, setAba] = useState<Aba>("produtos");
  const [sujas, setSujas] = useState<Partial<Record<Aba, boolean>>>({});
  const informarSujo = useCallback(
    (a: Aba, s: boolean) => setSujas((x) => (Boolean(x[a]) === s ? x : { ...x, [a]: s })),
    [],
  );
  // revisão T15 (n1, code-review "Re-check round 1"): canal PARALELO a `informarSujo` — só a aba "api" usa (ver
  // `ApiAba.tsx`), reportando se a chave nova está VISÍVEL (ainda não copiada) no momento da troca de loja. Vira
  // um `ref` (não precisa de re-render próprio; só é lido dentro do efeito de troca de loja abaixo).
  const chaveVisivelRef = useRef(false);
  const informarChaveVisivel = useCallback((v: boolean) => { chaveVisivelRef.current = v; }, []);
  const guarda = useMemo(() => ({ informarSujo, informarChaveVisivel }), [informarSujo, informarChaveVisivel]);
  const dirty = Object.values(sujas).some(Boolean);
  // revisão T15 #1: `dirty` precisa ser lido no MOMENTO da troca de loja, não no próximo render —
  // por isso um ref espelha o valor mais atual (o efeito abaixo dispara só quando `tenantId` muda,
  // então ele não pode depender de `dirty` no array de deps sem também disparar a cada toggle).
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const tenantIdRef = useRef(tenantId);
  useEffect(() => {
    if (tenantIdRef.current === tenantId) return;
    tenantIdRef.current = tenantId;
    if (dirtyRef.current) {
      // revisão T15 (n1, code-review "Re-check round 1"): se o motivo específico de "sujo" era uma chave nova
      // AINDA VISÍVEL (não copiada) na aba API, o toast genérico "alterações descartadas" é enganoso — a chave
      // NÃO se perdeu (ela foi gravada no servidor no "Criar", só o valor em texto claro é que nunca mais aparece
      // de novo nesta tela); ela continua ATIVA na loja anterior até alguém revogá-la. Mensagem específica nesse
      // caso, genérica em qualquer outro.
      if (chaveVisivelRef.current) {
        toast.warning(
          "A chave nova não foi copiada e a loja mudou — ela continua ATIVA; revogue-a na aba API da loja anterior se não for usá-la.",
        );
      } else {
        toast.warning("A loja mudou — as alterações não salvas da loja anterior foram descartadas.");
      }
    }
    // O remonte por `key={tenantId}` abaixo já desmonta/recria cada aba (limpando o rascunho local
    // de cada uma via seus próprios efeitos de cleanup); aqui só falta zerar o mapa de "sujo" desta
    // página, para a guarda de navegação (`useUnsavedGuard`) não continuar bloqueando por causa de
    // um estado que já não existe mais.
    setSujas({});
    chaveVisivelRef.current = false;
  }, [tenantId]);
  // revisão T15 (n2, code-review "Re-check round 1"): sem isto, uma troca de loja com a aba suja mostrava OS DOIS
  // avisos ao mesmo tempo — o `useBlocker` (abaixo) intercepta o `navigate({to:"/home"})` que o `TenantSwitcher`
  // dispara logo após confirmar a troca no servidor, mas o `tenantId` (do `useActiveTenantId()`, via hook) que
  // ESTE componente ainda enxerga NAQUELE clique é o VELHO — o `TenantSwitcher` faz `await
  // qc.refetchQueries({queryKey:["active-tenant-id"]})` ANTES de navegar, e esse `await` já escreveu o valor NOVO
  // no cache do QueryClient no instante em que resolve; só a NOTIFICAÇÃO aos observers (o que faria este
  // componente re-renderizar com o `tenantId` novo) é que TanStack Query agenda pra um tick seguinte
  // (`notifyManager` usa `setTimeout(0)`). Ou seja: quando o router chama `shouldBlockFn` (síncrono — não dá pra
  // `await` um `confirmarLojaAtiva` aqui dentro), o CACHE já tem o tenant novo, mesmo que o `tenantId` desta
  // render ainda seja o velho. `navPermitida` lê o cache DIRETO (`qc.getQueryData`, a MESMA key/formato de
  // `useActiveTenantId`) — se já diverge do `tenantId` que esta render capturou, a troca já aconteceu de
  // verdade e o remonte por `key={tenantId}` + o toast do efeito acima JÁ SÃO a confirmação de descarte; a
  // navegação que segue nunca precisa perguntar de novo. Qualquer OUTRA navegação (Voltar, trocar de item de
  // menu) não muda esse cache, então continua pedindo confirmação normalmente.
  const navPermitida = useCallback(() => {
    if (!user?.id) return false;
    const tenantEmCache = qc.getQueryData<string>(["active-tenant-id", user.id]);
    return !!tenantEmCache && tenantEmCache !== tenantId;
  }, [qc, user?.id, tenantId]);
  const { requestAction, confirm } = useUnsavedGuard({ dirty, blockNav: true, navPermitida });
  const atual = abas.includes(aba) ? aba : "produtos";
  return (
    <GuardaIntegracaoContext.Provider value={guarda}>
      <div className="space-y-4 p-4 pb-24 md:p-6">
        <Breadcrumb items={[{ label: "Sistema" }, { label: "Integração" }]} />
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-semibold">Integração</h1>
          <UnsavedIndicator show={dirty} />
        </div>
        <Tabs value={atual} onValueChange={(v) => { if (v !== atual) requestAction(() => setAba(v as Aba)); }}>
          <TabsList className="max-w-full overflow-x-auto">
            {abas.map((a) => (
              <TabsTrigger key={a} value={a}>{ROTULO_ABA[a]}</TabsTrigger>
            ))}
          </TabsList>
          {abas.map((a) => {
            const C = CONTEUDO_ABA[a];
            return (
              <TabsContent key={a} value={a} className="mt-4">
                {/* revisão T15 #1: `key={tenantId}` força o React a desmontar e recriar a aba
                    inteira ao trocar de loja — nenhum rascunho (ed/rascunhos/estado local) de
                    NENHUMA aba sobrevive à troca, mesmo se o super admin cancelar o "Descartar
                    alterações?" da guarda de navegação. */}
                <C key={tenantId} />
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
      <UnsavedChangesGuard confirm={confirm} />
    </GuardaIntegracaoContext.Provider>
  );
}
