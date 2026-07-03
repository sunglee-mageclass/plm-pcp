# Laudo-piloto UX/UI — sisTrama (OTB · Planejamento · CQ, desktop+mobile)

Síntese das 3 lentes (ergonomia cognitiva · UX/Nielsen · UI/visual+mobile+WCAG) sobre screenshots renderizados.
Fonte: `/tmp/ux-audit/lente-{cognitiva,ux,ui}.md`. Prioridade = severidade × convergência entre lentes × esforço.

## Validação do método (o piloto funcionou)
- As 3 lentes **convergiram** nos itens fortes (OTB header, badge de estado) → alta confiança, não achismo.
- Pegou um **bloqueador real no mobile** e uma **falha de contraste WCAG que afeta o app todo** — coisas que build/tsc não pegam.
- Verificação cruzada correta: as lentes confirmaram que Planejamento/CQ **já são responsivos** (o overflow é bug isolado do OTB) e separaram **"tela vazia de teste"** de defeito real.

## Achados priorizados

### 🔴 Quick wins (barato + alto impacto) — faria já
| # | Tela | Achado | Severidade | Lentes | Fix | Ref |
|---|---|---|---|---|---|---|
| Q1 | OTB | Header não empilha no mobile → "Nova coleção" (ação primária) **fora da tela** | bloqueia (mobile) | 3/3 | `flex-col sm:flex-row` + botões `w-full sm:w-auto` (padrão do Planejamento) | `otb.index.tsx:138` |
| Q2 | App todo | `StatusBadge` tone **success ≈ 2.89:1 reprova WCAG AA** (e provavelmente danger/info) | atrapalha (ambos) | UI | escurecer o texto como já é no tone `warning` — 1 fix central | `StatusBadge.tsx:7-13` |
| Q3 | OTB | "x/0 modelos" (7/0, 14/0) lê como erro/estouro | atrapalha (ambos) | cog+UX | se `planejado==0` → "N modelos" (sem "/0") | `otb.index.tsx:177-179` |
| Q4 | OTB | Status "Confirmada/Rascunho" é texto cinza, mas "Dentro/Fora" é badge → inconsistência de estado | cosmético | 3/3 | usar `StatusBadge` p/ Confirmada/Rascunho | `otb.index.tsx:165-166` |
| Q5 | Planejamento | 12 filtros num popover chapado (Lei de Hick) | atrapalha (ambos) | cog | subtítulos "Período / Taxonomia / Atributos" no array | `criacao.planejamento.tsx:502-517` |

### 🟠 Estrutural / médio esforço
| # | Tela | Achado | Severidade | Lentes | Fix |
|---|---|---|---|---|---|
| E1 | CQ | Versões do mesmo modelo aparecem como **linhas idênticas** (mesma REF/nome/status); só o badge `v4` distingue → risco de confirmar CQ da **versão errada** (maior potencial de ERRO do piloto) | atrapalha (ambos) | cog+UX+UI | versão vira coluna/ sufixo no REF ("BL0001 v4") + esmaecer versões antigas |
| E2 | Planejamento | No mobile os cards viram **só imagem** (perde nome/status/preço) → triagem no chão de fábrica exige abrir cada card | atrapalha (mobile) | UI | manter nome + StatusBadge mesmo em compact (overlay no rodapé da foto) |
| E3 | OTB | "Custo utilizado" sem par de orçamento em 6/7 cards + badge só em 1 → **saúde do orçamento invisível** (a razão de ser do OTB) | atrapalha (ambos) | cog | badge "Sem orçamento"; quando há orçamento, saldo/% + barra fina |
| E4 | Planejamento | Toolbar mobile com alvos **h-8 (32px) < 44px** (Fitts/WCAG) | atrapalha (mobile) | UI | subir controles p/ h-10/h-11 no mobile |
| E5 | Ambos | Sinais de estado por **cor/ícone só no hover** (bolinha de serviço no Planejamento; badge revisão no CQ) falham no mobile | atrapalha/cosm | cog+UX | legenda/aria-label; rótulo no compact |
| E6 | CQ | Coluna Status colapsa Pré/Pós num rótulo só → pra saber o que falta abre o Sheet | atrapalha (ambos) | cog+UX | mini-indicadores "Pré ✓ / Pós ✓" na lista |

### 🟡 Observações / calibração
- **Planejamento "cards Sem nome / — clones"** (cog P-2): ruído real, MAS **em parte é artefato do dado de teste** (a loja tem muitos modelos em branco vindos do "confirmar OTB"). Fix útil de qualquer forma: **omitir linhas vazias** em vez de renderizar "—/Sem linha".
- **"Custo utilizado"** pode ser lido como "dinheiro já gasto" (é previsto→real). Rótulo alternativo: "Custo comprometido/estimado". (Você já perguntou sobre isso — decisão de rótulo.)
- **Passou** (não é achado): headers de Planejamento/CQ responsivos; estados-vazios com orientação; maioria dos contrastes (muted 6:1, "Dentro" 4.84:1, texto 18:1); Sheet de CQ com largura/scroll corretos.

## Próximo
- Piloto = 3 telas. Varredura completa = ~30 telas × 2 viewports × 3 lentes → **workflow** (pipeline por tela: captura → 3 lentes → síntese).
- Complemento de dado real (fora do agente): axe/WCAG automático em todas as telas + teste com 3–5 usuários da loja.
