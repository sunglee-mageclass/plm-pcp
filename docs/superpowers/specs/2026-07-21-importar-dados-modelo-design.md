# Importar dados de outro modelo (card de Desenvolvimento) — Design

**Data:** 2026-07-21
**Módulo:** `criacao` (Desenvolvimento)
**Status:** aprovado no brainstorm (decisões abaixo); pronto para plano.

---

## 1. Objetivo
Dar ao usuário um botão **"Importar dados"** no card de Desenvolvimento que **copia dados de outro modelo** para o modelo aberto, para agilizar o cadastro (não redigitar BOM, grade, observações, etc.). O usuário escolhe a **origem** e **quais áreas/itens** quer trazer; os valores **preenchem o formulário** (não gravam), ficam **destacados em amarelo** para revisão, e só o **Salvar** existente comita.

Princípio central: **staging no front-end**. "Copiar" nunca grava no banco — preenche o rascunho (draft) do card. Reuso total do caminho de salvar já existente (`salvar_modelo_bom` + update de `modelos`). **Zero RPC nova de escrita.**

## 2. Decisões travadas (do brainstorm)
| Tema | Decisão |
|---|---|
| **Modelo de execução** | **Staging**: copiar preenche o formulário; só o **Salvar** grava. |
| **Local do botão** | **Cabeçalho** do card, ao lado do `VersaoBadge` (Opção A). Visível só com o card **editável**. |
| **Destaque visual** | Campos copiados com **fundo amarelo**; ao **editar**, volta à cor normal. Auxílio de sessão (pré-Salvar), não persistido. |
| **Sobrescrita** | Se a cópia for substituir dado já preenchido, **AlertDialog** lista o que muda e **obriga confirmar**. Destino vazio → copia direto. |
| **Anexos** | **Não copiáveis** (arquivos no Storage; evita referência compartilhada e cópia de storage). |
| **OC-links** | **Não copiados** (a alocação de OC é do modelo de origem). Variante entra sem vínculo de OC. |
| **Custos** | Totais **recalculam** sozinhos ao copiar tecidos/aviamentos; copiável de fato é só `custos_adicionais`. |
| **Modelo travado** | Import indisponível quando `enviado_cad` (só com card editável). |
| **Origem** | Qualquer modelo da **mesma loja**, com busca por nome/ref. Origem = destino é bloqueado. |
| **Área 3 (Tecidos)** | **Granular**: por bloco (Tecido/Forro/Entretela) escolhe Artigo, Consumo, Variantes. |
| **Grade** | Depende das **Variantes do Tecido 1**: só habilita se `Tecido → Variantes` estiver marcado. |
| **CAD** | Fora (é derivado da seção Tecidos; recalcula sozinho no "Enviar"). |

## 3. Contexto do código (estado atual)
- **Card:** `src/components/desenvolvimento/ModeloDetailPanel.tsx` → `PanelContent(modeloId, onClose)`. É um `Sheet` (painel lateral).
  - **Cabeçalho:** `SheetHeader` (~L1513) com título + `VersaoBadge` (~L1516). ← **lugar do botão**.
  - **Rodapé de ações:** ~L1697–1737 (`Voltar` / `Imprimir Ficha` / `Enviar` / `Editar`/`Salvar`). Estado de trava: `locked = enviado_cad && !editing` (Editar destrava; Salvar re-trava).
