# Avaliação de UX/UI do sisTrama — metodologia

Diagnóstico **tela por tela**, **desktop + mobile**, por um time de 3 lentes + síntese.
Objetivo: dizer, com base em princípios (não opinião), se o uso é agradável/eficiente e onde melhora.

## Time (lentes)
| Agente | Lente | Ancoragem |
|---|---|---|
| `cognitive-ergonomist` | Ergonomia cognitiva / human factors | Cognitive Load, Miller 7±2, **Fitts**, **Hick**, Gestalt, reconhecimento>evocação |
| `ux-tester` | UX / interação / fluxo | **10 heurísticas de Nielsen**, prevenção/recuperação de erro, eficiência de uso repetido |
| `ui-ux-mobile` | UI visual + responsivo | hierarquia, tipografia, espaçamento (8pt), cor/**contraste WCAG**, alvo de toque ≥44px, affordance |

As 3 são **read-only** e recebem, por tela: **screenshots renderizados (desktop + mobile) + o arquivo da rota**.

## Dimensão objetiva ("dado")
- **WCAG/axe automático** (via Playwright + axe-core): contraste, alvos, foco, labels, roles → números, não achismo.
- (Complemento futuro, fora do agente) **3–5 usuários reais** da loja em teste moderado de tarefa (sucesso, tempo, travas). É o sinal mais alto; nenhum agente substitui.

## Captura (pré-requisito: Playwright MCP + `npm run dev`)
1. Subir dev: `npm run dev`. Login por convite (e-mail/senha; usuário de teste combinado).
2. Para cada tela: navegar, **screenshot desktop (1440×900)** e **mobile (390×844)** + snapshot do DOM.
3. Rodar o passe **axe** em cada viewport → relatório de violações.
4. Salvar em `/tmp/ux-audit/<tela>-{desktop,mobile}.png` (+ axe json).

## Inventário de telas (rotas em `src/routes/_authenticated/`)
- **otb** · **criacao**: planejamento, desenvolvimento · **cadastro**: atributos, colaboradores, serviço, tecidos, aviamentos
- **entrada-saida**: oc-tecido, oc-aviamento, rolos, estoque, alertas-tecido · **producao**: cad, cq, direcionamento, terceirizados, oficina, consumo-oc, lancamentos
- **financeiro**: calendário/lista/parcelas/serviços · **dashboard**: 5 abas · **admin**: lojas, usuarios, configuracoes
- **home** / **auth** (estado deslogado)

## Severidade
`bloqueia` (impede/erra a tarefa) · `atrapalha` (fricção/lentidão/confusão real) · `cosmético` (polimento).
Sempre marcar **desktop / mobile / ambos**.

## Saída (laudo)
1. **Por tela**: matriz Achado × Lente, cada um com princípio/heurística, severidade, viewport, `arquivo:linha`, correção concreta.
2. **Síntese** (papel de `product-lead` ou main loop): dedup entre lentes, **top problemas priorizados** (severidade × frequência × esforço), padrões recorrentes (ex.: alvos pequenos no mobile em N telas).
3. **Quick wins** (barato + alto impacto) separados do **estrutural**.

## Como rodar
- **Piloto (recomendado 1º)**: 3 telas-âncora — **OTB**, **Planejamento**, **CQ (mobile denso)** — pra calibrar o formato antes da varredura.
- **Varredura completa**: só após o formato agradar. É cara (≈30 telas × 2 viewports × 3 lentes) → orquestrar via workflow (opt-in), pipeline por tela: captura → 3 lentes em paralelo → síntese.

## Regras
- Achado só se **REAL e verificável** (no render ou no código). Tela boa = "sem achados". Não inventar dado/estudo.
- Peso do produto: **ferramenta B2B densa, uso EXPERT/repetido** — otimizar eficiência e prevenção de erro, não "encantamento" de novato. Mobile importa muito (uso no chão de fábrica).

## Rito de CORREÇÃO por tela (o time acompanha — UI é PORTÃO, não etapa)

O time de 3 lentes (`cognitive-ergonomist`, `ux-tester`, `ui-ux-mobile`) não só diagnostica: **valida cada correção**. Toda tela que a gente conserta passa por:

1. **Achados** — puxa os 3 laudos da tela (`/tmp/ux-audit/sweep/{cog,ux,ui}-<mslug>.md` + laudo).
2. **Proposta** — proponho fixes priorizados; o dono **direciona** quais. Se ele apontar algo fora do diagnóstico, eu **avalio a validade** (render/código) antes de aceitar.
3. **Aplico** — edito + `tsc --noEmit` limpo + `vite build` verde.
4. **Re-captura que ESTRESSA o layout** (nunca só o zero-state, que esconde defeito): dado real (números, labels longos, muitos itens), **3 estados** (vazio/carregando/cheio), **2 breakpoints** (desktop 1440 + mobile 390), tema **claro e escuro**.
5. **GATE do time no RESULTADO** — disparo as 3 lentes no screenshot **DEPOIS**. Cada uma responde: (a) o achado foi resolvido? (b) **regrediu** algo? Retorno: **APROVADO** ou **FLAGS**.
6. **Corrijo flags → re-gate.** Só commito quando o time aprova (ou o dono aceita explicitamente).

**Checklist mínimo do gate de UI** (o que pegou o desalinhamento do Início): alinhamento e **alturas iguais por linha**; sem vão órfão; ritmo 8pt; contraste WCAG AA; alvos ≥44px no mobile; nada truncado/estourando; os 3 estados e 2 breakpoints acima.

**Por que:** um achado aponta o problema, mas **virar código bom** exige mão + conferência visual com dado que estressa. Sem o gate, a UI vira consequência da mudança de UX (foi o que gerou a regressão do Início). O gate faz a UI ser aprovação obrigatória.

**Blindagem automática (investimento futuro):** visual-regression Playwright (baseline por tela → diff pixel a pixel acusa regressão sozinho) + **componentizar** padrões repetidos (cards de atenção, tabelas, badges) p/ resolver alinhamento **uma vez** no componente em vez de reajustar flex/altura à mão em cada tela.
