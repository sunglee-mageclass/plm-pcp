# Task D1 — Rota + catálogo + nav (F7 Armário)
- permissions-catalog.ts: PageDef `criacao_armario` (sem gate) no módulo criacao; entra em ALL_PAGE_KEYS via flatMap existente.
- nav.ts: PAGE_URLS/PAGE_ICONS `criacao_armario` (LayoutGrid importado).
- criacao.armario.tsx: rota com validateSearch (colecao/sub/armario), RequirePermission + placeholder.
- routeTree.gen.ts regenerado por `npm run build` (diff só com armario).
- tsc --noEmit: 0 erros. build: ok. 6 testes unit relacionados (catálogo/nav): 75 passam.
