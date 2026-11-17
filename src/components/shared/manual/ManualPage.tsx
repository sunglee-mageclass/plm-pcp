// Tela do Manual de uso GLOBAL — navegação Módulo → Tela → Seção, derivada do MESMO catálogo vivo
// da sidebar (montarEstruturaManual), filtrada pela loja (módulos + perfil) e pela PERMISSÃO do
// usuário (canView por pageKey). UNIVERSAL: a rota não usa RequirePermission; qualquer logado chega
// aqui. O conteúdo campo a campo (camposDaTela) entra depois — por ora mostramos a estrutura + um
// aviso discreto "em breve" onde ainda não há detalhe.
import { useMemo, useState } from "react";
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
import { camposDaTela } from "@/lib/manual/tipos-conteudo";
import { ManualIndiceSecoes, Blocos } from "./ManualRenderer";
import type { Bloco, SecaoManual } from "./tipos";

/** Monta as seções (conteúdo-como-dados) de UMA tela do Manual, com âncoras estáveis p/ ajuda
 *  contextual (A5): a seção "Para que serve" + 1 seção por SecaoEstrutura (id = sectionKey, vira
 *  `#secao-<sectionKey>`) + os campos de camposDaTela (vazio → aviso discreto "em breve"). */
function secoesDaTela(tela: TelaManual): SecaoManual[] {
  const secoes: SecaoManual[] = [];

  // "Para que serve" = a description do PageDef (quando houver).
  if (tela.descricao) {
    secoes.push({
      id: "para-que-serve",
      titulo: "Para que serve",
      blocos: [{ tipo: "p", texto: tela.descricao }],
    });
  }

  // Uma seção por SecaoEstrutura (sub-permissão da tela). id = sectionKey → âncora `#secao-<key>`.
  for (const sec of tela.seroes) {
    const blocos: Bloco[] = [];
    if (sec.hint) blocos.push({ tipo: "p", texto: sec.hint });
    const campos = camposDaTela(sec.key);
    if (campos.length > 0) {
      blocos.push({
        tipo: "lista",
        itens: campos.map((c) => (c.quando ? `${c.rotulo} — ${c.quando}` : c.rotulo)),
      });
    } else if (!sec.hint) {
      blocos.push({ tipo: "p", texto: "Conteúdo detalhado em breve." });
    }
    secoes.push({ id: sec.key, titulo: sec.label, blocos });
  }

  // Campos da própria tela (camposDaTela(pageKey)) — hoje vazio para todas: aviso discreto.
  const camposTela = camposDaTela(tela.pageKey);
  if (camposTela.length > 0) {
    secoes.push({
      id: "campos",
      titulo: "Campos",
      blocos: [
        {
          tipo: "lista",
          itens: camposTela.map((c) => (c.quando ? `${c.rotulo} — ${c.quando}` : c.rotulo)),
        },
      ],
    });
  }

  // Nenhuma seção (sem description nem sub-seções nem campos): aviso único de "em breve".
  if (secoes.length === 0) {
    secoes.push({
      id: "em-breve",
      titulo: "Sobre esta tela",
      blocos: [{ tipo: "p", texto: "Conteúdo detalhado em breve." }],
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

          {/* Tela selecionada + suas seções (âncora da tela = `#manual-<pageKey>` p/ ajuda contextual). */}
          {telaAtual && (
            <div id={`manual-${telaAtual.pageKey}`} className="min-w-0 scroll-mt-4 space-y-4">
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {labelDe(telaAtual.moduloKey, telaAtual.moduloLabel)}
                </div>
                <h2 className="font-display text-xl font-semibold">
                  {labelDe(telaAtual.pageKey, telaAtual.label)}
                </h2>
              </div>
              <ManualIndiceSecoes
                key={telaAtual.pageKey}
                secoes={secoesDaTela(telaAtual)}
                prefixoAncora="secao"
                renderBlocos={(blocos) => <Blocos blocos={blocos as Bloco[]} />}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
