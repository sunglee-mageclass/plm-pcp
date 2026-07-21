### Fix Report — Importar dados: review final (fixes 1–4)

**Status:** DONE

**Commit:** `47060c9` — `fix(importar): recompute custo dos blocos copiados + confirmar obs-bloco + proporções/limpeza (review final)`

**Data:** 2026-07-21

#### FIX 1 (Important) — custo_previsto recomputado após copiar blocos de tecido

`aplicarPatch` em `ModeloDetailPanel.tsx` agora mapeia `patch.blocks` com `recomputeBlock(b, artigoMap, varianteArtigoMap, frozenPrecos)` antes de chamar `setBlocks`. Isso corrige blocos copiados que mantinham o `custo_previsto` obsoleto do destino (geralmente 0).

Linha modificada (`ModeloDetailPanel.tsx:1216`):
```ts
if (patch.blocks !== undefined) setBlocks(patch.blocks.map((b) => recomputeBlock(b, artigoMap, varianteArtigoMap, frozenPrecos as Record<string, number>)));
```

Dois testes unitários adicionados em `tests/unit/importar-copia.test.ts` (describe `"recomputeBlock — invariante do custo copiado"`):
- custo = preco_por_metro * consumo * (1 + loss/100)
- frozenPrecos sobrepõe o preco do artigo (OC vinculada)

#### FIX 2 (Important) — obs-bloco sempre dispara o AlertDialog de confirmacao

Em `onCopiar` (`ModeloDetailPanel.tsx`), logo apos `const itens = overwritesDoPatch(r.patch)`:
```ts
if (sel?.obsBloco) itens.push("Observacoes (bloco)");
```
Agora, quando `obsBloco` esta marcado, o AlertDialog SEMPRE abre (mesmo sem outros sobrescritos), pois a escrita no banco e imediata.

A descricao do AlertDialog foi corrigida de "Nada e gravado ate voce Salvar." para:
"A importacao vai substituir: {itens}. Os campos entram para revisao (so o Salvar grava); as Observacoes (bloco), se marcadas, sao aplicadas na hora."

#### FIX 3 (Minor) — Proporcoes detectadas como sobrescrita

`overwritesDoPatch` ganhou o branch:
```ts
if (patch.proporcoes !== undefined && Object.keys(draft?.proporcoes ?? {}).length > 0) out.push("Proporcoes");
```

#### FIX 4 (Minor) — imports mortos removidos

- `importar-copia.ts`: removido `makeEmptyBlocks` do import (tipo `TecidoBlock` etc. mantidos).
- `ImportarDadosDialog.tsx`: removido `useMemo` do import (nunca usado neste arquivo).
- `useModeloParaCopia.ts`: removido `id` do select de `modelo_tecidos` (campo buscado mas nunca lido).

#### Verificacao

| Gate | Resultado |
|------|-----------|
| `npx vitest run tests/unit/importar-copia.test.ts` | 8/8 PASS |
| `DATABASE_URL=... npx vitest run tests/integration/importar-obs-bloco.test.ts` | 4/4 PASS |
| `npx tsc --noEmit` | exit 0 (sem erros) |
