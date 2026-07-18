# Task 4b Report — Explosão: tela enxuta read-only

## O que `baixar_estoque_tecido_corte` consome

A RPC `baixar_estoque_tecido_corte(_cad_id uuid)` lê **diretamente do banco** (não usa parâmetros do cliente para os valores):

```sql
FOR r IN
  SELECT ct.tipo, ct.numero, ctv.variante_tecido_id, ctv.ordem, ctv.metragem_enviada
  FROM public.cad_tecidos ct
  JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
  WHERE ct.cad_id = _cad_id
    AND COALESCE(ctv.metragem_enviada, 0) > 0
    AND ctv.variante_tecido_id IS NOT NULL
```

Campo consumido: **`cad_tecido_variantes.metragem_enviada`** (metros a dar baixa por variante).
Isso significa que para que a baixa reflita o que o usuário digitou na tela, é necessário
**salvar primeiro** via `salvar_cad_completo` para persistir o `metragem_enviada` no banco,
e só depois chamar `baixar_estoque_tecido_corte`.

Campo `quantidade_folhas` é exibido mas não é consumido pela RPC de baixa.

## Implementação do modo `readOnly` em `CadTecidosSection`

Arquivo: `src/components/producao/cad/CadTecidosSection.tsx`

- Adicionada prop `readOnly?: boolean` ao tipo `Props`
- Quando `readOnly=true`:
  - `ro = !!autoFolhas || !!readOnly` → bloqueia `quantidade_folhas` e `metragem_planejada` como campos read-only
  - Campos `consumo_cad`, `loss_percent_cad` viram `<Input readOnly className="bg-muted">` (sem onChange)
  - Campo `tamanho_folha` já estava coberto por `ro`
  - Coluna `× grade` (multiplicador) é **ocultada** no header e nas células (`{compl && !readOnly && ...}`)
  - Checkbox "Calcular folhas / metragem automaticamente" é **ocultado** (`!readOnly && onToggleAutoFolhas`)
  - Campo **`metragem_enviada`** permanece editável (`<NumberInput>` com onChange) — ÚNICO campo editável
- Compatibilidade retroativa total: chamadas sem `readOnly` continuam funcionando igual

## Estrutura do `ExplosaoDetail`

Arquivo: `src/components/producao/explosao/ExplosaoDetail.tsx`

Props:
- `modeloId: string` — ID do modelo
- `onEnviado: () => void` — callback chamado após envio bem-sucedido

Queries carregadas:
- `explosao-modelo` — dados do modelo (nome, ref, versao, estilista, categoria, etc.)
- `explosao-cad-row` — linha da tabela `cad` (para pegar o `id`)
- `explosao-cad-tecidos` — tecidos do CAD com variantes
- `explosao-cad-grades` — grades do CAD (para a Ficha de Corte)
- `explosao-tenant-config-grade` — ordem dos tamanhos da grade
- `explosao-oc-links` — vínculos de OC (para a Ficha de Corte mostrar "OC 123")

Estado local:
- `tecidos: TecidoRow[]` — seeded das queries, só `metragem_enviada` é mutado via `updateVar`
- `grades: GradeRow[]` — seeded das queries, read-only (para a Ficha de Corte)

Ações:
- **"Ficha de Corte"** → `printWithImages()` (mesmo mecanismo do CadEditor)
- **"Enviar ao Corte"** → `salvar_cad_completo` (persiste metragem_enviada) → `baixar_estoque_tecido_corte`
  - Trata `deficit[]` com toast.warning em PT-BR
  - AlertDialog de confirmação se há variantes com metragem_planejada > 0 mas metragem_enviada = 0
  - Invalida `producao-explosao-list`, `producao-cad-list`, `cad-row`, `estoque-tecidos`, `dash-estoque`, `consumo-por-oc`
  - Chama `onEnviado()` após sucesso (fecha o Sheet e refresca a lista)

Renderização:
- Header com título + botões "Ficha de Corte" e "Enviar ao Corte"
- Card com foto e metadados do modelo (somente leitura)
- `<CadTecidosSection readOnly={true}>` — sem grade, só Metr. a Separar/Enviar editável
- `<CadFichaCorte>` com `aviamentos={[]}` (sem explosão de aviamentos nesta tela)

## Mudanças em `producao.explosao.index.tsx`

- **Removido**: `import { CadEditor }` de `producao.cad.$modeloId`
- **Adicionado**: `import { ExplosaoDetail }` de `@/components/producao/explosao/ExplosaoDetail`
- Sheet agora renderiza `<ExplosaoDetail modeloId={sheetId} onEnviado={closeSheet} />`
- Copy corrigido: "Os modelos enviados ao CAD" → "Os modelos enviados do Desenvolvimento"
- `CadEditor` em `producao.cad.$modeloId.tsx` permanece intacto (export não foi alterado)

## Resultados tsc + build

```
npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2551|TS2339|TS2322|TS6133"
(sem saída — zero erros)

npm run build 2>&1 | tail -5
✓ built in 5.18s
```
