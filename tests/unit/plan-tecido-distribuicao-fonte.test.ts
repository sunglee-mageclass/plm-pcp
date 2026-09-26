import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (r: string) => readFileSync(ROOT + r, "utf8");
const conta = (t: string, s: string) => t.split(s).length - 1;

describe("Plan. Tecido — card com a Distribuição por produto (Task 5)", () => {
  const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
  const bloco = ler("src/components/plan-tecido/MaterialBlock.tsx");
  const card = ler("src/components/plan-tecido/ModelCard.tsx");
  const pop = ler("src/components/plan-tecido/AtendeAPopover.tsx");
  it("gate do módulo e normalização no carregamento E no funil `patch` (R4/R6)", () => {
    expect(sheet).toContain('isModuleEnabled("distribuicao")');
    expect(sheet).toMatch(/return normalizarArvoreDistribuicao\(limparSlotsOrfaos\(/);
    expect(sheet).toMatch(/const patch = \(next0: PtArvore\) => \{\n\s+const next = normalizarArvoreDistribuicao\(next0, distOpts\);/);
  });
  it("PR15 (G-plano R6): espera os módulos por isFetched e re-semeia quando a grade/os módulos chegam ou mudam", () => {
    expect(sheet).toContain("if (!tamanhosProntos || !modulosProntos) return;");
    expect(sheet).toContain("srcRef.current.dist !== distOpts");
    expect(sheet).not.toContain("modulosCarregando");
    expect(ler("src/hooks/useTenantModules.ts")).toContain("return { modules, isModuleEnabled, isStockOnly, firstActiveModulePath, isLoading, isFetched };");
  });
  it("PR12 (G-plano R3 + P-31): carga que recalcula ⇒ 'não salvo' + aviso no topo; base = árvore CRUA; descartar re-deriva", () => {
    expect(sheet).toContain("const carga = efeitoDaCarga(computeFreshArvore(seed, modelosReais, salvo, modelosDb as any[], SEM_DERIVAR), distOpts, !paginaSoLeitura, {");
    expect(sheet).toContain("planBaseRef.current = carga.base;");
    expect(sheet).toContain("touchedSlotIdsRef.current = new Set(carga.tocados);");
    expect(sheet).toContain("cor(es) de forro/Tecido 2 recalculada(s) pela amarração — salve para gravar");
    expect(sheet).toContain("srcRef.current = null; // PR12");
    expect(sheet).toContain("if (carga.sujo) {");
    expect(conta(sheet, ", distOpts)")).toBeGreaterThanOrEqual(2); // os 2 merges (dirty e retry P0409) seguem normalizando
  });
  it("T5 fix1 · C1 (Critical): eco do próprio Salvar não suja/toca/avisa; liga ANTES de invalidar", () => {
    expect(sheet).toContain("const ecoDoSaveRef = useRef(false);");
    expect(sheet).toContain("const sujoSoDaCargaRef = useRef(false);");
    // liga ANTES de qualquer invalidação de query no onSuccess
    const onSuccessIdx = sheet.indexOf("onSuccess: () => {");
    const ecoLigaIdx = sheet.indexOf("ecoDoSaveRef.current = true;", onSuccessIdx);
    const primeiraInvalidacaoIdx = sheet.indexOf('qc.invalidateQueries({ queryKey: ["plan-tecido-arvore", colecaoId] });', onSuccessIdx);
    expect(ecoLigaIdx).toBeGreaterThan(onSuccessIdx);
    expect(ecoLigaIdx).toBeLessThan(primeiraInvalidacaoIdx);
    // ecoDoSave entra no efeitoDaCarga
    expect(sheet).toContain("ecoDoSave: ecoDoSaveRef.current,");
    // C1(b): patch() (edição do usuário) e reverterArvore() (Descartar) zeram a ref de "sujo só da carga"
    expect(sheet).toContain("sujoSoDaCargaRef.current = false; // C1(b): a partir daqui há edição REAL do usuário a preservar");
    expect(sheet).toContain('sujoSoDaCargaRef.current = false; // C1(b): "Descartar" some com qualquer sujeira (da carga ou do usuário)');
  });
  it("T5 fix2 · N1 (Important, obrigatório): o eco só desliga depois que a REFETCH DA ÁRVORE e o auto-aplicar terminam AS DUAS (Promise.all) — não só o auto-aplicar (regressão do fix1)", () => {
    // a árvore refetcha via invalidateQueries CAPTURADO numa variável (não fire-and-forget solto)
    expect(sheet).toContain('const refetchArvore = qc.invalidateQueries({ queryKey: ["plan-tecido-arvore", colecaoId] });');
    // o finally só roda depois que AMBAS terminam
    expect(sheet).toContain("void Promise.all([refetchArvore, autoAplicarDirty(touched)]).finally(() => {");
    // não sobrou nenhum `.finally` preso só no autoAplicarDirty (a regressão do fix1)
    expect(sheet).not.toMatch(/autoAplicarDirty\(touched\)\.finally\(/);
    // invalidarBomVivo continua devolvendo a Promise de ["plan-tecido-modelos", colecaoId] e autoAplicarDirty a ESPERA
    expect(sheet).toContain('const pModelos = qc.invalidateQueries({ queryKey: ["plan-tecido-modelos", colecaoId] });');
    expect(sheet).toContain("return pModelos;");
    expect(sheet).toContain("await invalidarBomVivo(alvos.map((a) => a.modeloId));");
  });
  it("T5 fix2 · N3 (Minor, mesmo mecanismo): contador de gerações — 2 Salvares seguidos não se atrapalham", () => {
    expect(sheet).toContain("const ecoGeracaoRef = useRef(0);");
    // incrementa ANTES do finally ser armado, dentro do onSuccess
    expect(sheet).toContain("const geracao = ++ecoGeracaoRef.current;");
    // o finally só desliga se a geração dele ainda for a atual
    expect(sheet).toContain("if (ecoGeracaoRef.current !== geracao) return;");
    // a checagem de geração vem ANTES de desligar o eco (senão um save velho desligaria por baixo do novo)
    const geracaoCheckIdx = sheet.indexOf("if (ecoGeracaoRef.current !== geracao) return;");
    const desligaEcoIdx = sheet.indexOf("ecoDoSaveRef.current = false;", geracaoCheckIdx);
    expect(desligaEcoIdx).toBeGreaterThan(geracaoCheckIdx);
  });
  it("T5 fix1 · I2 (Important): slot travado (enviado à Explosão) ou lançado não suja/toca/avisa na carga — só exibe o derivado", () => {
    expect(sheet).toContain("travado: (s) => !!s.modelo_id && (lancadoSet.has(s.modelo_id) || enviadoCadSet.has(s.modelo_id)),");
  });
  it("T5 fix2 · item 2 (Important): opts de efeitoDaCarga é OBRIGATÓRIO — sem caminho retrocompat que caia em silêncio", () => {
    const atendimento = ler("src/lib/plan-tecido/atendimento.ts");
    expect(atendimento).toContain("opts: { ecoDoSave: boolean; travado: (slot: PtSlot) => boolean },");
    expect(atendimento).not.toMatch(/opts\?:/);
  });
  it("T5 fix2 · N2 (Minor): ramo tratarComoLimpo zera o dirty quando não sobrou slot tocado (0 tocados)", () => {
    expect(sheet).toContain("} else if (tratarComoLimpo) {\n      sujoSoDaCargaRef.current = false;");
    expect(sheet).toContain("if (dirty) setDirty(false);");
  });
  it("payload do aplicar/criar card com casamento só com o módulo (R3/R4); nada de buildMateriaisAplicar cru", () => {
    expect(conta(sheet, "materiaisParaAplicar(slot, distribOn)")).toBe(2);
    expect(sheet).not.toMatch(/buildMateriaisAplicar\(slot\)/);
    expect(card).toContain("materiaisParaAplicar(slot, !!distribuicaoLigada)");
  });
  it("a query dos modelos traz cor, casamento e 'Tamanho em' (R17)", () => {
    expect(sheet).toContain("modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, complementa_variante_ids, variante:variante_tecido_id(artigo_id, cor_id, ");
    expect(sheet).toContain("proporcoes, tamanho_tipo, lancado");
  });
  it("I3 (Lote A fix1): a query também pede cor_apelido_id — sem ele a chave da variante viva não casa com a salva (cor|apelido)", () => {
    expect(sheet).toContain("cor_id, cor_apelido_id,");
  });
  it("M5 (Lote A fix1): efeitoDaCarga com só o Tecido 1 recalculado mostra o aviso próprio; com forro/T2 mostra o do PR12", () => {
    expect(sheet).toContain("recalculadas === 0 && recalculadasT1 > 0");
    expect(sheet).toContain("Distribuição recalculada — salve para gravar");
    expect(sheet).toContain("cor(es) de forro/Tecido 2 recalculada(s) pela amarração — salve para gravar");
  });
  it("presença: o marcador do dialog entra no campoFocado do canal do Plan. Tecido (R19)", () => {
    expect(sheet).toContain("campoFocado: campoFocadoColab ?? focoDistribuicao,");
    expect(sheet).toContain("presentesColab={presentes}");
    expect(sheet).toContain("onFocoDistribuicao={setFocoDistribuicao}");
  });
  it("pç só leitura + selo 'distribuído' (T1) e 'atende a' (demais blocos) com textos do mockup", () => {
    expect(bloco).toContain("Só leitura — muda pelo Distribuir por loja");
    expect(bloco).toContain("Soma das cores do Tecido 1 que ele atende");
    expect(bloco).toContain(">distribuído</StatusBadge>");
    expect(bloco).toContain("Não atende nenhuma cor do Tecido 1");
    expect(bloco).toContain("Sem cor deste {rotulo}:");
    expect(bloco).toContain("{acaoExtra}");
  });
  it("'atende a' tem data-colab-path no gatilho E nas opções (R20)", () => {
    expect(conta(pop, "data-colab-path={path}")).toBe(2);
    expect(pop).toContain("Atende a · cores do Tecido 1");
    expect(pop).toContain("já atendida por: ");
    expect(pop).toContain("mesma cor base (automático)");
    expect(pop).toContain("escolhida à mão");
    expect(pop).toContain("padrão (mesma cor base)");
  });
  it("T5 fix2 · M1 (lint real, rules-of-hooks): AtendeAPopover chama useReadOnly() de forma INCONDICIONAL (nunca dentro de ||)", () => {
    expect(pop).toContain('import { useReadOnly } from "@/components/RequirePermission";');
    expect(pop).toContain("const roPagina = useReadOnly();");
    expect(pop).toContain("const bloqueado = readOnly || roPagina;");
    // a versão antiga (hook dentro do ||, violação de rules-of-hooks) não pode voltar
    expect(pop).not.toContain("readOnly || useReadOnly()");
    expect(pop).toContain("disabled={bloqueado || deOutra}");
    expect(pop).toContain("{at.manual.has(kb) && !bloqueado && (");
  });
  it("T5 fix1 · M2: default de `tamanhos` é uma constante de MÓDULO (não um [] literal a cada render)", () => {
    expect(sheet).toContain("const TAMANHOS_VAZIO: string[] = [];");
    expect(sheet).toContain("data: tamanhos = TAMANHOS_VAZIO");
  });
  it("T5 fix1 · M4: banner âmbar do PR12/M5 usa a variante escura (mesmos tokens do banner de RequirePermission)", () => {
    expect(conta(sheet, "dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200")).toBe(2);
  });
  it("T5 fix1 · M5: ícone âmbar de 'não atende' tem role=img junto do aria-label", () => {
    expect(bloco).toContain('role="img"');
    expect(bloco).toContain('aria-label="Não atende nenhuma cor do Tecido 1"');
  });
  it("I1: o mapeamento do ModeloReal preenche cor_apelido_id na variante do BOM (não só o texto do select)", () => {
    expect(sheet).toContain("cor_apelido_id: (v.variante?.cor_apelido_id ?? null) as string | null,");
  });
});

describe("Plan. Tecido — dialog Distribuir por loja (Task 6)", () => {
  const dlg = ler("src/components/plan-tecido/DistribuirPorLojaDialog.tsx");
  const tab = ler("src/components/plan-tecido/DistribuicaoTabelas.tsx");
  const card = ler("src/components/plan-tecido/ModelCard.tsx");
  it("presença (R19): overlay PRÓPRIO com scope no corpo rolável; marcador de página ao abrir; banner de quem está no produto", () => {
    expect(dlg).toContain("<ColabPresenceOverlay presentes={presentes} scopeRef={corpoRef} />");
    expect(dlg).toContain('ref={corpoRef} className="min-h-0 space-y-3 overflow-y-auto py-2"');
    expect(dlg).toContain("onFoco?.(pathDistAberto(slotKey));");
    expect(dlg).toContain("pathEhDoProduto(p.campoFocado, slotKey)");
  });
  it("todo campo do dialog tem data-colab-path próprio: proporção, Base e cada quadradinho", () => {
    expect(tab).toContain("pathDistProp(p.slotKey, t)");
    expect(tab).toContain("pathDistBase(p.slotKey, l.id, c.key)");
    expect(tab).toContain("pathDistCel(p.slotKey, l.id, c.key, t)");
    expect(tab).toContain("data-colab-path={path}");
  });
  it("textos do mockup", () => {
    // Dono 26/set: "você digita" e "da cor na loja" saíram do cabeçalho (desnecessários).
    expect(tab).not.toContain("você digita");
    expect(tab).not.toContain("da cor na loja");
    for (const s of ["Loja / Cor", "Tamanhos: proporção × Base · dá para corrigir à mão",
      "Proporção por tamanho", "do card", "Total por cor × tamanho", "Soma das lojas. É o que preenche o pç de cada cor do Tecido 1 no card.",
      "soma das lojas", "= pç no card", "sem distribuição · pç do card", "Editado à mão · calculado seria"]) expect(tab, s).toContain(s);
    for (const s of ["Distribuir por loja", "Salvar preenche o pç", "Grava de vez no Salvar do plano.", "Por loja · deslize para o lado",
      "Descartar alterações?", "TEXTO_AJUDA_DIST"]) expect(dlg, s).toContain(s);
  });
  it("T6 fix1 · m9: rodapé do Salvar no singular ('da 1 cor') e no plural ('das N cores')", () => {
    expect(dlg).toContain("n === 1 ? `da ${n} cor` : `das ${n} cores`");
  });
  it("impressão = o que o dialog mostra, sem botões; salvar/zerar/descartar", () => {
    expect(dlg).toContain("<PrintArea>");
    expect(dlg).toContain('tabelas("impressao")');
    expect(dlg).toContain("printWithImages()");
    expect(dlg).toContain("setZeradas(nomes)");
  });
  it("PR16 (G-plano R7, P-09 no celular): o ponto abre um balão com o calculado e um ↺ SEPARADO; tocar no ponto não volta sozinho", () => {
    expect(tab).toContain("function PontoManual(");
    expect(tab).toContain("onClick={() => { onVoltar(); setAberto(false); }}");
    expect(tab).not.toContain("clique para voltar ao calculado");
    expect(dlg).not.toContain("<fieldset disabled"); // só leitura (P-22) ainda abre o balão do calculado e o nome completo
    expect(conta(tab, "onVoltar(")).toBe(1);
  });
  it("P-36 = B: Imprimir só no desktop (a PrintArea fica)", () => {
    expect(dlg).toContain('size="sm" className="max-sm:hidden" onClick={() => void printWithImages()}');
    expect(dlg).toContain("<PrintArea>");
  });
  it("o card monta o botão (Tecido 1, com o módulo) e o dialog só quando aberto", () => {
    expect(card).toContain("Distribuir por loja");
    expect(card).toMatch(/acaoExtra=\{distribuicaoLigada && ehTecido1\(m\) \?/);
    expect(card).toContain("{distOpen && (");
    expect(card).toContain("<DistribuirPorLojaDialog");
  });
  it("Ruling do controlador (revisão T5/M1): o gatilho 'Distribuir por loja' NÃO é um <button> nativo — o fieldset do " +
    "SheetContent (modo só-leitura da página) o desabilitaria em silêncio; usa role=\"button\" + tabIndex, igual ao " +
    "padrão já usado em ImagePreview.tsx para escapar de um fieldset ancestral", () => {
    const idx = card.indexOf('<Store className="h-4 w-4" />Distribuir por loja');
    expect(idx).toBeGreaterThan(-1);
    const trechoAntes = card.slice(Math.max(0, idx - 1600), idx);
    // é uma <div role="button">, não um <button>
    expect(trechoAntes).toContain('role="button"');
    expect(trechoAntes).toContain("tabIndex={");
    expect(trechoAntes).toContain("onKeyDown={");
    expect(trechoAntes).not.toMatch(/<button[^>]*>\s*<Store/);
  });
  it("Achado próprio (Task 6): o <DialogContent> TAMBÉM embrulha seus filhos num fieldset (dialog.tsx) — Imprimir e " +
    "Voltar, sendo <button> nativos dentro do dialog, ficariam travados no mesmo modo só-leitura de página; os dois " +
    "usam Button asChild + role=\"button\" (mesma fuga da Slot já usada no gatilho do card)", () => {
    const imprimirIdx = dlg.indexOf("printWithImages()");
    const trechoImprimir = dlg.slice(Math.max(0, imprimirIdx - 400), imprimirIdx + 400);
    expect(trechoImprimir).toContain("Button asChild");
    expect(trechoImprimir).toContain('role="button"');
    const voltarIdx = dlg.indexOf('aria-label="Voltar"');
    const trechoVoltar = dlg.slice(Math.max(0, voltarIdx - 400), voltarIdx + 400);
    expect(trechoVoltar).toContain("Button asChild");
    expect(trechoVoltar).toContain('role="button"');
  });
  it("Achado próprio (Task 6): os 2 PopoverTrigger de DistribuicaoTabelas (nome completo abreviado; ponto à mão) " +
    "usam role=\"button\" em vez de <button> — eles NÃO são portalados (o PopoverContent é; o trigger renderiza no " +
    "lugar, dentro do fieldset do DialogContent) e precisam continuar abrindo em modo só-leitura (P-22)", () => {
    expect(conta(tab, 'PopoverTrigger asChild')).toBe(2);
    expect(conta(tab, 'role="button"')).toBe(2);
    expect(tab).not.toMatch(/<button/);
  });
});

describe("Plan. Tecido — dialog Distribuir por loja (Task 6 fix1)", () => {
  const dlg = ler("src/components/plan-tecido/DistribuirPorLojaDialog.tsx");
  const tab = ler("src/components/plan-tecido/DistribuicaoTabelas.tsx");
  const card = ler("src/components/plan-tecido/ModelCard.tsx");
  const atendimento = ler("src/lib/plan-tecido/atendimento.ts");

  it("T6 fix1 · I1 (constante COL1 ajustada no fix2 · N2 — ver 3º describe): nenhuma célula fixa (COL1) usa fundo " +
    "translúcido (bg-*/NN) — só tons OPACOS", () => {
    // toda ocorrência de `${COL1}` DENTRO de um className= (não em comentário/prosa) é seguida de um `!bg-`
    // opaco (sem fração /NN logo depois do nome do tom).
    const usos = [...tab.matchAll(/className=\{`\$\{COL1\}[^`]*`\}/g)].map((m) => m[0]);
    expect(usos.length).toBeGreaterThan(0);
    for (const u of usos) {
      const comFracao = u.match(/!?bg-[a-z]+\/\d+/);
      expect(comFracao, u).toBeNull();
      expect(u, u).toMatch(/!bg-[a-z]+(?!\/)/);
    }
  });
  it("T6 fix1 · m1: a versão de impressão do cabeçalho NÃO leva o InfoHover (impressão sem botões)", () => {
    expect(dlg).toContain("const cabecalho = (impressao: boolean) =>");
    expect(dlg).toContain("{!impressao && (");
    expect(dlg).toContain("{cabecalho(true)}");
    expect(dlg).toContain("{cabecalho(false)}");
  });
  it("T6 fix1 · m2: o gatilho do card usa buttonVariants (não classes copiadas), ícone 16px, sem pointer-events-none", () => {
    expect(card).toContain('import { Button, buttonVariants } from "@/components/ui/button";');
    expect(card).toContain('cn(buttonVariants({ variant: "outline", size: "sm" })');
    expect(card).toContain('<Store className="h-4 w-4" />Distribuir por loja');
    expect(card).not.toContain("pointer-events-none");
  });
  it("T6 fix1 · m3: erro na query de lojas mostra toast + aviso — não abre a tabela como se estivesse vazia", () => {
    expect(dlg).toContain('import { toast } from "sonner";');
    expect(dlg).toContain("isError: lojasErro");
    expect(dlg).toContain("toast.error(mensagemErro(lojasErroObj");
    expect(dlg).toContain("lojasErro ? (");
    expect(dlg).toContain("const podeImprimir = lojasProntas && !lojasErro;");
  });
  it("T6 fix1 · m4: comDado une as chaves do rascunho ATUAL e do SNAPSHOT da abertura (loja inativa não some ao editar)", () => {
    expect(dlg).toContain("...Object.values(dists).flatMap((d) => Object.keys(d)),");
    expect(dlg).toContain("...Object.values(inicial.dists).flatMap((d) => Object.keys(d)),");
  });
  it("T6 fix1 · m5: dirty usa comparação CANÔNICA (igual/canon de atendimento.ts) — nada de JSON.stringify cru", () => {
    expect(atendimento).toContain("export function canon(");
    expect(atendimento).toContain("export const igual = ");
    expect(dlg).toContain('import { ehTecido1, igual } from "@/lib/plan-tecido/atendimento";');
    expect(dlg).toContain("const dirty = !igual({ prop, dists }, inicial);");
    expect(dlg).toContain("const propMudou = !igual(prop, inicial.prop);");
    expect(dlg).not.toMatch(/JSON\.stringify\(\{ ?prop, ?dists ?\}\)/);
  });
  it("T6 fix1 · m6 (implementação corrigida no fix2 · N1 — ver 3º describe): no desktop o balão do ponto abre no " +
    "HOVER do mouse; clique/toque continua abrindo; ↺ separado", () => {
    expect(tab).toContain("function PontoManual(");
    expect(tab).toContain("onClick={() => { onVoltar(); setAberto(false); }}");
  });
  it("T6 fix1 · m7: nome da cor abreviado em 2 linhas; rótulo curto 'Proporção'/'Total' abaixo de 640px", () => {
    expect(tab).toContain("const corAbrev = abreviarNome(c.cor);");
    expect(tab).toContain("const apelidoAbrev = c.apelido ? abreviarNome(c.apelido) : null;");
    expect(tab).toContain('<span className="block truncate">{corAbrev}</span>');
    expect(tab).toContain('<span className="sm:hidden">Proporção</span>');
    expect(tab).toContain('<span className="sm:hidden">Total</span>');
  });
  it("T6 fix1 · m8: em só-leitura a célula mostra TEXTO (igual à impressão), não um input desabilitado esmaecido", () => {
    expect(tab).toContain("bloqueado ? (");
    expect(tab).toContain("<span className={extra} aria-label={aria} data-colab-path={path}>{valor || 0}</span>");
    expect(tab).not.toContain("disabled={bloqueado}");
  });
  it("T6 fix1 · m9: preventDefault no Espaço do nome abreviado; foco visível nos 2 gatilhos; zerar mostra cor+apelido", () => {
    expect(tab).toContain('onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}');
    expect(conta(tab, "focus-visible:ring")).toBeGreaterThanOrEqual(2);
    expect(dlg).toContain("const rotuloCor = (v: PtVariante): string => {");
    expect(dlg).toContain("nomes.push(rotuloCor(v));");
  });
});

describe("Plan. Tecido — dialog Distribuir por loja (Task 6 fix2)", () => {
  const tab = ler("src/components/plan-tecido/DistribuicaoTabelas.tsx");
  const card = ler("src/components/plan-tecido/ModelCard.tsx");

  it("T6 fix2 · N1: o hover só abre/fecha para pointerType === \"mouse\" (padrão InfoHover) — nada de mouseenter/mouseleave", () => {
    expect(tab).toContain('e.pointerType === "mouse"');
    expect(tab).toContain("onPointerEnter={(e) => {");
    expect(tab).toContain("onPointerLeave={(e) => { if (e.pointerType === \"mouse\") agendarFechar(); }}");
    expect(tab).not.toMatch(/onMouseEnter|onMouseLeave/);
  });
  it("T6 fix2 · N1: clique com mouse faz preventDefault e NÃO alterna (evita piscar) — toque/caneta abrem; teclado alterna", () => {
    expect(tab).toContain('if (tipo === "mouse") { e.preventDefault(); setAberto(true); return; }');
    expect(tab).toContain('if (tipo === "touch" || tipo === "pen") setAberto(true);');
    expect(tab).toContain("else setAberto((o) => !o);");
  });
  it("T6 fix2 · N1: onOpenAutoFocus/onCloseAutoFocus só fazem preventDefault quando o balão abriu por HOVER", () => {
    expect(tab).toContain("const abriuPorHover = useRef(false);");
    expect(tab).toContain("onOpenAutoFocus={(e) => { if (abriuPorHover.current) e.preventDefault(); }}");
    expect(tab).toContain("onCloseAutoFocus={(e) => { if (abriuPorHover.current) e.preventDefault(); }}");
    // teclado e clique real (não-mouse) desligam a flag — o foco automático de acessibilidade some intacto
    expect(tab).toContain("abriuPorHover.current = false;");
  });
  it("T6 fix2 · N2: a constante COL1 não carrega bg- nenhum — toda célula fixa soma o SEU tom opaco", () => {
    expect(tab).toContain('const COL1 = "sticky left-0 z-10 border px-2 py-1 text-left";');
    expect(tab).not.toMatch(/const COL1 = "[^"]*bg-/);
  });
  it("T6 fix2 · N3: o gatilho do card reusa a MESMA chamada de buttonVariants dos botões vizinhos (altura igual) e não muda de cor no hover quando aria-disabled", () => {
    const idxGatilho = card.indexOf('buttonVariants({ variant: "outline", size: "sm" })');
    const idxVizinho = card.indexOf('variant: "outline"');
    expect(idxGatilho).toBeGreaterThan(-1);
    expect(idxVizinho).toBeGreaterThan(-1);
    expect(card).toContain("hover:!bg-transparent");
    expect(card).toContain("hover:!text-muted-foreground");
  });
});

describe("Plan. Tecido — dialog Distribuir por loja (impressão em paisagem + 2 colunas, pedido do dono 26/set)", () => {
  const dlg = ler("src/components/plan-tecido/DistribuirPorLojaDialog.tsx");
  const tab = ler("src/components/plan-tecido/DistribuicaoTabelas.tsx");
  const css = ler("src/styles.css");

  it("a impressão do Distribuir por loja é A4 PAISAGEM, só ENQUANTO o dialog está aberto (dentro da PrintArea)", () => {
    expect(dlg).toContain('<style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>');
    // a tag de paisagem vem DEPOIS da abertura da PrintArea e ANTES do conteúdo impresso — só existe
    // enquanto o dialog está montado (a PrintArea inteira é condicional a `podeImprimir`)
    const printAreaIdx = dlg.indexOf("<PrintArea>");
    const landscapeIdx = dlg.indexOf("@page { size: A4 landscape");
    const conteudoIdx = dlg.indexOf('{tabelas("impressao")}');
    expect(printAreaIdx).toBeGreaterThan(-1);
    expect(landscapeIdx).toBeGreaterThan(printAreaIdx);
    expect(conteudoIdx).toBeGreaterThan(landscapeIdx);
  });

  it("o @page global (retrato, styles.css) NÃO muda — só esta impressão vira paisagem, o resto do app continua A4 retrato", () => {
    expect(css).toContain("@page { size: A4; margin: 12mm; }");
    // landscape só aparece no dialog do Distribuir por loja — em nenhum outro arquivo fonte
    expect(css).not.toContain("landscape");
  });

  it("regra de 2 colunas: limiar > 10 linhas de cor por tabela de loja, só na IMPRESSÃO (a tela em modo edicao não muda)", () => {
    expect(tab).toContain("const LIMIAR_2_COLUNAS = 10;");
    expect(tab).toContain("const duasColunas = imp && p.cores.length > LIMIAR_2_COLUNAS;");
    // container de 2 colunas só é usado no ramo de impressão (`imp && duasColunas`)
    expect(tab).toContain("{imp && duasColunas ? (");
    expect(tab).toContain('<div className="print-2col" aria-label="Distribuição por loja e cor">');
    // cada tabela de loja não pode partir ao meio entre colunas/páginas
    expect(tab).toContain('className="print-quebra-evitar mb-3 w-full border-collapse text-sm"');
  });

  it("CSS do 2-colunas/quebra existe e está escopado à .print-area (não vaza pra fora da impressão)", () => {
    expect(css).toContain(".print-area .print-2col { columns: 2; column-gap: 6mm; }");
    expect(css).toContain(".print-area .print-quebra-evitar { page-break-inside: avoid; break-inside: avoid; }");
  });

  it("poucas variantes (≤10) continuam em 1 coluna/1 tabela só, como antes", () => {
    // o ramo 'else' (1 tabela única com todas as lojas dentro) continua existindo para esse caso
    expect(tab).toContain('<div className="overflow-x-auto rounded border">');
    expect(tab).toContain('<table className="w-full min-w-[640px] border-collapse text-sm" aria-label="Distribuição por loja e cor">');
  });
});

