// Seção 1 "Informações Gerais do Produto" do detalhe do Planejamento. Extraída na F3.0 (set/2026)
// de `PlanejamentoDetail.tsx` SEM mudança de comportamento: o JSX abaixo foi MOVIDO como estava; o
// estado continua no orquestrador e chega por props com os MESMOS nomes. F3.1: "Descrição do produto" no
// fim da seção (último campo, largura total) e "— Nenhum —" no Estilista.
// F3.6 (Parte B — spec 2026-09-25 §5.1): L1 Status | Estilista | Origem · L2 Nome do Modelo (50%) | Versão (25%) | NCM do
// Produto (25%) · L3 Grupo · Categoria · Sub 1 · Sub 2 · L4 Título para a página (automático / editado / ↺) · L5 Descrição ·
// L6 Peso (kg) | Comprimento | Largura | Altura (cm). Os mesmos campos no Dialog "Novo Modelo" (ruling 8).
import type { Dispatch, SetStateAction } from "react";
import { RotateCcw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { STATUS_OPTS, type Opt, type CatOpt, type SubOpt, type Draft } from "@/components/planejamento/modelo-shared";
import { Secao, FieldText, FieldSelect } from "@/components/planejamento/planejamento-detail/campos";
import type { OpcaoOrigem } from "@/components/planejamento/planejamento-detail/comprado";
import { InfoHover } from "@/components/shared/InfoHover";
import { filtrarNcm, numeroDoInput } from "@/components/planejamento/planejamento-detail/helpers";
import { tituloAoDigitar, tituloAoSair, tituloExibido, tituloPaginaCalculado } from "@/lib/titulo-pagina";

/** "i" ao lado de "Origem" com o motivo de cada opção travada — opções com o MESMO motivo (ex.: edição pendente)
 *  saem numa linha só ("Revenda, Importado: …"). Sem opção travada ⇒ não renderiza nada. */
function MotivosOrigemInfo({ opcoes }: { opcoes: OpcaoOrigem[] }) {
  const porMotivo = new Map<string, string[]>();
  for (const o of opcoes) {
    if (!o.disabled || !o.motivo) continue;
    porMotivo.set(o.motivo, [...(porMotivo.get(o.motivo) ?? []), o.label]);
  }
  if (porMotivo.size === 0) return null;
  return (
    <InfoHover ariaLabel="Por que algumas origens estão travadas?">
      {[...porMotivo].map(([motivo, labels]) => (
        <p key={motivo}><span className="font-semibold">{labels.join(", ")}:</span> {motivo}</p>
      ))}
    </InfoHover>
  );
}

// L6 (ruling 2 + R4): MoneyInput limita as casas NA DIGITAÇÃO (3 no peso, 2 nas medidas) e emite "" quando vazio (NULL = vazio
// com placeholder — ui-padroes §D); o NumberInput viraria "0" (0 é medida válida) e não limita casas.
const MEDIDAS = [
  { key: "peso_kg", label: "Peso (kg)", casas: 3, placeholder: "0,000" },
  { key: "comprimento_cm", label: "Comprimento (cm)", casas: 2, placeholder: "0,00" },
  { key: "largura_cm", label: "Largura (cm)", casas: 2, placeholder: "0,00" },
  { key: "altura_cm", label: "Altura (cm)", casas: 2, placeholder: "0,00" },
] as const;
type ChaveMedida = (typeof MEDIDAS)[number]["key"];
const comMedida = (d: Draft, k: ChaveMedida, v: number | null): Draft => {
  const out = { ...d };
  out[k] = v;
  return out;
};

export function InfoGeraisSecao({
  draft, setDraftTracked, grupoSel, setGrupoSel, grupos, categorias, estilistas, sub1Opts, sub2Opts, fl, numero, selo, origemOpcoes,
  nomeLoja, planBloqueado, compartilhadoBloqueado,
}: {
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  grupoSel: string | null;
  setGrupoSel: Dispatch<SetStateAction<string | null>>;
  grupos: Opt[];
  categorias: CatOpt[];
  estilistas: Opt[];
  sub1Opts: SubOpt[];
  sub2Opts: SubOpt[];
  fl: ReturnType<typeof useFieldLabels>;
  /** F3.3 — numeração e selo da seção (orquestrador). */
  numero?: number;
  selo?: React.ReactNode;
  /** F3.4 — opções do Select "Origem" (com "Importado" pelo módulo; troca travada pelas regras da D1 — `opcoesOrigem`). */
  origemOpcoes: OpcaoOrigem[];
  /** F3.6 — `tenants.nome` (a MARCA da loja — ruling 1) p/ o Título automático; null enquanto carrega (título sem " | "). */
  nomeLoja: string | null;
  /** P-53 A — campos que SÓ o Sheet antigo do Planejamento editava: Status, Origem, Versão, NCM, Título para a
   *  página, Peso/Comprimento/Largura/Altura, Descrição do produto (fix 1, m-4: o Dev antigo nunca teve esse campo). */
  planBloqueado: boolean;
  /** P-53 A — campos que os DOIS Sheets antigos editavam: Nome, Estilista, Grupo/Categoria/Subcategorias. */
  compartilhadoBloqueado: boolean;
}) {
  const tituloCalculado = tituloPaginaCalculado(draft.nome, nomeLoja);
  const tituloAutomatico = draft.titulo_pagina === null;
  return (
          <Secao id="info" titulo="Informações Gerais do Produto" numero={numero} selo={selo}>
            {/* L1: Status · Estilista · Origem (F3.6: o Nome foi para a L2). P-53 A: Status/Origem são SÓ do
                Planejamento; Estilista é COMPARTILHADO (o Dev também grava). */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <fieldset disabled={planBloqueado} className="contents">
                <div className="grid gap-1">
                  <Label>Status</Label>
                  <Select value={draft.status_planejamento} onValueChange={(v) => setDraftTracked((d) => ({ ...d, status_planejamento: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </fieldset>
              <fieldset disabled={compartilhadoBloqueado} className="contents">
                <FieldSelect
                  label={fl("estilista")}
                  value={draft.estilista_id}
                  onChange={(v) => setDraftTracked((d) => ({ ...d, estilista_id: v }))}
                  onLimpar={() => setDraftTracked((d) => ({ ...d, estilista_id: null }))}
                  options={estilistas}
                />
              </fieldset>
              <fieldset disabled={planBloqueado} className="contents">
                <div className="grid gap-1">
                  {/* F3.4 — D1: por que a troca está travada (item desabilitado do Radix não mostra `title`). Dono 25/set:
                      sem texto fixo embaixo do campo — o motivo aparece no "i" ao lado do rótulo, ao passar o mouse. */}
                  <div className="flex items-center gap-1.5">
                    <Label>Origem</Label>
                    <MotivosOrigemInfo opcoes={origemOpcoes} />
                  </div>
                  <Select value={draft.origem} onValueChange={(v) => setDraftTracked((d) => ({ ...d, origem: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {origemOpcoes.map((o) => (
                        <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </fieldset>
            </div>

            {/* L2 (decisão do dono 25/set): Nome do Modelo 50% · Versão 25% · NCM do Produto 25%. Versão editável (versão≥2 =
                repetição — badge ↻ vN; clamp mínimo 1, coluna NOT NULL). NCM = texto simples, sem tabela oficial nem sugestão
                (ruling 3): só dígitos e pontos, até 10 — a vírgula do teclado decimal do iOS vira ponto (R30); vazio grava NULL. */}
            <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-3">
              <fieldset disabled={compartilhadoBloqueado} className="contents">
                <FieldText
                  label="Nome do Modelo"
                  value={draft.nome}
                  onChange={(v) => setDraftTracked((d) => ({ ...d, nome: v }))}
                  colabPath="nome"
                />
              </fieldset>
              <fieldset disabled={planBloqueado} className="contents">
                <div className="grid gap-1">
                  <Label>Versão</Label>
                  <NumberInput
                    integer
                    value={draft.versao}
                    onChange={(e) => {
                      const n = Math.max(1, Math.trunc(Number(e.target.value) || 1));
                      setDraftTracked((d) => ({ ...d, versao: n }));
                    }}
                    data-colab-path="versao"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="ncm-produto">NCM do Produto</Label>
                  {/* P8 (fix1) — SEM `maxLength`: cortava o texto COLADO antes de `filtrarNcm` rodar (ex.: "NCM: 6204.43.00"
                      virava "6204." — o prefixo "NCM: " já consumia os 10 caracteres). `filtrarNcm` já limita a 10. */}
                  <Input
                    id="ncm-produto"
                    inputMode="decimal"
                    placeholder="0000.00.00"
                    value={draft.ncm ?? ""}
                    onChange={(e) => { const v = filtrarNcm(e.target.value); setDraftTracked((d) => ({ ...d, ncm: v === "" ? null : v })); }}
                    data-colab-path="ncm"
                  />
                </div>
              </fieldset>
            </div>

            {/* Linha 3: Grupo · Categoria · Subcategoria 1 · Subcategoria 2 — COMPARTILHADOS (o Dev também grava). */}
            <fieldset disabled={compartilhadoBloqueado} className="contents">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <FieldSelect
                label="Grupo"
                value={grupoSel}
                onChange={(v) => {
                  setGrupoSel(v);
                  // Se a categoria atual não pertence ao novo grupo, limpa categoria + subs.
                  const cat = categorias.find((c) => c.id === draft.categoria_principal_id);
                  if (cat && cat.grupo_id !== v) setDraftTracked((d) => ({ ...d, categoria_principal_id: null, subcategoria1_id: null, subcategoria2_id: null }));
                }}
                options={grupos}
              />
              <FieldSelect
                label="Categoria"
                value={draft.categoria_principal_id}
                onChange={(v) => {
                  // Mantém o Grupo coerente e reseta as subcategorias (pertencem à categoria).
                  const cat = categorias.find((c) => c.id === v);
                  if (cat?.grupo_id) setGrupoSel(cat.grupo_id);
                  setDraftTracked((d) => ({ ...d, categoria_principal_id: v, subcategoria1_id: null, subcategoria2_id: null }));
                }}
                options={grupoSel ? categorias.filter((c) => c.grupo_id === grupoSel) : categorias}
              />
              <FieldSelect
                label="Subcategoria 1"
                value={draft.subcategoria1_id}
                onChange={(v) => setDraftTracked((d) => ({ ...d, subcategoria1_id: v }))}
                options={sub1Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
              <FieldSelect
                label="Subcategoria 2"
                value={draft.subcategoria2_id}
                onChange={(v) => setDraftTracked((d) => ({ ...d, subcategoria2_id: v }))}
                options={sub2Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
            </div>
            </fieldset>

            {/* L4 (ruling 1): Título para a página. NULL = AUTOMÁTICO (Nome em iniciais maiúsculas + " | " + loja, ao vivo a
                cada tecla no Nome; Nome vazio ⇒ vazio, nunca " | Loja" solto). Digitar algo DIFERENTE vira manual (R5); esvaziar
                volta ao automático no blur (R6); ↺ grava NULL. O merge compara o campo como qualquer outro (ruling 9). */}
            {/* P-53 A: Título para a página é SÓ do Planejamento. */}
            <fieldset disabled={planBloqueado} className="contents">
            <div className="grid gap-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="titulo-pagina">Título para a página</Label>
                {/* Dono 26/set: a explicação sai de baixo do campo e vira hover (padrão InfoHover — nunca texto fixo). */}
                <InfoHover ariaLabel="Como funciona o Título para a página?">
                  <p>Acompanha o Nome do Modelo + o nome da loja enquanto ninguém editar. Editado à mão, fica fixo até clicar em ↺.</p>
                </InfoHover>
                {tituloAutomatico && tituloCalculado !== "" && (
                  <StatusBadge tone="neutral" className="rounded-full px-2 py-0.5 normal-case tracking-normal">automático</StatusBadge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="titulo-pagina"
                  className="min-w-0 flex-1"
                  placeholder="Nome do Modelo | Nome da loja"
                  value={tituloExibido(draft.titulo_pagina, tituloCalculado)}
                  onChange={(e) => { const v = e.target.value; setDraftTracked((d) => ({ ...d, titulo_pagina: tituloAoDigitar(v, tituloCalculado) })); }}
                  onBlur={() => setDraftTracked((d) => ({ ...d, titulo_pagina: tituloAoSair(d.titulo_pagina, tituloCalculado) }))}
                  data-colab-path="titulo_pagina"
                />
                {/* P9 (fix1) — `max-md:min-h-11` (não `max-sm:`): alinha com o `Input` acima, que é `max-md:h-11`
                    (640–767px também ganha alvo de toque de 44px, não só <640px). */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 max-md:min-h-11"
                  disabled={tituloAutomatico}
                  onClick={() => setDraftTracked((d) => ({ ...d, titulo_pagina: null }))}
                  aria-label="Título: voltar ao automático"
                  title="Voltar ao automático"
                >
                  <RotateCcw className="h-4 w-4 sm:mr-1" />
                  <span className="max-sm:sr-only">automático</span>
                </Button>
              </div>
            </div>
            </fieldset>

            {/* Campo NOVO "Descrição do produto" (dono, 22/set): texto longo, largura total, ÚLTIMO campo da
                seção 1 — no Sheet e no Dialog de card novo. Coluna `modelos.descricao_produto` (migration
                20260930180000); o Salvar manda NULL quando vazio. Não vai para a Ficha Técnica (não pedido). */}
            {/* P-53 A (fix 1, m-4 RULING): Descrição do produto é SÓ do Planejamento — o Dev antigo NUNCA teve
                esse campo (o brief da rodada 1 errou ao classificá-lo como compartilhado). */}
            <fieldset disabled={planBloqueado} className="contents">
            <div className="grid gap-1">
              <Label>Descrição do produto</Label>
              <Textarea
                rows={3}
                placeholder="Descreva o produto…"
                value={draft.descricao_produto}
                onChange={(e) => setDraftTracked((d) => ({ ...d, descricao_produto: e.target.value }))}
                data-colab-path="descricao_produto"
              />
            </div>
            </fieldset>

            {/* L6 (ruling 2): Peso (kg, 3 casas) · Comprimento · Largura · Altura (cm, 2 casas). NULL = vazio; 0 vale.
                P-53 A: SÓ do Planejamento. */}
            <fieldset disabled={planBloqueado} className="contents">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {MEDIDAS.map((m) => (
                <div key={m.key} className="grid gap-1">
                  <Label htmlFor={`medida-${m.key}`}>{m.label}</Label>
                  <MoneyInput
                    id={`medida-${m.key}`}
                    decimals={m.casas}
                    fixedDecimals
                    placeholder={m.placeholder}
                    value={draft[m.key] ?? ""}
                    onChange={(e) => { const v = numeroDoInput(e.target.value); setDraftTracked((d) => comMedida(d, m.key, v)); }}
                    data-colab-path={m.key}
                  />
                </div>
              ))}
            </div>
            </fieldset>
          </Secao>
  );
}
