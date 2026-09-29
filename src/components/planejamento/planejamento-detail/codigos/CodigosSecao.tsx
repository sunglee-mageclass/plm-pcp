// Seção "4. Códigos" do Sheet do Planejamento (F3.6 — spec 2026-09-25 §5.1; F3.5b da spec do SKU §4.3). SKU em PRÉVIA (spec
// 2026-09-25-sku-previa-regerar §4.2 — P-46 do dono): o "Regerar SKUs" e o SKU digitado à mão NÃO gravam na hora — entram
// "a gravar" (aviso no topo + selo e fundo âmbar na linha), a prévia vem do SERVIDOR (skus_previa, só leitura, o MESMO plano
// da gravação) e só o Salvar do card grava; Voltar/Descartar ou "Desfazer prévia" mantêm os SKUs gravados. Sem AlertDialog
// (a prévia É a confirmação — R3). Regerar liberado com REF/"Tamanho em" digitados e ainda não salvos (a prévia usa os do
// rascunho). L1: REF (a MESMA trava `refEditavel` de hoje; R29) · "Tamanho em" (P-25: nasce em Letra) · "Regerar SKUs".
// Regras puras em ./sku-card.ts e ./sku-previa.ts; siglas do rótulo por consulta própria (`useSiglasCores` — R11).
// P-53 A (dev-oculto, mesclado antes desta task): SKU e "Tamanho em" só editáveis com `podeEditarSkus`
// (= `podeEditarPlanejamento` no orquestrador) — não herdam a trava do Dev/página onde o Sheet foi aberto.
import { Fragment, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "@tanstack/react-router";
import { RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoHover } from "@/components/shared/InfoHover";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";
import type { Draft } from "@/components/planejamento/modelo-shared";
import {
  agruparPorVariante, avisoSku, rotuloTamanho, rotuloVariante, siglasDoGrupo, situacaoSku, type LinhaSku,
} from "./sku-card";
import {
  TEXTO_BOM_SUJO, TEXTO_PREVIA, chaveLinhaSku, podeRegerar, situacaoPrevia, skuExibido, type LinhaPrevia, type SituacaoPrevia,
} from "./sku-previa";
import { useSiglasCores, type SkusAGravarApi, type SkusModelo } from "./useSkusModelo";

// P-25 (dono 25/set) — SEM padrão da LOJA (nada na Config): as 2 opções; o Draft chega aqui já marcado em Letra.
const TAMANHOS_EM = [{ v: "letra", rotulo: "Letra" }, { v: "numero", rotulo: "Número" }] as const;

// Nível de MÓDULO (não dentro do render): declarado dentro, remontaria a cada render e o input perderia o foco.
function SkuCampo({ exibido, editavel, riscado, placeholder, ariaLabel, colabPath, onConfirmar }: {
  /** o que a linha MOSTRA (digitado > o que o Salvar grava > o gravado — `skuExibido`) */
  exibido: string;
  editavel: boolean;
  riscado: boolean;
  placeholder: string;
  ariaLabel: string;
  colabPath: string;
  /** entra "a gravar" (nada vai ao banco aqui); devolve o erro PT e o valor que o campo passa a mostrar */
  onConfirmar: (texto: string) => { erro: string | null; valor: string };
}) {
  const [texto, setTexto] = useState(exibido);
  // A prévia mudou / outra pessoa / desfazer: o campo acompanha o que a linha mostra.
  useEffect(() => { setTexto(exibido); }, [exibido]);
  const confirmar = () => {
    const r = onConfirmar(texto);
    if (r.erro) toast.error(r.erro);
    setTexto(r.valor);
  };
  return (
    <Input
      className={cn("h-8 w-full min-w-0 font-mono text-xs", riscado && "line-through")}
      value={texto}
      placeholder={placeholder}
      disabled={!editavel}
      aria-label={ariaLabel}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      data-colab-path={colabPath}
    />
  );
}

export function CodigosSecao({
  draft, setDraftTracked, rotuloRef, refVisivel, refEditavel, refPrevia, skus, aGravar, bomSujo, podeVerSkus, podeEditarSkus,
}: {
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  rotuloRef: string;
  /** A REF aparece a partir da etapa configurada (`refCampoVisivel`; posição DERIVADA com a chave ligada — inv. #11). */
  refVisivel: boolean;
  /** = `refEditavel` do orquestrador (isEdit && !devBloqueado && refVisivel) — o MESMO que põe a REF no payload. */
  refEditavel: boolean;
  /** A REF que o Salvar vai gravar (a do rascunho se ela vai no payload; senão a salva) — `refParaPrevia`. */
  refPrevia: string;
  skus: SkusModelo;
  aGravar: SkusAGravarApi;
  /** Grade/tecidos do rascunho com alteração não salva: a prévia usa a grade SALVA (R4) — só um aviso. */
  bomSujo: boolean;
  /** Ver SKUs = ver o Planejamento; prévia/Salvar = editar o Planejamento (spec SKU §4.4; R8 — o servidor confere). */
  podeVerSkus: boolean;
  podeEditarSkus: boolean;
}) {
  const temPrevia = skus.temPrevia;
  // Com algo "a gravar", a tabela é a da PRÉVIA (calculada com o rascunho); senão, a gravada — como antes.
  const m = temPrevia && skus.previa ? skus.previa.matriz : skus.matriz;
  const grupos = m ? agruparPorVariante(m.linhas) : [];
  // Mesma guarda de antes (tamanho_tipo_card — rede p/ deploy fora de ordem); NÃO depende da trava do Dev/Explosão (R29).
  const editavel = !!m && m.status === "ok" && m.tamanho_tipo_card !== null && podeEditarSkus;
  const regerar = podeRegerar({ podeEditar: podeEditarSkus, matriz: skus.matriz, refPrevia, jaPedido: aGravar.aGravar.regerar });
  const siglas = useSiglasCores(podeVerSkus);
  const erros = temPrevia && skus.previa ? skus.previa.erros : [];
  const situacao = (l: LinhaSku, digitado: boolean): SituacaoPrevia => {
    if (temPrevia && skus.previa) return situacaoPrevia(l as LinhaPrevia, erros);
    // a prévia ainda não chegou: o digitado já se anuncia "a gravar"
    if (digitado) return { tom: "warning", texto: "editado à mão · a gravar", cadastrar: false, aGravar: true, conflitoVersao: false };
    return { ...situacaoSku(l), aGravar: false, conflitoVersao: false };
  };
  return (
    <div className="space-y-3">
      {/* Fix round pós-QA (F1) — REF a 26px a 1024/1280 (regressão do release 5, commit b02dc215): o rótulo maior
          do "Tamanho em" ocupava a coluna `auto` e empurrava a REF (1fr) quase a zero. Colunas EXPLÍCITAS
          (`minmax(12rem,1fr)` pra REF; `auto` pro toggle E pro botão seguem cabendo no próprio conteúdo agora que
          o rótulo não tem mais o texto longo inline — foi pro InfoHover abaixo) garantem REF legível nos 2
          breakpoints; a 390 (max-sm) a grid empilha em 1 coluna, sem estouro horizontal (§Q).
          Fix round 1 (M-1, review) — o fix acima ainda estourava de 640 a ~767px: nesse intervalo o Sheet é
          `sm:w-[70vw]` (`ui/sheet.tsx:52`) com `px-6` no corpo (`PlanejamentoDetail.tsx:1488`), então o conteúdo
          útil é `0,7·vw − 48px` (menos ~15px de scrollbar no Windows) — a 640px isso dá só 400px, mas as 3
          colunas (REF 192px + toggle ~143px + botão 128px + 2 gaps de 12px) somam ~487px, 87px acima do que
          cabe. Grid EM DUAS ETAPAS: de `sm` a `md` só REF + toggle ficam na mesma linha (192+143+12=347px ≤
          400px, cabe); o botão "Regerar SKUs" cai pra 2ª linha (`sm:grid-cols-[minmax(12rem,1fr)_auto]`,
          SEM a 3ª coluna — o botão vira um item a mais no grid de 2 colunas e ocupa a linha de baixo sozinho,
          alinhado à esquerda). De `lg` (1024px) em diante, onde o conteúdo útil já é ~669px, as 3 colunas
          cabem juntas de novo (`lg:grid-cols-[minmax(12rem,1fr)_auto_auto]`) — idêntico ao fix anterior nesses
          2 breakpoints (REF calculada: 1024→~374px, 1280→~553px).
          Fix round 2 (Low, re-revisão) — a largura em cada breakpoint (390/640/768/1024/1280) foi CALCULADA
          pela matemática acima (Sheet 70vw, px-6 no corpo, tracks mínimos de REF/toggle/botão), NÃO medida
          num navegador de verdade (a versão anterior deste comentário dizia "Re-medido com
          scrollWidth===clientWidth", o que nunca aconteceu — corrigido aqui). Ver tests/unit/
          planejamento-codigos.test.ts pras asserções de fonte que confirmam as classes do grid. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-end lg:grid-cols-[minmax(12rem,1fr)_auto_auto]">
        {refVisivel ? (
          <div className="grid gap-1">
            <Label htmlFor="codigos-ref">{rotuloRef}</Label>
            <Input
              id="codigos-ref"
              className="font-mono"
              value={draft.ref}
              // R29 — só o INPUT trava (enviado à Explosão / sem permissão do Dev), como hoje; sem aviso nesta seção.
              disabled={!refEditavel}
              onChange={(e) => setDraftTracked((d) => ({ ...d, ref: e.target.value }))}
              data-colab-path="ref"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">A {rotuloRef} aparece a partir da etapa configurada na Config da Loja.</p>
        )}
        {/* P-25 (dono 25/set 14:57) — SEM padrão da LOJA: o Draft já chega marcado em Letra; dá p/ trocar p/ Número. Rádio nativo
            (não há RadioGroup em ui/, que não se edita): grupo rotulado; alvo de toque 44px no mobile. P-53 A — só
            editável com `podeEditarSkus` (= editar o Planejamento; não é campo do Dev — CAMPOS_SO_PLANEJAMENTO_DRAFT).
            F1 (fix round pós-QA) — o texto longo que ficava inline no rótulo (empurrava a REF) virou `InfoHover`
            (mesmo padrão do `TamanhoEmToggle.tsx` compartilhado — "i" ao lado do rótulo, mesmo texto). */}
        <div className="grid gap-1" role="radiogroup" aria-labelledby="codigos-tamanho-em" data-colab-path="tamanho_tipo">
          <div className="flex items-center gap-1">
            <Label id="codigos-tamanho-em">Tamanho em</Label>
            {/* Fix round 1 (L-1, review) — os "·" eram separadores do <span> INLINE de antes (encadeavam com o
                rótulo "Tamanho em" que vinha logo antes); dentro de um tooltip isolado, sem esse encadeamento,
                sobra pontuação quebrada no início e no meio. Texto virou 2 frases normais. */}
            <InfoHover ariaLabel="Sobre o Tamanho em">
              Nasce em Letra; troque para Número se o produto usa numeração. É o mesmo do Plan. Tecido / Produto Acabado / Importado.
            </InfoHover>
          </div>
          <div className="flex min-h-9 items-center gap-4 text-sm">
            {TAMANHOS_EM.map((o) => (
              <label key={o.v} className="flex cursor-pointer items-center gap-1.5 max-sm:min-h-11">
                <input
                  type="radio"
                  name="codigos-tamanho-em"
                  value={o.v}
                  className="h-4 w-4 accent-primary"
                  checked={draft.tamanho_tipo === o.v}
                  disabled={!podeEditarSkus}
                  onChange={() => setDraftTracked((d) => ({ ...d, tamanho_tipo: o.v }))}
                />
                {o.rotulo}
              </label>
            ))}
          </div>
        </div>
        {podeVerSkus && (
          // Fix round 1 (M-1) — de `sm` a `md` o botão é o 3º item de um grid de 2 colunas (cai pra linha 2,
          // coluna 1, embaixo da REF) e a coluna 1 é `minmax(12rem,1fr)` (flexível/larga) — sem `justify-self-
          // start` o grid ESTICA o botão pra ocupar a largura toda da coluna (comportamento padrão de item de
          // grid, `justify-items: stretch`). De `lg` em diante o botão volta a ser a 3ª coluna própria (`auto`
          // — cabe no conteúdo, sem esticar de qualquer forma).
          // Fix round 2 (Low, re-revisão) — `w-fit justify-self-start` valia em TODA largura, inclusive abaixo
          // de `sm` (max-sm, 1 coluna só): ali o grid original (antes do F1/M-1) sempre esticava o botão pra
          // largura cheia (`justify-items: stretch` default) — ninguém pediu pra mudar esse comportamento no
          // celular. Restrito a `sm:` (só a partir de 640px, onde o grid de 2/3 colunas de fato precisa do
          // ajuste) — abaixo disso o botão volta a ser full-width, como sempre foi.
          <Button type="button" variant="outline" size="sm" className="sm:w-fit sm:justify-self-start max-sm:min-h-11"
            disabled={!regerar.pode}
            title={regerar.motivo}
            onClick={aGravar.pedirRegerar}>
            <RefreshCw className="mr-1 h-4 w-4" /> Regerar SKUs
          </Button>
        )}
      </div>

      {podeVerSkus && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">SKUs por variante e tamanho</p>
          {temPrevia && (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--warning)] bg-[var(--tone-warning-bg)] px-3 py-2 text-xs text-[var(--tone-warning-fg)]">
              <span className="min-w-0 flex-1">{TEXTO_PREVIA}</span>
              {skus.previaCarregando && <span>Calculando a prévia…</span>}
              <Button type="button" variant="outline" size="sm" className="max-sm:min-h-11" onClick={aGravar.desfazerPrevia}>
                <RotateCcw className="mr-1 h-4 w-4" /> Desfazer prévia
              </Button>
            </div>
          )}
          {temPrevia && bomSujo && <p className="text-xs text-muted-foreground">{TEXTO_BOM_SUJO}</p>}
          {temPrevia && skus.previaErro && (
            <p className="text-sm text-destructive">
              Não foi possível calcular a prévia —{" "}
              <button type="button" className="underline" onClick={skus.refazerPrevia}>tentar de novo</button>.
            </p>
          )}
          {temPrevia && skus.previa?.desconhecida && (
            <p className="text-sm text-destructive">Não foi possível ler a prévia — recarregue a página. O Salvar não grava os SKUs assim.</p>
          )}
          {skus.carregando ? (
            <p className="text-sm text-muted-foreground">Carregando os SKUs…</p>
          ) : skus.erro ? (
            <p className="text-sm text-destructive">Não foi possível carregar os SKUs — recarregue a página.</p>
          ) : !m ? null : m.linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.status === "sem_formato" ? (
                <>A loja ainda não tem o Formato do SKU — <Link to="/admin/configuracoes" className="underline">configurar na Config da Loja</Link>.</>
              ) : m.status === "aguardando_ref" ? (
                `Os SKUs são gerados quando o card tiver ${rotuloRef} (salve o card depois que ela aparecer).`
              ) : m.status === "sem_tamanho" ? (
                // P-25 — só card LEGADO antes da migration T6 rodar (todo produto novo já nasce em Letra).
                "Este card é de antes da migração do “Tamanho em” — salve o card para atualizá-lo e gerar os SKUs."
              ) : m.status === "desconhecido" ? (
                "Não foi possível ler a situação dos SKUs — recarregue a página."
              ) : (
                "Sem linhas: preencha a Grade (variantes do Tecido 1 × tamanhos com quantidade)."
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              {m.status === "sem_tamanho" && (
                <p className="mb-2 text-xs text-muted-foreground">Card de antes da migração do “Tamanho em” — salve o card para gerar ou regerar os SKUs.</p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-3 font-semibold">Variante / Tamanho</th>
                    <th className="py-1.5 px-2 font-semibold">SKU</th>
                    <th className="py-1.5 pl-2 font-semibold">Situação</th>
                  </tr>
                </thead>
                <tbody className="align-middle">
                  {grupos.map((g) => {
                    const rotuloVar = rotuloVariante(g, siglasDoGrupo(g, siglas.cores, siglas.apelidos));
                    return (
                    <Fragment key={g.chave}>
                      <tr className="bg-muted/40">
                        <td colSpan={3} className="py-1.5 px-2 text-xs font-semibold text-muted-foreground">{rotuloVar}</td>
                      </tr>
                      {g.linhas.map((l) => {
                        const chave = chaveLinhaSku(l.variante_key, l.tamanho_key);
                        const digitado = chave in aGravar.aGravar.manuais;
                        const sit = situacao(l, digitado);
                        const sai = (l as LinhaPrevia).previa?.acao === "sai";
                        const aviso = avisoSku(l);
                        const rotuloTam = rotuloTamanho(l.tamanho_key, m.tamanho_tipo);
                        return (
                          <tr key={chave} className={cn("border-t", (sit.aGravar || digitado) && "bg-[var(--tone-warning-bg)]")}>
                            <td className="py-2 pr-3 pl-4 whitespace-nowrap">{rotuloTam}</td>
                            <td className="py-2 px-2 min-w-40">
                              <SkuCampo
                                exibido={skuExibido(l, aGravar.aGravar)}
                                editavel={editavel && l.estado !== "orfa" && !sai}
                                riscado={sai}
                                placeholder={l.sku_previsto ?? ""}
                                ariaLabel={`SKU — ${rotuloVar} · ${rotuloTam}`}
                                colabPath={`sku:${l.variante_key}:${l.tamanho_key}`}
                                onConfirmar={(t) => aGravar.digitar(l, t)}
                              />
                            </td>
                            <td className="py-2 pl-2 text-xs">
                              <span className="inline-flex flex-wrap items-center gap-1">
                                {sit.tom === "neutral" ? (
                                  <span className="text-muted-foreground">{sit.texto}</span>
                                ) : (
                                  <StatusBadge tone={sit.tom} className="normal-case tracking-normal">{sit.texto}</StatusBadge>
                                )}
                                {sit.cadastrar && <Link to="/cadastro/atributos" className="underline">cadastrar</Link>}
                                {digitado && !sit.conflitoVersao && (
                                  <Button type="button" variant="ghost" size="iconSm" className="max-sm:h-11 max-sm:w-11"
                                    aria-label="Desfazer o SKU digitado" title="Desfazer o SKU digitado"
                                    onClick={() => aGravar.desfazerManual(chave)}>
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                )}
                              </span>
                              {sit.conflitoVersao && (
                                <span className="mt-1 flex flex-wrap gap-2">
                                  <Button type="button" variant="outline" size="sm" className="max-sm:min-h-11" onClick={() => aGravar.manterMeu(l)}>manter o meu</Button>
                                  <Button type="button" variant="ghost" size="sm" className="max-sm:min-h-11" onClick={() => aGravar.desfazerManual(chave)}>usar o novo</Button>
                                </span>
                              )}
                              {aviso && (
                                <span className="mt-1 block text-muted-foreground">
                                  {aviso} — <Link to="/cadastro/atributos" className="underline">cadastrar</Link>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">As variantes vêm do Tecido 1 (seção Tecidos) e os tamanhos, da Grade. Formato: REF - cor base + apelido + tamanho (Config da Loja › Formato do SKU). 'Regerar SKUs' mostra a prévia e só o Salvar grava; os editados à mão nunca mudam.</p>
        </div>
      )}
    </div>
  );
}
