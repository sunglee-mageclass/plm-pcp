# Plano — Editores de Impressão completos (sisTrama)

> Documento de planejamento. **Nada foi executado** — é o roteiro para evoluir do
> "só cabeçalho de um documento" para editores completos por documento, por loja.

## 1. Estado atual

Documentos de impressão (render React + CSS `@media print` / `.print-area`):

- **Ficha Técnica** — `src/components/producao/FichaTecnica.tsx` (+ `useFichaData`). Imprime de Serviços.
- **Ficha de Corte** — `src/components/producao/cad/CadFichaCorte.tsx`. Imprime do CAD (e da lista, via `PrintFicha`).
- **Etiqueta de lavagem** — `src/components/shared/EtiquetaLavagemArtigo.tsx`.
- Blocos embutidos: cabeçalho (`FichaHeader`), Grade, Tecido/Forro/Entretela, Aviamentos, TAG/Etiquetas, Observações, Assinatura.

Editor hoje (`src/routes/_authenticated/admin/editor-impressao.tsx`, ~296 linhas):
- Edita **somente o cabeçalho** do `ficha_corte`.
- Modelo: `print_templates(tenant_id, doc_type, layout jsonb)`; `layout` = `HeaderLayout { cols, blocks }` (ver `src/lib/print-template.ts`).
- ⚠️ Esse cabeçalho custom **não está aplicado** hoje: a Ficha de Corte usa o `FichaHeader` padrão (igual à Técnica) — o override foi removido a pedido. Precisa ser reintegrado como preset.

## 2. Objetivo

Por documento e por loja, sem código: escolher o documento, ver **preview ao vivo**, e
configurar **seções** (não só o cabeçalho): quais aparecem, ordem, título, colunas das
tabelas (quais/rótulo/ordem), e estilo básico (fonte, tamanho, margens, logo, orientação).

## 3. Modelo de dados — `DocLayout` (evolução do `HeaderLayout`)

`print_templates.layout` por `doc_type`:

```ts
DocLayout = {
  version: 2,
  page:   { size: "A4", orientation: "portrait" | "landscape", margin_mm: number },
  style:  { font: string, base_pt: number, accent: string, show_logo: boolean },
  header: HeaderLayout,          // reusa o que já existe
  sections: Section[],          // ORDEM importa
}
Section = {
  key: "foto" | "grade" | "tecido" | "forro" | "entretela" | "aviamentos"
     | "etiquetas" | "observacoes" | "assinatura" | ...,
  visible: boolean,
  title?: string,               // sobrescreve o título padrão
  columns?: { key: string; label?: string; visible: boolean; order: number; width?: string }[],
}
```

`doc_type`: `ficha_tecnica`, `ficha_corte`, `etiqueta_lavagem` (e, depois, `ordem_saida`, `direcionamento`).
Fallback sempre para um `DEFAULT_<doc>` em código → impressão nunca quebra se não houver layout.

## 4. Arquitetura de render

1. **`DocRenderer`** data-driven: `<DocRenderer docType modeloId layout />` — usa `useFichaData`
   e renderiza só as seções `visible`, na ordem do layout, aplicando títulos/colunas custom e
   mantendo `print-section` (quebras de página) e o esqueleto A4 atual.
2. Migrar `FichaTecnica` e `CadFichaCorte` para o `DocRenderer` com o `DEFAULT` (paridade visual 1:1).
   Assim "código" e "editor" convergem num só caminho de render.
3. **`usePrintLayout(docType)`** — lê `print_templates` (por tenant); devolve layout custom ou `DEFAULT_<doc>`.

## 5. Editor (`admin/editor-impressao`)

- **Seletor de documento** (doc_type).
- **Painel esquerdo** — seções: toggle visível + **drag-n-drop** (reordenar) + editar título;
  para tabelas, escolher/renomear/reordenar **colunas**. O editor de cabeçalho atual vira a seção "header".
- **Painel direito** — **preview ao vivo** (o próprio `DocRenderer` com um modelo de exemplo).
- **Estilo & página**: fonte, tamanho base, margens, logo on/off, orientação.
- **Salvar** por doc_type (`upsert` por `tenant_id + doc_type`); invalida o cache do `usePrintLayout`.

## 6. Fases (incrementais, sem quebrar impressão)

1. **Fundação** — `DocLayout` v2 + `DEFAULT_FICHA_TECNICA` / `DEFAULT_FICHA_CORTE` + `usePrintLayout`. Sem mudança visual.
2. **DocRenderer** — render data-driven; Ficha Técnica/Corte passam a usá-lo com o DEFAULT (paridade). Validar impressão (inclusive via `PrintFicha`/iframe).
3. **Editor de seções** — visível + reordenar + título, com preview. Aplicar nos 2 docs.
4. **Colunas por seção** — escolher/renomear/reordenar colunas (Grade, Tecido, Aviamentos, Etiquetas).
5. **Estilo & página** — fonte, tamanho, margens, logo, orientação.
6. **Novos documentos** — etiqueta de lavagem, ordem de saída, direcionamento.
7. **Reintegrar cabeçalho custom** — o `HeaderLayout` (hoje desativado) volta como parte da seção
   "header", com preset **"igual à Ficha Técnica"**.

## 7. Riscos / cuidados

- Impressão depende de `@media print` + `.print-area` + `print-section` (quebras). O `DocRenderer` precisa preservar isso.
- A Ficha de Corte hoje tem esqueleto fixo de **2 colunas / 2 páginas**; o editor de seções deve respeitar (ou tornar configurável numa fase posterior).
- Retrocompat: layout ausente/inválido → `DEFAULT` (nunca quebrar).
- Multi-tenant: `print_templates` por tenant (RLS já existe). Entregar SQL/prompt p/ Lovable a cada migration.
- Imagens (logo, fotos, etiquetas) vêm de signed URLs assíncronas — o preview/impressão deve esperar carregar (já tratado no `PrintFicha`).
