# Laudo completo UX/UI — sisTrama (PLM+PCP de moda, B2B denso)

Síntese das 3 lentes (ergonomia cognitiva · UX/Nielsen · UI/visual+mobile+WCAG) sobre ~30 telas (desktop 1440×900 + mobile 390×844), incorporando o **laudo-piloto** (OTB · Planejamento · CQ).
Fonte: `/tmp/ux-audit/sweep/{cog,ux,ui}-*.md` + `/tmp/ux-audit/laudo-piloto.md`. Prioridade = **severidade × convergência entre lentes × esforço**.
Data: 2026-07-03.

---

## (a) Resumo executivo

A varredura de 27 arquivos (3 lentes × 8 módulos + piloto de 3 telas) rendeu ~180 achados brutos, que após dedup convergem em **~90 achados únicos**: **8 bloqueadores**, ~55 "atrapalha", ~27 cosméticos. O laudo é dominado por **três padrões cross-módulo de altíssima convergência** que valem uma correção central cada: (1) o **`StatusBadge` tone success/warning/danger e badges hardcoded `bg-*-500`** reprovam WCAG AA de contraste em praticamente todo o app (flagrado ~2,89:1 no piloto, reconfirmado por UI em admin, produção, dashboard, entrada-saída, criação); (2) **alvos de toque < 44px** (h-8/h-7 em selects, botões `size="sm"`, Switch, grip de drag, "Zerar", "Ver mais", chips) espalhados por todos os módulos, crítico no chão de fábrica; (3) **ações/funções escondidas ou não-acionáveis no mobile** (botão Imprimir, coluna Ficha, botão X do Sheet, cards que só linkam para rota genérica). Além disso há dois **bloqueadores estruturais isolados** — o `TabsList` do Estoque renderizado dentro do `TabsContent` (Radix inválido) e a **tela Acabamento aposentada mas ainda navegável** — e um bloqueador de **fluxo mobile do Kanban** (não há como mover card de status no mobile). A boa notícia (verificação cruzada): a maioria dos estados vazios é **artefato do banco de teste zerado**, os headers de Planejamento/CQ já são responsivos, e o padrão MobileActionBar/DateField é consistente onde aplicado.

---

## (a) TOP 15 priorizado

