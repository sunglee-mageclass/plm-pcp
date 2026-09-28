// Integração + API — tela (spec §6). Abas por papel: src/lib/integracao/abas.ts.
//
// revisão T15 #1 (code-review I1, "wrong-store save"): o `TenantSwitcher` troca a loja NO SERVIDOR
// (`callSet`) ANTES de navegar (`navigate("/home")`) — com a aba Campos/API suja, `useUnsavedGuard`
// bloqueia essa navegação, e se o super admin escolhe "continuar editando", a página fica aberta com
// `tenantId` = loja NOVA mas o rascunho de cada aba (`ed`/`rascunhos`) continua sendo o da loja
// ANTIGA. Um Salvar nesse instante grava o rascunho da loja antiga NA loja nova (o rev muitas vezes
// bate, porque toda loja que nunca salvou tem rev 0 — o P0409 não pega esse caso). Fix: TODO o
// conteúdo da aba ativa (e a guarda `sujas`) é remontado por `key` = loja ativa (desde o fix round 4,
// a última loja NÃO vazia — ver N-1 abaixo) — trocar de loja
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

/** Troca de loja DE VERDADE (anterior e nova não vazias e diferentes), com o que estava na tela logo antes dela. */
type TrocaDeLoja = { para: string; dirty: boolean; chaveVisivel: boolean };

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
  // `ApiAba.tsx`), reportando se a chave nova está VISÍVEL (ainda não copiada) no momento da troca de loja.
  // Fix round 4 T15 (nit do "Re-check round 3"): virou ESTADO (era ref) — assim a troca de loja lê o valor no render
  // sem ler/escrever ref durante o render.
  const [chaveVisivel, setChaveVisivel] = useState(false);
  const informarChaveVisivel = useCallback((v: boolean) => setChaveVisivel(v), []);
  const guarda = useMemo(() => ({ informarSujo, informarChaveVisivel }), [informarSujo, informarChaveVisivel]);
  const dirty = Object.values(sujas).some(Boolean);
  // Fix round 4 T15 (N-1, code-review "Re-check round 3"): `useActiveTenantId` devolve "" quando a releitura de
  // `active-tenant-id` FALHA (ex.: refetch no `visibilitychange` com a rede ainda caída — o hook engole o erro e
  // assenta ""). Com `key={tenantId}` isso remontava TODAS as abas (X → "" → X: rascunhos de Produtos, Campos,
  // config da API e a chave nova visível perdidos) com um toast FALSO de "a loja mudou". "" não é loja: a página
  // guarda a ÚLTIMA loja NÃO vazia (`lojaEstavel`) e só ela conta como "a loja desta tela" — no `key`, no
  // `navPermitida` e na detecção de troca. Troca de loja = anterior E nova NÃO vazias e diferentes (X → "" → Y é
  // troca X → Y; a entrada inicial "" → X não é troca, não avisa). Durante o "" as gravações já são recusadas
  // (queries desabilitadas; `confirmarLojaAtiva("")` diverge do servidor), então manter o rascunho vivo é seguro.
  //
  // Fix round 4 T15 (nit do "Re-check round 3": escrita de ref durante o render): a loja anterior mora em ESTADO
  // derivado — o padrão do React para "guardar informação de renders anteriores" (setState DURANTE o render, com
  // condição que se desliga sozinha: depois do set, `tenantId === lojaEstavel`). O React descarta a saída deste
  // render e re-renderiza na hora com o estado novo ANTES de qualquer filho renderizar ou qualquer efeito rodar —
  // então `dirty`/`chaveVisivel` lidos aqui são os de ANTES da troca (o `key` ainda não desmontou nada; é o mesmo
  // motivo do snapshot do fix round 3, n1-R). Num render descartado (modo concorrente) a atualização é descartada
  // junto, sem sobrar nada num ref.
  const [lojaEstavel, setLojaEstavel] = useState(tenantId);
  const [trocaDeLoja, setTrocaDeLoja] = useState<TrocaDeLoja | null>(null);
  if (tenantId && tenantId !== lojaEstavel) {
    setLojaEstavel(tenantId);
    if (lojaEstavel) {
      setTrocaDeLoja({ para: tenantId, dirty, chaveVisivel });
      // O remonte por `key={lojaEstavel}` abaixo já desmonta/recria cada aba (o rascunho local de cada uma some com
      // ela); aqui zera o mapa de "sujo" desta página, para a guarda de navegação (`useUnsavedGuard`) não continuar
      // bloqueando por um estado que já não existe mais.
      setSujas({});
      setChaveVisivel(false);
    }
  }
  // Fix round 3 T15 (n2-R, code-review "Re-check round 2"): extraído pra função nomeada — chamado de DOIS lugares
  // (`navPermitida`, abaixo, E o efeito da troca de loja) porque nenhum dos dois sozinho cobre todo caso real: uma
  // troca de loja NA MESMA ABA em que `IntegracaoPage` continua montada dispara o efeito (o caminho antigo); mas se
  // a navegação que SEGUE a troca (`navigate({to:"/home"})` do `TenantSwitcher`) DESMONTA `IntegracaoPage` antes de
  // ele re-renderizar com o `tenantId` novo (ex.: a rota de destino não é mais `/integracao`), o efeito NUNCA chega
  // a rodar — o toast de descarte nunca aparecia. `navPermitida` roda ANTES da navegação ser permitida (então antes
  // de qualquer desmonte), então é o único lugar garantido de rodar nos DOIS casos. `avisadoRef` garante
  // EXATAMENTE UM toast por troca de loja, não importa qual dos dois call sites chega primeiro (o efeito ainda roda
  // quando a página NÃO desmonta — ex.: cancelar a navegação, ou uma troca que não passa pelo blocker de rota).
  const avisadoRef = useRef<string | null>(null);
  const avisarTrocaDeLoja = useCallback((novoTenantId: string, pendente: { dirty: boolean; chaveVisivel: boolean }) => {
    if (avisadoRef.current === novoTenantId) return;
    avisadoRef.current = novoTenantId;
    if (!pendente.dirty) return;
    // revisão T15 (n1, code-review "Re-check round 1"): se o motivo específico de "sujo" era uma chave nova
    // AINDA VISÍVEL (não copiada) na aba API, o toast genérico "alterações descartadas" é enganoso — a chave
    // NÃO se perdeu (ela foi gravada no servidor no "Criar", só o valor em texto claro é que nunca mais aparece
    // de novo nesta tela); ela continua ATIVA na loja anterior até alguém revogá-la. Mensagem específica nesse
    // caso, genérica em qualquer outro.
    if (pendente.chaveVisivel) {
      toast.warning(
        "A chave nova não foi copiada e a loja mudou — ela continua ATIVA; revogue-a na aba API da loja anterior se não for usá-la.",
      );
    } else {
      toast.warning("A loja mudou — as alterações não salvas da loja anterior foram descartadas.");
    }
  }, []);
  // Toast é efeito colateral: sai no commit, nunca no render. `trocaDeLoja` só muda de identidade numa troca de
  // loja DE VERDADE (objeto novo a cada uma), então o efeito roda uma vez por troca (`avisadoRef` deduplica
  // contra o aviso que o `navPermitida` já tenha dado).
  useEffect(() => {
    if (trocaDeLoja) avisarTrocaDeLoja(trocaDeLoja.para, trocaDeLoja);
  }, [trocaDeLoja, avisarTrocaDeLoja]);
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
  // `useActiveTenantId`) — se já diverge da loja que esta tela mostra, a troca já aconteceu de verdade e o remonte
  // por `key` + o toast JÁ SÃO a confirmação de descarte; a navegação que segue nunca precisa perguntar de novo.
  // Qualquer OUTRA navegação (Voltar, trocar de item de menu) não muda esse cache, então continua pedindo
  // confirmação normalmente.
  // Fix round 3 T15 (n2-R, code-review "Re-check round 2"): quando `navPermitida` devolve `true` (a troca já
  // aconteceu de verdade), dispara o AVISO aqui mesmo — ANTES da navegação seguir, e portanto ANTES de qualquer
  // desmonte que a navegação possa causar. `dirty`/`chaveVisivel` desta clausura são os do último render (os "de
  // antes da troca" — a página ainda não re-renderizou com a loja nova).
  // Fix round 4 T15 (N-1): compara com `lojaEstavel` (última loja NÃO vazia), nunca com o `tenantId` cru — com a
  // página ainda em "" e o cache já de volta à MESMA loja, a comparação crua dava "trocou" (toast falso + navegação
  // liberada sem o "Descartar alterações?", perdendo o rascunho). Cache vazio ou tela sem loja ainda = não é troca.
  const navPermitida = useCallback(() => {
    if (!user?.id) return false;
    const tenantEmCache = qc.getQueryData<string>(["active-tenant-id", user.id]);
    const trocouDeVerdade = !!tenantEmCache && !!lojaEstavel && tenantEmCache !== lojaEstavel;
    if (trocouDeVerdade) {
      avisarTrocaDeLoja(tenantEmCache, { dirty, chaveVisivel });
    }
    return trocouDeVerdade;
  }, [qc, user?.id, lojaEstavel, dirty, chaveVisivel, avisarTrocaDeLoja]);
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
                {/* revisão T15 #1: o `key` força o React a desmontar e recriar a aba inteira ao
                    trocar de loja — nenhum rascunho (ed/rascunhos/estado local) de NENHUMA aba
                    sobrevive à troca, mesmo se o super admin cancelar o "Descartar alterações?" da
                    guarda de navegação. Fix round 4 (N-1): é a última loja NÃO vazia — um ""
                    transitório (releitura que falhou) nunca remonta. */}
                <C key={lojaEstavel} />
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
      <UnsavedChangesGuard confirm={confirm} />
    </GuardaIntegracaoContext.Provider>
  );
}
