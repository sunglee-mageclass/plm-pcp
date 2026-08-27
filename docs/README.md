# docs/ — mapa da pasta

Índice do que é cada coisa aqui. **Nada nesta pasta é lixo** — cada categoria tem
ponteiros de código (migrations comentam planos), da cartilha ou da memória. Antes
de mover/apagar qualquer doc, `grep` o nome do arquivo em `src/`, `supabase/migrations/`,
`CLAUDE.md` e na memória — vários são referenciados.

## 🟢 Vivos — use e mantenha atualizados (papel do agente `docs-keeper`)

| Arquivo | O que é | Git |
|---|---|---|
| **`design/ui-padroes.md`** | **A cartilha §A–§R — SSOT de todos os padrões de UI.** Para cada padrão: token/uso → componente real a reutilizar (`arquivo:linha`) → snippet. É a bíblia da padronização. | versionado |
| **`design/ui-padroes.html`** | **Guia visual ao vivo** da cartilha (abre no navegador, sem servidor). Companheiro do `.md` (que o linka); ainda incompleto p/ §K–§P. Não é duplicata descartável — é a versão visual. | versionado |
| **`mapeamento-campos-calculos.md`** | Campos × campos, fórmulas, etapas do sistema. | gitignored (local) |
| **`plano-de-ataque.md`** | Auditoria das 7 frentes + Fases; rastreia o que foi feito. | gitignored (local) |
| **`api-integracao-erp.md`** | Leitura p/ ERP: o quê + quando o dado é final. | gitignored (local) |

> O `CLAUDE.md` nomeia os 3 gitignored como "docs de referência LOCAIS" + a cartilha.

## 🟡 Referência / histórico — não-vivo, mas apontado por código/memória

| Item | O que é | Referenciado por |
|---|---|---|
| **`superpowers/plans/`** (38 arq.) | Plano de implementação de cada feature grande (OTB, plan-tecido, grade cortada, MO por serviço, revenda, direcionamento multi-lojas, colab…). Registro do "como foi construído". | comentários de **migrations** (`fornecedores_fase*.sql`, etc.) + **memória** (ex.: `project_fornecedores_empresa_servico`). **Mover quebra esses ponteiros.** |
| **`superpowers/specs/`** (37 arq.) | As specs de brainstorm que geraram os planos (upstream dos plans). | idem |
| **`ux-avaliacao/`** (`laudo-completo.md` + `laudo-piloto.md`) | Laudo UX de jul/2026 (as descobertas viraram a cartilha). | memória `reference_skill_ui_ux_pro_max` (o workflow da skill de UI/UX **lê** esses laudos). |
| **`ux-avaliacao-metodologia.md`** | **SSOT da metodologia** de avaliação UX (3 lentes via Playwright MCP, axe/WCAG, severidade × viewport). | memória `project_avaliacao_ux_ui` ("metodologia (SSOT)", RETOMAR no piloto). |
| **`etiquetas-material-completo-design.md`** | Design doc da feature Insumos (ex-etiquetas: material completo, variantes tamanho×cor, explosão/BOM). | comentário da migration `20260719160000_etiquetas_material_fase1.sql` ("Ver docs/…"). |

## ⚠️ Não confundir

- **`docs/superpowers/`** (aqui) = planos/specs versionados de features.
- **`.superpowers/`** (oculto, na RAIZ do repo) = OUTRA coisa — ledgers/briefs de execução do subagent-driven-development (`sdd/<plan>/progress.md`) + trackers de lote. Não é doc; é estado de execução.

## Regra de ouro

Doc antigo ≠ doc morto. Antes de arquivar/remover, provar que ninguém aponta pra
ele (migration, memória, cartilha, código). Nesta pasta, a verificação (ago/2026)
mostrou que **todos** têm ponteiro — por isso nada foi movido, só este índice foi
criado.