| # | Módulo/Tela | Achado | Sev. | Lentes | Fix | arquivo:linha |
|---|---|---|---|---|---|---|
| 1 | **App todo** | `StatusBadge` tone success (~2,89:1) + warning/danger + badges hardcoded `bg-emerald/amber/orange-500` com texto branco reprovam WCAG AA de contraste | atrapalha (ambos) | cog+UI (piloto+5 mód.) | escurecer tokens `--color-success/warning` p/ ~oklch(0.45); trocar `bg-*-500`→`*-600`; padronizar tudo em `StatusBadge` | `StatusBadge.tsx:7-13`; `auditoria.tsx:27`; `CqTecido.tsx:43-48`; `lojas.tsx:202` |
| 2 | **Produção /acabamento** | Tela **aposentada** (virou serviço pós-costura) mas ainda navegável → estado vazio permanente parece bug/perda de dados | bloqueia (ambos) | cog+ux+ui (3/3) | remover do menu OU redirect p/ `/producao/terceirizados` OU banner "migrado p/ Serviços > Pós" | `producao.acabamento.index.tsx`; `app-sidebar.tsx:94` |
| 3 | **Entrada-Saída /estoque** | `TabsList` renderizado **dentro** de `TabsContent` → Radix inválido, ARIA `tablist` dentro de `tabpanel`, frágil entre versões | bloqueia (ambos) | cog+ux+ui (3/3) | mover `TabsList` p/ dentro de `<Tabs>` no `EstoquePage`, antes dos `TabsContent` | `entrada-saida.estoque.tsx:40-44,294-297,742-745` |
| 4 | **App todo (mobile)** | **Alvos de toque < 44px** generalizados: Select `h-8`, botões `size="sm"` (h-8), Switch (20px), grip drag (16px), "Zerar"/câmera (h-7/28px), "Ver mais" (~20px) | atrapalha/bloqueia (mobile) | cog+ux+ui (3/3) | criar util touch-target; subir controles p/ h-10/h-11 no mobile; wrap Switch/grip c/ `min-h-[44px]` | `usuarios.tsx:200-228`; `estoque.tsx:317`; `switch.tsx:12`; `consumo-oc.tsx:519`; `dashboard.tsx:675` |
| 5 | **OTB** | Header não empilha no mobile → "Nova coleção" (ação primária) **fora da tela**; "x/0 modelos" lê como erro | bloqueia (mobile) | 3/3 (piloto) | `flex-col sm:flex-row` + botões `w-full sm:w-auto`; se `planejado==0`→"N modelos" | `otb.index.tsx:138,177-179` |
| 6 | **Entrada-Saída OC Tec+Aviam** | "Marcar Recebido" fica **ativo** mesmo bloqueado (só `disabled` no isPending) → erro só via toast após clique | atrapalha (ambos) | cog+ux (2/2, 2 telas) | `disabled={!canMarkReceived \|\| isPending}` + `title={requisitos faltantes}` | `oc-tecido.tsx:1060`; `oc-aviamento.tsx:964` |
| 7 | **Produção mobile (transversal)** | Sheets de detalhe (CAD, Serviços, Direcionamento) suprimem botão X (`max-md:[&>button]:hidden`) sem alternativa de fechar; + botão Imprimir/Ficha `hidden md:*` sem fallback | atrapalha/bloqueia (mobile) | cog+ux+ui (3/3) | `MobileSheetHeader` c/ "Fechar"; mover Imprimir/Ficha p/ dentro do Sheet | `producao.cad.index.tsx:187,203`; `terceirizados.index.tsx:195,215` |
| 8 | **Criação /desenvolvimento** | Kanban mobile **não permite mover card entre status** (só 1ª seção expande; sem drag; mudança só no painel se existir) | bloqueia/atrapalha (mobile) | ux (+cog) | expor Select de status no card/painel mobile; expandir seções com cards | `criacao.desenvolvimento.tsx:411,430-484` |
| 9 | **CQ** | Versões do mesmo modelo aparecem como **linhas idênticas** (só badge v4 distingue) → risco de confirmar CQ da versão errada | atrapalha (ambos) | cog+ux+ui (piloto) | versão vira sufixo no REF ("BL0001 v4") + esmaecer versões antigas | (piloto CQ) |
| 10 | **Entrada-Saída (OC×2)** | Coluna **"Mensagem"** exibe badge de prazo → rótulo não descreve o dado | atrapalha (ambos) | cog+ux+ui (3/3, 2 telas) | renomear `TableHead` p/ "Prazo" | `OcTecidoList.tsx:133,221`; `oc-aviamento.tsx:280,363` |
| 11 | **App (filtros)** | `FilterButton`/`AgrupamentoButton` sem indicar filtros ativos ao fechar popover (Produção 7 telas, Auditoria, Desenvolvimento) | atrapalha (ambos) | cog+ux (2/2, transversal) | badge "Filtros · 2" no botão + chips removíveis abaixo | `filters.tsx` (FilterButton); `auditoria.tsx:96-99` |
| 12 | **Financeiro** | "Desmarcar pago" e "Recalcular" (`window.confirm` nativo) mutam banco **sem AlertDialog**; edição de vencimento/pagamento inline salva silenciosamente | atrapalha (ambos) | cog+ux (2/2) | `AlertDialog` antes de `desmarcarMut`; trocar `confirm()`; sinalizar campo editável | `financeiro.tsx:604-607,849-851,834-838` |
| 13 | **Admin /configuracoes** | Save global no topo (some no scroll desktop) + **sem indicador "alterações não salvas"** → perda silenciosa; aviso do AlertDialog cita campos que não salva | atrapalha (ambos) | cog+ux (2/2) | sticky save bar; badge `isDirty`; corrigir texto do AlertDialog | `configuracoes.tsx:116-216,413-417` |
| 14 | **Dashboard + Financeiro** | Botão **"Imprimir" `hidden md:inline-flex`** some no mobile sem substituto (Produção/Financeiro/Custos + Lista/Serviços) | atrapalha (mobile) | cog+ux (2/2, transversal) | ícone-only no mobile OU nota "impressão só no desktop" | `dashboard.tsx:583,876,1035`; `financeiro.tsx:752` |
| 15 | **Home** | 4 cards de atenção linkam p/ rota **genérica** (2 idênticos `/financeiro`) sem filtro; `0` de loading idêntico a `0` real (sem skeleton) | atrapalha (ambos) | cog+ux+ui (3/3) | `search:{aba:"atrasadas"}`; skeleton enquanto `isPending` | `HomeLogado.tsx:136-144,211` |

