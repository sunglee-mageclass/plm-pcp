// Seção 1 "Informações Gerais do Produto" do detalhe do Planejamento. Extraída na F3.0 (set/2026)
// de `PlanejamentoDetail.tsx` SEM mudança de comportamento: o JSX abaixo foi MOVIDO como estava; o
// estado continua no orquestrador e chega por props com os MESMOS nomes. F3.1: "Descrição do produto" no
// fim da seção (último campo, largura total) e "— Nenhum —" no Estilista.
import type { Dispatch, SetStateAction } from "react";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { STATUS_OPTS, type Opt, type CatOpt, type SubOpt, type Draft } from "@/components/planejamento/modelo-shared";
import { Secao, FieldText, FieldSelect } from "@/components/planejamento/planejamento-detail/campos";
import type { OpcaoOrigem } from "@/components/planejamento/planejamento-detail/comprado";

export function InfoGeraisSecao({
  draft, setDraftTracked, grupoSel, setGrupoSel, grupos, categorias, estilistas, sub1Opts, sub2Opts, fl, numero, selo, origemOpcoes,
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
}) {
  return (
          <Secao id="info" titulo="Informações Gerais do Produto" numero={numero} selo={selo}>
            {/* Linha 1: Status · Nome · Estilista · Origem */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="grid gap-1">
                <Label>Status</Label>
                <Select value={draft.status_planejamento} onValueChange={(v) => setDraftTracked((d) => ({ ...d, status_planejamento: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldText
                label="Nome do Modelo"
                value={draft.nome}
                onChange={(v) => setDraftTracked((d) => ({ ...d, nome: v }))}
                colabPath="nome"
              />
              <FieldSelect
                label={fl("estilista")}
                value={draft.estilista_id}
                onChange={(v) => setDraftTracked((d) => ({ ...d, estilista_id: v }))}
                onLimpar={() => setDraftTracked((d) => ({ ...d, estilista_id: null }))}
                options={estilistas}
              />
              <div className="grid gap-1">
                <Label>Origem</Label>
                <Select value={draft.origem} onValueChange={(v) => setDraftTracked((d) => ({ ...d, origem: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {origemOpcoes.map((o) => (
                      <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* F3.4 — D1: por que a troca está travada (item desabilitado do Radix não mostra `title`). */}
                {origemOpcoes.some((o) => o.disabled && o.motivo) && (
                  <p className="text-xs text-muted-foreground">{origemOpcoes.find((o) => o.disabled && o.motivo)?.motivo}</p>
                )}
              </div>
            </div>

            {/* Linha 2: Versão (editável; versão≥2 = repetição — badge ↻ vN e filtros derivam de
                versao>1; corrige a versão automática errada; clamp mínimo 1, coluna NOT NULL). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
            </div>

            {/* Linha 3: Grupo · Categoria · Subcategoria 1 · Subcategoria 2 */}
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

            {/* Campo NOVO "Descrição do produto" (dono, 22/set): texto longo, largura total, ÚLTIMO campo da
                seção 1 — no Sheet e no Dialog de card novo. Coluna `modelos.descricao_produto` (migration
                20260930180000); o Salvar manda NULL quando vazio. Não vai para a Ficha Técnica (não pedido). */}
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
          </Secao>
  );
}