- **Seções do card (accordion) e dados:**
  | # | Seção | Componente | Tabela/colunas |
  |---|---|---|---|
  | 1 | Informações Básicas | `ModeloInfoSection` | `modelos` (identidade + `observacoes_tecnicas` manual, [L231](../../../src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx)) |
  | 2 | Ajustes na Prova | `ModeloAjustesProvaSection` | `modelo_prova_comentarios` (thread) |
  | 3 | Tecidos/Forros/Entretelas | `ModeloTecidosSection` | `modelo_tecidos` + `modelo_tecido_variantes` + `modelo_tecido_oc_links` |
  | 4 | CAD | `CadTecidosSection` | `cad_*` (derivado; só após Enviar) |
  | 5 | Aviamentos | `ModeloAviamentosSection` | `modelo_aviamentos` |
  | 6 | Insumos/Etiquetas | `ModeloEtiquetasSection` | `modelo_etiquetas` |
  | 7 | Grade | `ModeloGradeSection` | `modelo_grades` + `modelos.proporcoes` |
  | 8 | Custos | `ModeloCustosSection` | `modelos` (agregados derivados + `custos_adicionais`) |
  | 9 | Anexos | `ModeloAnexosSection` | `modelos` (arquivos + `observacoes_gerais`) |
  | + | Observações (bloco) | `ModeloObservacoes` (abaixo de Anexos, ~L1686) | `modelo_observacoes`; 1ª linha (Composição) **derivada em tempo real, não gravada** |
- **Grade ⟸ Tecido 1:** `ModeloGradeSection` grada por variante do Tecido 1 ("Selecione as variantes do Tecido 1…", [L80](../../../src/components/desenvolvimento/modelo-detail/ModeloGradeSection.tsx)). `modelo_grades.variante_numero` casa com `modelo_tecido_variantes.ordem` do Tecido 1.
- **Salvar (reuso):** RPC `salvar_modelo_bom(_modelo_id, _tecidos, _aviamentos, _grades)` — atômica (DELETE+INSERT de `modelo_tecidos`/variantes/oc_links + `modelo_aviamentos` + `modelo_grades`) e **valida tenant** de cada `artigo_id`/`variante_tecido_id`/`oc_tecido_item_id`/`aviamento_id`. `modelo_etiquetas`, `observacoes_tecnicas`, `proporcoes`, `custos_adicionais` e `modelo_observacoes` são salvos pelos seus próprios caminhos (update em `modelos` / mutations de seção). **Não há padrão de cópia hoje** — este é o primeiro.

## 4. As "8 áreas" do usuário → itens copiáveis
A numeração do usuário (1–8) segue o accordion **pulando o CAD** (derivado). Itens **copiáveis** e o que trazem:

| Item na janela | Copia | Fonte | Regra |
|---|---|---|---|
| **Observações técnicas (manual)** | o campo texto | `modelos.observacoes_tecnicas` | — |
| **Observações (bloco)** | as linhas manuais | `modelo_observacoes` | a Composição (1ª) é derivada → regenera sozinha no destino |
| **Tecidos/Forros/Entretelas** | por bloco: Artigo / Consumo / Variantes (cada um opcional) | `modelo_tecidos` (+`modelo_tecido_variantes`) | casa origem→destino por **tipo+número**; **sem** `modelo_tecido_oc_links` |
| **Aviamentos** | todos | `modelo_aviamentos` | — |
| **Insumos/Etiquetas** | todos | `modelo_etiquetas` | — |
| **Grade** | grade + proporções | `modelo_grades` + `modelos.proporcoes` | **requer** `Tecido → Variantes` |
| **Custos adicionais** | linhas manuais | `modelos.custos_adicionais` | totais recalculam |

**Não copiáveis:** identidade da área 1 (nome, ref, equipe, datas, categoria, status), **Ajustes na Prova**, **Anexos** (arquivos + `observacoes_gerais`), **CAD**.

### Granularidade da área 3 (Tecidos)
Por bloco (Tecido/Forro/Entretela, casados por `tipo`+`numero`):
- **Artigo** — traz o `artigo_id` da origem para aquele bloco.
- **Consumo** — traz `consumo` (+ `loss_percent`) para o bloco casado. Sem "Artigo", só sobrescreve se o destino já tiver um bloco daquele tipo+número.
- **Variantes** — traz `modelo_tecido_variantes` (variante_tecido_id, ordem, multiplicador), **sem** os OC-links.
- Bloco que existe na origem e não no destino é **criado**; item marcado que a origem não tem é ignorado.