---

## (b) Achados por módulo

### Início (/home) — 0 bloq · convergência alta
- **Cards de atenção: `0` de loading = `0` real** (sem skeleton) — cog+ux+ui (3/3). Fix: `isPending ? "—"/<Skeleton/> : valor`. `HomeLogado.tsx:211`.
- **4 cards linkam p/ rota genérica**, 2 idênticos `/financeiro` sem filtro — cog+ux (3/3). `HomeLogado.tsx:136-144`.
- **`aspect-square` desperdiça altura no mobile** + labels longos ("A pagar (próx. 7 dias)", "OCs de tecido atrasadas") quebram em 2-3 linhas quebrando o ritmo da grade — cog+ux+ui (3/3). Fix: `min-h-[120px]` + encurtar labels. `HomeLogado.tsx:196,141`.
- Cores red/amber alternadas sem hierarquia (reordenar red→amber) — cog. Títulos de seção `text-muted-foreground` contraste borderline — ux+ui. Emoji 👋 sem `aria-hidden` — ui. Nome via prefixo do e-mail ("Bom dia, Teste") — cog+ux.

### Dashboard — 1 bloq
- **"Imprimir" `hidden md:*`** (Produção/Financeiro/Custos) — cog+ux (bloqueia/atrapalha). `dashboard.tsx:583,876,1035`.
- **Gráficos (Funil/Pie) vazios sem empty-state** — retângulo branco 320px indistinguível de erro/loading — cog+ux (3/3). `dashboard.tsx:218-243`.
- **Loading "Carregando…" no fim da página, fora do contexto** — ux+ui. `dashboard.tsx:246`.
- Abas viram `<Select>` no mobile escondendo irmãs + sem "N de 5" — cog+ux. 5 KPIs iguais sem cor semântica / sem separar Total dos demais — cog+ux+ui. Timeline com bolinhas sem legenda — cog+ux. `Real (un.)` só com `title` (invisível no touch) — ux. Grid 5 KPIs sem breakpoint intermediário no mobile — ui. `DashTabsList` duplica filtro de permissão (risco drift) — ux.

### Criação /desenvolvimento — 2 bloq
- **Kanban mobile sem mover card entre status** — ux (bloqueia). `criacao.desenvolvimento.tsx:411,430-484`.
- **Nome da coluna só em texto vertical rotacionado** (sem header horizontal) — ux (bloqueia). `:387-389`.
- Busca só por `nome` (não `ref`, que aparece no card) — ux. 13 filtros sem agrupamento (Hick) — cog. Sort Select não expõe/alterna direção — ux. Overflow horizontal de colunas sem indicador — ux. `MobileCard` `role="button"`/onClick na div interna, sem `tabindex` — ui (bloqueia a11y). `iframe title=""` inválido — ui. StatusBadge success contraste — ui. Cards "—" sem label — cog.

### Cadastro (atributos/colaboradores/servico/tecidos/aviamentos) — 2 bloq
- **Colaboradores: editar/excluir tipo custom ausente no mobile** (só na sidebar desktop) — cog (bloqueia). `colaboradores.tsx:333-350`.
- **Aviamentos: modal mobile "Excluir" (destrutivo) adjacente a "Salvar"** sem espaçamento; botão Voltar 32px — cog+ui (bloqueia). `aviamentos.tsx:800-819,805`.
- **Alerta vermelho `bg-destructive` p/ "sem categoria/fornecedor"** = alarm fatigue (dado incompleto ≠ erro crítico) — cog+ux (Tecidos+Aviamentos). Fix: âmbar/outline.
- Ícones editar/excluir só no hover (`opacity-0`) invisíveis em touch — cog+ux+ui. Botão lookup CNPJ = ícone Download sem label/aria — cog+ux+ui (3/3). Seletor de colunas `hidden lg:flex` (some no mobile/tablet) + visível na tela vazia — ux+ui. Estado vazio sem CTA "Cadastrar primeiro" — ux. `py-1.5` (~28px) nos itens de nav da sidebar — cog+ui. "0 registro(s)"/concordância PT-BR — ux. "Grade de Tamanhos" na lista PRODUTO sem distinção — cog+ux. Rótulos "Categoria/Subcategoria" ambíguos sem domínio — cog. AV2: 13 campos sem seções colapsáveis (Miller) — cog.

