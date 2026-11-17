// Tela do Manual de uso GLOBAL — navegação Módulo → Tela → Seção, derivada do MESMO catálogo vivo
// da sidebar (montarEstruturaManual), filtrada pela loja (módulos + perfil) e pela PERMISSÃO do
// usuário (canView por pageKey). UNIVERSAL: a rota não usa RequirePermission; qualquer logado chega
// aqui. O conteúdo campo a campo (camposDaTela) entra depois — por ora mostramos a estrutura + um
// aviso discreto "em breve" onde ainda não há detalhe.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useSystemIdentity } from "@/hooks/useSystemIdentity";
import { useTabLabels } from "@/hooks/useTabLabels";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { LojaErroAviso } from "@/components/shared/LojaErroAviso";
import { cn } from "@/lib/utils";
import {
  montarEstruturaManual,
  type ModuloManual,
  type TelaManual,
} from "@/lib/manual/estrutura";
import { conteudoDaTela, type CampoManual, type SecaoConteudoManual } from "@/lib/manual/tipos-conteudo";
import { Blocos } from "./ManualRenderer";
import type { Bloco } from "./tipos";

/** Uma seção renderizável do Manual: intro (Bloco[]) + campos-verbete. `id` → âncora `#secao-<id>`. */
type SecaoConteudo = { id: string; titulo: string; intro: Bloco[]; campos: CampoManual[] };

/** Monta as seções de UMA tela. Prioridade: o conteúdo À MÃO (CONTEUDO_TELAS, uma seção por área do
 *  Sheet) quando a tela o tem; senão, o esqueleto automático (description + sub-permissões do
 *  catálogo), com aviso discreto "em breve" onde ainda não há detalhe. */
function secoesDaTela(tela: TelaManual): SecaoConteudo[] {
  const aMao = conteudoDaTela(tela.pageKey);
  if (aMao.length > 0) {
    return aMao.map((s: SecaoConteudoManual) => ({
      id: s.id,
      titulo: s.titulo,
      intro: s.intro ?? [],
      campos: s.campos ?? [],
    }));
  }

  // Sem conteúdo à mão: esqueleto automático.
  const secoes: SecaoConteudo[] = [];
  if (tela.descricao) {
    secoes.push({
      id: "para-que-serve",
      titulo: "Para que serve",
      intro: [{ tipo: "p", texto: tela.descricao }],
      campos: [],
    });
  }
  for (const sec of tela.seroes) {
    const intro: Bloco[] = [];
    if (sec.hint) intro.push({ tipo: "p", texto: sec.hint });
    else intro.push({ tipo: "p", texto: "Conteúdo detalhado em breve." });
    secoes.push({ id: sec.key, titulo: sec.label, intro, campos: [] });
  }
  if (secoes.length === 0) {
    secoes.push({
      id: "em-breve",
      titulo: "Sobre esta tela",
      intro: [{ tipo: "p", texto: "Conteúdo detalhado em breve." }],
      campos: [],
    });
  }
  return secoes;
}