## 5. A janela (dialog)
```
Importar dados de outro modelo
──────────────────────────────────────────────
Origem:  [ 🔍 buscar por nome / ref …          ▾ ]
         → Vestido Alça · REF 1234 · v2 · Ana

Áreas a importar:                    [ Selecionar tudo ]
  ☐ Observações técnicas (manual)
  ☐ Observações (bloco)               (menos a Composição auto)
  ☐ Tecidos / Forros / Entretelas ▾
        Tecido    → ☐ Artigo   ☐ Consumo   ☐ Variantes
        Forro     → ☐ Artigo   ☐ Consumo   ☐ Variantes
        Entretela → ☐ Artigo   ☐ Consumo   ☐ Variantes
  ☐ Aviamentos
  ☐ Insumos / Etiquetas
  ⊘ Grade   (requer Variantes do Tecido)
  ☐ Custos adicionais
──────────────────────────────────────────────
                           [ Cancelar ]   [ Copiar ]
```
- **Origem:** combobox/busca sobre `modelos` da loja (nome · ref · versão · estilista). Exclui o próprio modelo.
- **Selecionar tudo:** marca todas as áreas **e** todos os sub-itens (inclui Variantes → habilita e marca a Grade).
- **Grade** desabilitada até `Tecido → Variantes` estar marcado.
- **Ajustes na Prova** e **Anexos** não aparecem.

## 6. Comportamento
### Staging + amarelo
- `Copiar` escreve os valores no rascunho do card **e** registra as chaves afetadas num conjunto `camposCopiados` (no estado do `PanelContent`).
- Cada seção lê `camposCopiados` e aplica classe **amarela** aos campos correspondentes. `onChange` de um campo remove sua chave do conjunto → volta ao normal.
- **Salvar** comita (caminho normal) e **limpa** `camposCopiados`. Recarregar não mostra amarelo (não é persistido).

### Confirmação de sobrescrita
- Ao `Copiar`, calcular o diff contra o rascunho atual. Se algum campo/área selecionado **sobrescreve valor já preenchido**, abrir **AlertDialog** listando as mudanças (ex.: "Consumo Tecido 1: 1,20 → 1,50 · Grade (5 variantes) · 3 aviamentos") e exigir **Confirmar/Cancelar**. Se nada preenchido seria substituído, copia direto.

### Guardas
- **`enviado_cad`:** botão Importar só quando o card está **editável** (mesma condição do Salvar). Para editar um modelo enviado, o usuário clica "Editar" primeiro (fluxo atual).
- **Tenant:** origem/destino da mesma loja (seletor filtra) e o `salvar_modelo_bom` revalida por tenant no Salvar. Sem trabalho extra.
- **Origem = destino:** bloqueado.
- **OC-links:** nunca copiados.
- **Custos:** só `custos_adicionais`; totais recalculam.

## 7. Fluxo
```
[⬇ Importar dados] (cabeçalho, card editável)
      ▼
Janela: Origem + Áreas/itens (+ "Selecionar tudo")  →  [Copiar]
      ▼
Vai sobrescrever?  ── sim ──►  AlertDialog (lista)  ── Confirmar ─┐
      │ não                                                       │
      ▼◄──────────────────────────────────────────────────────── ┘
Campos preenchidos e AMARELOS (nada gravado)
      ▼  revisa / edita (edição tira o amarelo)
[Salvar]  →  salvar_modelo_bom + update modelos + mutations de seção
```

## 8. Arquitetura / componentes
- **Novo:** `ImportarDadosDialog` (componente da janela) — recebe `modeloDestinoId` + o **draft atual** + callback `onAplicar(payloadCopiado, camposCopiados)`.
  - Busca de origem: `useQuery(["modelos-importar", termo])` sobre `modelos` da loja.
  - Leitura da origem: ao escolher, carrega o BOM/observações/grade da origem. **Reusar as queries que o próprio card já usa** para montar um modelo (mesma forma do draft), ou um helper `carregarModeloParaCopia(id)`. Definir no plano (preferência: reusar os hooks existentes para não duplicar shape).
  - Monta o `payloadCopiado` só com as áreas/itens marcados, respeitando as regras (sem OC-links, casamento por tipo+numero, Grade só com Variantes).