### Entrada e Saída (OC Tecido/Aviamento/Estoque/Alertas) — 1 bloq
- **Estoque `TabsList` dentro de `TabsContent`** (#3) — cog+ux+ui (3/3, bloqueia).
- **"Marcar Recebido" ativo quando bloqueado** (#6) — cog+ux (2 telas).
- **Coluna "Mensagem" = badge de prazo** (#10) — cog+ux+ui (3/3, 2 telas).
- Abas Pendentes/Resolvidos e OC sem contagem — cog+ux. Ordenar por `h-8`/`—` sem default explícito — cog+ux+ui. Unidade de medida ausente em aviamentos mobile — cog. `text-[9px]` nas células de detalhe de rolo — ui. Emoji 📍/▾▸ em vez de Lucide — ui. Estoque sem MobileActionBar/Imprimir no tablet — ui. Badge CQ `bg-amber/emerald/orange-500` contraste — ui.

### Financeiro — 0 bloq (1 bloq mobile na tabela Serviços)
- **"Desmarcar"/"Recalcular" sem confirmação** (`window.confirm` nativo quebra tema) (#12) — cog+ux (2/2).
- **Edição inline de vencimento/pagamento salva silencioso** + digitar data marca como pago sem aviso — cog+ux (2/2).
- **Serviço no calendário só dispara `toast.info`** (clicável, não acionável) — cog+ux (2/2). Fix: navegar p/ aba Serviços.
- **Tabela Serviços 13 colunas** (mobile impraticável c/ DateField + botões h-8) — cog+ux+ui (bloqueia mobile). Legenda de cor no rodapé (fora da vista) — cog+ux. Ponto de status 10px sem 2º canal (daltonismo) — cog. "Julho De 2026" (De maiúsculo) — ux+ui. `input type="month"` foge do DateField — ux. SummaryCards clicáveis sem affordance — cog+ux. Gráficos sem empty-state — ux. Total "a pagar" inclui pagas — ux.

### Produção (CAD/Direcionamento/Serviços/Oficina/Consumo-OC/Lançamentos/Acabamento) — 2 bloq
- **Acabamento aposentado ainda navegável** (#2) — cog+ux+ui (3/3, bloqueia).
- **Sheets mobile sem botão Fechar + Imprimir/Ficha `hidden md:*`** (#7) — cog+ux+ui (transversal).
- **Oficina e Acabamento sem coluna Status** (abrir cada item p/ saber a etapa) — cog+ux+ui. **Oficina/Acabamento navegam via `<Link>`** enquanto CAD/Serviços usam Sheet (inconsistência) — cog+ux. Indicador de aprovação = dot 2,5px só com `title` (invisível touch, daltonismo) — cog+ux+ui. Consumo-OC: toolbar 2 linhas sem separar Tecido/Forro dos controles — cog+ux+ui; "Zerar" h-7 (28px) — cog+ux+ui; card MiniCard/Popover clique ambíguo; empty-state sem card/ícone; emoji 📍. Lançamentos: KPIs misturados com controles de visualização — cog+ux+ui; seletor de colunas `hidden lg:flex`; card inteiro = DialogTrigger (abre fotos ao clicar); badge só "Lançado" (sem estado "pendente"); `aspect-square` distorce peças portrait. CAD: coluna "Ficha" ambígua; sem coluna Coleção.

### Admin (lojas/usuarios/usuarios-loja/configuracoes/auditoria) — 1 bloq
- **usuarios: botões ação `size="sm"` (h-8) × 5-6 por linha no mobile** — ui (bloqueia, touch). `usuarios.tsx:200-228`.
- **configuracoes: save no topo some no scroll + sem "não salvo" + AlertDialog cita campos não salvos** (#13) — cog+ux (2/2).
- **usuarios-loja: modal "Novo Usuário" sem full-screen mobile** + sem MobileActionBar (título quebra 3 linhas) + sem busca/filtro — cog+ux+ui (3/3). `usuarios-loja.tsx:216,101-106`.
- **auditoria: paginação "Página 1" sem total** + filtros ativos invisíveis ao fechar + sem agrupamento por data + `Input` sem debounce (query por tecla) — cog+ux (3/3). Badge "Editou" amber+branco ~2,0:1 (falha real) — ui.
- "Role" em inglês (header+form) — cog+ux (2 telas). Toggle adjacente à lixeira sem separador (lojas mobile) — cog+ui. Ícone LogOut idêntico ao "Sair" — cog. RotateCcw ambíguo (reset dados vs senha) — cog+ux. Badges "Ativa" hardcoded `bg-emerald-500` (3 telas divergem) — ui. Dialog vs AlertDialog p/ exclusão (inconsistente) — ux.

### Piloto — OTB · Planejamento · CQ (incorporado)
- **OTB**: header não empilha (#5); "Custo utilizado" sem par de orçamento em 6/7 cards (saúde do orçamento invisível — a razão de ser do OTB); "Confirmada/Rascunho" texto cinza vs badge "Dentro/Fora" (inconsistência de estado).
- **Planejamento**: 12 filtros num popover chapado (Hick); cards mobile viram só imagem (perde nome/status/preço — triagem exige abrir cada); toolbar mobile h-8 < 44px; sinal de serviço só no hover.
- **CQ**: versões como linhas idênticas (#9); coluna Status colapsa Pré/Pós num rótulo só (abrir Sheet p/ saber o que falta); badge revisão só no hover.

---

## (c) Padrões cross-módulo (corrigir uma vez, ganhar em tudo)

1. **Contraste WCAG AA de badges** — `StatusBadge` success (~2,89:1)/warning/danger + hardcoded `bg-emerald/amber/orange/yellow-500` com texto branco (~2,0-3,1:1). Reconfirmado por UI em Admin, Produção, Dashboard, Entrada-Saída, Criação e piloto. **1 fix central de token + varredura de `bg-*-500`.**
2. **Alvos de toque < 44px** — `SelectTrigger h-8`, `Button size="sm"` (h-8), Switch (20px), grip @dnd-kit (16px), "Zerar"/câmera (h-7/28px), "Ver mais" (~20px), toggle Todos/OC/Serviço (h-7), chips de calendário (~20px). Presente em **todos os módulos**. Fix: utilitário `min-h-[44px]`/`max-md:h-11`.
3. **Função escondida ou não-acionável no mobile** — "Imprimir" `hidden md:*` (Dashboard×3, Financeiro, Estoque); coluna "Ficha"/impressão (CAD, Serviços); botão X do Sheet suprimido (CAD, Serviços, Direcionamento); cards que só linkam p/ rota genérica (Home).
4. **Estado só no hover / `title` (falha no touch e em daltonismo)** — dots de status/aprovação (Produção, Financeiro, piloto), ícones editar/excluir (Cadastro), badge revisão (CQ), "Real (un.)" (Dashboard), tooltip de requisitos do Kanban. Fix: 2º canal (texto/badge) + `aria-label`.
5. **Filtros/agrupamentos sem indicar estado ativo** — `FilterButton`/`AgrupamentoButton` em Produção (7 telas), Auditoria, Desenvolvimento, Planejamento (Hick nos popovers de 12-13 filtros sem subtítulos). Fix: badge de contagem + chips removíveis + subcabeçalhos.
6. **Rótulo ≠ dado / jargão** — "Mensagem"=prazo (OC×2), "Role"=perfil (Admin×2), "Ficha", "Custo utilizado", "TIPO FIXO", "Lançados (CQ ok)", "Aviam.".
7. **Emoji como ícone funcional** (📍 🔧 ▾▸) sem `aria-hidden`, inconsistente entre SOs — Consumo-OC, Estoque, Financeiro. Fix: Lucide.
8. **Ausência de skeleton/empty-state explícito** — `0`/gráfico branco de loading indistinguível de dado real/erro — Home, Dashboard, Financeiro, Consumo-OC.
9. **`text-muted-foreground` (oklch 0.5) em texto pequeno** — contraste borderline (~4,0-4,4:1) recorrente em subtítulos/labels/empty-states. Verificar token com ferramenta; considerar oklch(0.45).
10. **Tipografia < 12px** — `text-[9px]`/`text-[10px]`/`text-[11px]` em badges e células (Estoque, Cadastro, KPIs). Mínimo prático 12px.

---

## (d) Quick wins vs estrutural

### Quick wins (barato + alto impacto — faria já)
- **[amb]** Escurecer tokens `--color-success/warning` + trocar `bg-*-500`→`600` (padrão #1, 1 commit). 
- **[mob]** Utilitário de touch-target + trocar `h-8`→`h-10/11`/`size="sm"`→`icon`/`default` nos selects e botões de ação (padrão #2).
- **[mob]** OTB: `flex-col sm:flex-row` no header + `w-full sm:w-auto` (bloqueador saindo da tela). "x/0"→"N modelos".
- **[amb]** OC×2: `disabled={!canMarkReceived||isPending}` + `title` (1 linha × 2).
- **[amb]** Renomear "Mensagem"→"Prazo"; "Role"→"Perfil"; corrigir "Julho De".
- **[amb]** Badge de contagem no FilterButton/AgrupamentoButton (padrão #5, componente compartilhado).
- **[amb]** Financeiro: AlertDialog no "Desmarcar" + trocar `window.confirm`.
- **[amb]** Empty-state nos gráficos (Dashboard/Financeiro) + skeleton nos cards da Home.
- **[amb]** Trocar emojis por Lucide + `aria-hidden`; subir `text-[9/10/11px]`→`text-xs`.
- **[amb]** Cadastro: `bg-destructive`→âmbar nos alertas de dado incompleto; CTA no empty-state; ícones editar/excluir `opacity-40` em vez de 0; `aria-label` no lookup CNPJ.
- **[mob]** Home: encurtar labels + `min-h` em vez de `aspect-square`.

### Estrutural / médio esforço
- **Produção: aposentar Acabamento** de fato (rota + menu + redirect/banner) — decisão de produto (#2).
- **Estoque: refatorar `Tabs`** (mover TabsList p/ o pai) — Radix correto (#3).
- **Kanban mobile: expor mudança de status** no card/painel + expandir seções com cards (#8).
- **Produção: `MobileSheetHeader` unificado** com "Fechar" + padronizar Sheet vs Link em Oficina/Acabamento (#7).
- **CQ: desambiguar versões** (sufixo REF + esmaecer antigas) (#9).
- **Financeiro/Serviços: tabela de 13 colunas** → colapsar monetárias + "tap-to-edit" no mobile.
- **OTB: par orçamento/custo + barra de saldo** (a razão de ser do módulo) — E3 piloto.
- **Planejamento: manter nome+StatusBadge no card compacto mobile** (não virar só imagem).
- **Admin/configuracoes: sticky save bar + estado `isDirty`** ("não salvo").
- **Home: passar `search`/filtro** dos cards de atenção p/ a rota destino (requer suporte no Financeiro).
- **Cadastro: seções colapsáveis no modal de Aviamento** (13 campos).

---

## (e) Observações / artefatos de dado de teste (NÃO são defeitos)

- **Estados vazios/`0` em quase todas as telas** = banco de teste zerado + "Selecione a loja…" (super_admin sem tenant). Confirmado por todas as 3 lentes em Home, Dashboard, Criação, Cadastro, Entrada-Saída, Financeiro, Produção. O empty-state em si está bem implementado (ícone+título+descrição) na maioria — a exceção real é a **ausência de distinção loading vs vazio vs erro** (isso É defeito, listado acima).
- **Placeholders de logo cinza** em lojas sem logo (Admin) = dado ausente, não bug (embora "mostrar initials" seja melhoria opcional).
- **"Custo utilizado" pode ser lido como "gasto"** (é previsto→real) — decisão de rótulo, não defeito. Sugerido "Custo comprometido/estimado".
- **Padrão MobileActionBar / sidebar-desktop-vs-select-mobile / DateField** = boas práticas consistentes onde aplicadas; a fricção residual é falta de CTA no empty-state e a exceção usuarios-loja (que não usa MobileActionBar — isso É achado).
- **SearchToggle colapsado** (lupa sem label) = padrão universal aceitável; registrado como cosmético de descoberta, não bug.
- **`FunnelChart isAnimationActive` default** só afeta print, não a tela — baixo risco.
- **Vários "contraste suspeito, verificar com ferramenta"** (muted-foreground, amber-600 em ícones ≥3:1) precisam de **medição instrumental (axe/DevTools)** para confirmar antes de mexer — a única falha de contraste *confirmada por cálculo* é o badge "Editou" amber+branco (~2,0:1) e o success ~2,89:1 do piloto.

---

**Próximo (fora do agente):** axe/WCAG automático em todas as telas (confirmar os "suspeitos") + teste com 3-5 usuários reais da loja com dados de produção (as telas foram auditadas vazias).