export function ManualPage() {
  const { canView } = useAuth();
  const { modules, isStockOnly, isModuleEnabled, pronto, erro, tentando, tentarDeNovo } =
    useTenantModules();
  const { nome_sistema } = useSystemIdentity();
  const tabLabels = useTabLabels();

  // Rótulo renomeado pela loja (tab_labels) com fallback no label do catálogo.
  const labelDe = (key: string, fallback: string) => tabLabels[key] || fallback;

  // Árvore Módulo → Tela → Seção, já filtrada por loja + perfil + permissão do usuário (canView).
  // `manual` nunca se auto-documenta (filtrado: a tela do próprio Manual fora da lista).
  const estrutura: ModuloManual[] = useMemo(() => {
    if (!pronto) return [];
    return montarEstruturaManual({
      modules,
      isStockOnly,
      criacaoLigada: isModuleEnabled("criacao"),
      podeVer: (pageKey) => canView(pageKey),
    }).filter((m) => m.moduleKey !== "manual");
  }, [pronto, modules, isStockOnly, isModuleEnabled, canView]);

  // Lista achatada de telas (na ordem da árvore) p/ a seleção à direita.
  const telas = useMemo(() => estrutura.flatMap((m) => m.telas), [estrutura]);

  const [telaSel, setTelaSel] = useState<string | null>(null);
  const telaAtual =
    telas.find((t) => t.pageKey === telaSel) ?? telas[0] ?? null;

  // AJUDA CONTEXTUAL (A5): o botão "?" navega para `/manual` com hash `#manual-<pageKey>` (tela) ou
  // `#secao-<sectionKey>` (seção). A ManualPage lê o hash no mount para abrir a tela certa e rolar
  // até a âncora. À prova de hash ausente/inválido: nada muda (fica na 1ª tela).
  const hash = useRouterState({ select: (s) => s.location.hash });

  /** Resolve a `pageKey` a abrir a partir do hash (sem o "#"). `manual-<pageKey>` → direto;
   *  `secao-<sectionKey>` → a 1ª tela que CONTÉM essa seção. Desconhecido → null (não mexe). */
  function pageKeyDoHash(h: string): string | null {
    if (!h) return null;
    if (h.startsWith("manual-")) {
      const key = h.slice("manual-".length);
      return telas.some((t) => t.pageKey === key) ? key : null;
    }
    if (h.startsWith("secao-")) {
      const secKey = h.slice("secao-".length);
      // A seção pode vir do catálogo (sub-permissão) OU do conteúdo à mão (área do Sheet).
      const dona = telas.find(
        (t) =>
          t.seroes.some((s) => s.key === secKey) ||
          conteudoDaTela(t.pageKey).some((s) => s.id === secKey),
      );
      return dona?.pageKey ?? null;
    }
    return null;
  }

  // Pré-seleciona a tela do hash quando as telas chegam (ou o hash muda) e rola até a âncora.
  // O scroll espera a tela ser renderizada (a seção só existe no DOM depois de `setTelaSel`).
  const ultimoHashTratado = useRef<string | null>(null);
  useEffect(() => {
    if (telas.length === 0) return;
    const h = (hash ?? "").replace(/^#/, "");
    if (!h || h === ultimoHashTratado.current) return;
    const alvo = pageKeyDoHash(h);
    if (!alvo) return; // hash desconhecido: fica na tela atual, sem rolar
    ultimoHashTratado.current = h;
    setTelaSel(alvo);
    // Rola após o próximo paint (a âncora `#secao-…`/`#manual-…` já existe no DOM).
    requestAnimationFrame(() => {
      const el = document.getElementById(h);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, telas]);

  // [backend F1] 1ª carga da loja/módulos falhou: aviso + "Tentar de novo" (nunca decide sobre DEFAULTS).
  if (erro) return <LojaErroAviso onTentarDeNovo={tentarDeNovo} tentando={tentando} />;

  return (
    <div className="space-y-4 p-4 pb-24 md:p-6">
      <Breadcrumb items={[{ label: "Ajuda" }, { label: "Manual" }]} />
      <div>
        <h1 className="font-display text-2xl font-semibold">Manual do {nome_sistema}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Guia de uso, tela a tela — só o que a sua loja usa e o que você tem permissão de ver.
        </p>
      </div>

      {!pronto ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : telas.length === 0 ? (
        <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          Nenhuma tela disponível no seu acesso para documentar aqui.
        </div>
      ) : (
        // Mobile (~400px): empilha — navegação em cima, conteúdo embaixo (sem estourar horizontal).
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[16rem_1fr]">
          {/* Navegação Módulo → Tela (índice principal). */}
          <nav
            aria-label="Módulos e telas do manual"
            className="min-w-0 space-y-4 md:sticky md:top-4 md:max-h-[calc(100vh-6rem)] md:self-start md:overflow-y-auto"
          >
            {estrutura.map((mod) => (
              <div key={mod.moduleKey} className="space-y-1">
                <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {labelDe(mod.moduleKey, mod.label)}
                </div>
                <ul className="space-y-0.5">
                  {mod.telas.map((tela) => {
                    const ativa = telaAtual?.pageKey === tela.pageKey;
                    return (
                      <li key={tela.pageKey}>
                        <button
                          type="button"
                          onClick={() => setTelaSel(tela.pageKey)}
                          className={cn(
                            "w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                            ativa
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-foreground hover:bg-muted",
                          )}
                        >
                          {labelDe(tela.pageKey, tela.label)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {/* Tela selecionada + suas seções, em UMA coluna de conteúdo (sem índice-lateral próprio: a
              navegação da esquerda já é o índice; uma 3ª coluna apertaria e desalinharia — QA 17/nov).
              Âncora da tela = `#manual-<pageKey>`; cada seção = `#secao-<sectionKey>` (ajuda contextual A5). */}
          {telaAtual && (
            <div id={`manual-${telaAtual.pageKey}`} className="min-w-0 scroll-mt-4">
              <div className="mb-4 space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {labelDe(telaAtual.moduloKey, telaAtual.moduloLabel)}
                </div>
                <h2 className="font-display text-xl font-semibold">
                  {labelDe(telaAtual.pageKey, telaAtual.label)}
                </h2>
              </div>
              <div key={telaAtual.pageKey} className="max-w-2xl space-y-8">
                {secoesDaTela(telaAtual).map((s) => (
                  <section key={s.id} id={`secao-${s.id}`} className="scroll-mt-4 space-y-3">
                    <h3 className="font-display text-lg font-semibold">{s.titulo}</h3>
                    {s.intro.length > 0 && <Blocos blocos={s.intro} />}
                    {s.campos.length > 0 && (
                      <dl className="space-y-4">
                        {s.campos.map((c) => (
                          <div key={c.campo} className="space-y-1">
                            <dt className="font-medium text-foreground">
                              {c.rotulo}
                              {c.quando && (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                  {c.quando}
                                </span>
                              )}
                            </dt>
                            <dd className="text-sm text-muted-foreground">
                              <Blocos blocos={c.ajuda} />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </section>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