- **`PanelContent` (ModeloDetailPanel):**
  - Botão no `SheetHeader` (condicional a editável).
  - Estado `camposCopiados: Set<string>` no draft; `onAplicar` faz merge no draft + popula o conjunto; dispara o AlertDialog de sobrescrita quando necessário.
  - Passa `camposCopiados` (e um `onCampoEditado`) às seções para o realce amarelo.
- **Seções (ModeloInfoSection, ModeloTecidosSection, ModeloGradeSection, ModeloAviamentosSection, ModeloEtiquetasSection, ModeloCustosSection, ModeloObservacoes):** aceitam props opcionais para (a) aplicar a classe amarela aos campos em `camposCopiados` e (b) limpar a marca no `onChange`. Mudança aditiva e localizada por seção.
- **Chave de campo (`camposCopiados`):** string estável por campo, ex.: `obs_tecnicas`, `tecido:tecido:1:consumo`, `tecido:forro:1:artigo`, `grade:3`, `aviamento:<id>`, `etiqueta:<id>`, `custos_adicionais`, `obs_bloco:<ordem>`. Definir o esquema exato no plano.

**Sem migration** (nenhuma coluna nova; `camposCopiados` é estado de UI). Se o plano optar por um helper de leitura em RPC, seria **read-only** (sem escrita).

## 9. Casos de borda
- Origem com nº de blocos de tecido diferente do destino → casa por tipo+numero; cria o que falta; ignora item sem correspondência na origem.
- Grade + Variantes sempre juntas (dependência) → `variante_numero` alinhado.
- Origem sem o item marcado (ex.: sem Forro) → ignora aquele bloco.
- Copiar Consumo/Variantes sem Artigo, com destino sem bloco daquele tipo/número → cria bloco com artigo vazio? **Decisão:** exigir Artigo marcado se o destino não tiver o bloco (validar no `Copiar`; senão o bloco fica inválido). Detalhar no plano.
- "Selecionar tudo" com origem que não tem certas áreas → marca só o que a origem tem.

## 10. Fora de escopo (YAGNI)
- Copiar identidade (nome/ref/equipe/datas), Ajustes na Prova, Anexos/arquivos, CAD.
- Copiar OC-links / alocação de OC.
- "Duplicar modelo" / criar nova versão a partir da cópia (pode reusar esta engine no futuro, mas não agora).
- Importar de modelo de **outra loja**.
- Persistir o realce amarelo entre sessões.

## 11. Testes
- **Unit (front):** builder do `payloadCopiado` a partir de (origem, seleção): respeita sem-OC-links, casamento tipo+numero, Grade-só-com-Variantes, "Selecionar tudo".
- **Unit (front):** diff de sobrescrita (quando abrir o AlertDialog).
- **Integração (RPC existente):** um teste de que aplicar o payload copiado via `salvar_modelo_bom` mantém invariantes (tenant, sem oc-links órfãos) — reusa `tests/integration` (txn revertida).
- **Manual/E2E leve:** copiar → amarelo → editar tira amarelo → Salvar comita; sobrescrita pede confirmação; botão some em modelo `enviado_cad`.

## 12. Invariantes a preservar
- Reuso do `salvar_modelo_bom` (atômico, valida tenant) — **não** criar caminho de escrita paralelo.
- Nada é gravado antes do Salvar (staging).
- `modelo_tecido_oc_links` nunca copiado (não mexer em reserva/estoque de tecido — ver invariante #4 do estoque).
- Grade real/planejada e o fluxo de Enviar/CAD **não** são tocados por esta feature (ela só edita `modelo_*` antes do Enviar).
