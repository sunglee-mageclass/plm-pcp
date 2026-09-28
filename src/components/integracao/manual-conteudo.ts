// Integração — Manual da API (P-81 A; mockup 7f): os 9 tópicos como DADOS (a tela só desenha). Linguagem simples, para o
// dono E para o dev; sem segredos (chave fictícia). Os JSONs de exemplo são montados pela MESMA função da rota
// (montarResposta) — o manual nunca diverge do formato real.
import { CAMPOS } from "@/lib/integracao/campos";
import { CAMINHO_FOTO_EXEMPLO, montarResposta, type RespostaApi, type RespostaLer } from "@/lib/integracao/api/resposta";

export type Bloco =
  | { tipo: "p"; texto: string }
  | { tipo: "passos"; itens: string[] }
  | { tipo: "lista"; itens: string[] }
  | { tipo: "codigo"; titulo: string; codigo: string }
  | { tipo: "tabela"; cabecalho: string[]; linhas: string[][] }
  | { tipo: "faq"; itens: { p: string; r: string }[] }
  | { tipo: "exemplo" };
export type SecaoManual = { id: string; titulo: string; blocos: Bloco[] };
export const CHAVE_FICTICIA = "wish_live_EXEMPLO1234567890";
/** P-89 A (dono 27/set): "isso pode mudar depois … como fazer no manual/guia?" — vai em Parâmetros, Boas práticas e FAQ. */
export const TEXTO_PAGINA_PODE_MUDAR =
  "O número de produtos por página pode mudar (é uma configuração da loja). Seu programa nunca deve contar com um tamanho fixo de página: siga o proximo_cursor até ele vir vazio e, se quiser, leia pagina.maximo para pedir páginas maiores.";

const CHAVES = CAMPOS.map((c) => c.key);
const linhaDe = (tipo: "produto" | "variante", v: Record<string, unknown>) => ({ tipo, valores: CHAVES.map((k) => (k in v ? v[k] : null)) });

/** Resposta de exemplo no formato REAL (18 colunas do layout + Foto). Normal = Saia Marola (a única "Integrado em" do mockup);
 *  teste = produtos FICTÍCIOS "Produto Exemplo N" (P-82 A), foto = endereço público de exemplo (n3). */
export function respostaExemplo(modo: "normal" | "teste", origem: string): RespostaApi {
  const loja = { id: "a91f0c2d-0000-4000-8000-000000000001", nome: "WISH360 Demo" };
  const base = modo === "normal"
    ? { nome: "Saia Marola", ref_sku: "SAMA0019", preco_anterior: "199.90", preco_venda: "179.90", peso: "0.310", ncm: "6204.52.00",
        preco_custo: "71.30", titulo: "Saia Marola Godê", descricao: "Saia godê em crepe, comprimento midi.", keywords: "moda feminina, roupas",
        metatag: "Saia godê em crepe, comprimento midi.", comprimento: "90", largura: "36", altura: "2" }
    : { nome: "Produto Exemplo 1", ref_sku: "EXPL0001", preco_anterior: "109.90", preco_venda: "99.90", peso: "0.300", ncm: "6109.10.00",
        preco_custo: "42.00", titulo: "Produto Exemplo 1 - exemplo", descricao: "Descrição de exemplo do produto 1.", keywords: "exemplo, teste",
        metatag: "Descrição de exemplo do produto 1.", comprimento: "60", largura: "40", altura: "2" };
  const variante = modo === "normal"
    ? { ...base, nome: "Saia Marola P", ref_sku: "SAMA0019-PRT-P", cor_base: "Preto", cor_apelido: null, tamanho: "P", foto: [] }
    : { ...base, nome: "Produto Exemplo 1 P", ref_sku: "EXPL0001-COR-P", cor_base: "Cor Exemplo", cor_apelido: "Apelido Exemplo", tamanho: "P", foto: [] };
  const r: RespostaLer = {
    status: "ok", modo, tenant_id: loja.id, loja, colunas: CAMPOS.map((c) => c.rotulo), chaves_colunas: CHAVES,
    proximo_cursor: modo === "teste" ? "eyJleGVtcGxvIjogMn0=" : null,
    pagina: modo === "teste" ? { limite: 2, maximo: 50 } : { limite: 50, maximo: 50 },
    produtos: [{
      modelo_id: modo === "normal" ? "c3a1e2b4-0000-4000-8000-000000000001" : "exemplo-0001", estado: modo === "normal" ? "integrado" : "teste",
      assinatura: null, integrado_em: modo === "normal" ? "2026-09-26T17:35:00.000Z" : null,
      linhas: [linhaDe("produto", { ...base, foto: modo === "normal" ? ["saia-marola.jpg"] : ["exemplo"] }), linhaDe("variante", variante)],
    }],
  };
  return montarResposta(r, {
    geradoEm: "2026-09-26T23:48:00.000Z",
    foto: (c) => c.map((p) => (modo === "teste" ? `${origem}${CAMINHO_FOTO_EXEMPLO}` : `https://…/fotos/${p}?token=…`)),
  });
}

export function montarManual(origem: string): SecaoManual[] {
  const url = `${origem}/api/integracao/v1/produtos`;
  const h = `-H "Authorization: Bearer ${CHAVE_FICTICIA}"`;
  return [
    { id: "s1", titulo: "O que é e como funciona", blocos: [
      { tipo: "p", texto: "A Integração organiza os produtos da loja para serem LIDOS por um programa externo (ERP ou e-commerce) através de uma API própria do sistema. Em 3 passos:" },
      { tipo: "passos", itens: ["Integrável — produto completo, marcado à mão.", "A API leva — o dev consulta com a chave.", "Integrado — travado; só o super admin desfaz."] },
      { tipo: "p", texto: 'O que foi levado fica travado no banco (nome, preço, SKU, fotos…). Um erro depois de enviado é responsabilidade de quem confirmou — não existe "corrigir depois" pelo sistema.' },
    ] },
    { id: "s2", titulo: "Passo a passo para integrar", blocos: [
      { tipo: "passos", itens: [
        "Criar uma chave em API › Chaves (super admin).",
        "Entregar a chave ao dev por um canal SEGURO (nunca por e-mail aberto ou chat público).",
        'O dev testa em modo teste (modo=teste) — no mesmo formato, com produtos de EXEMPLO fictícios; nada vira integrado. Serve para montar o programa sem "gastar" produtos.',
        "Quando estiver funcionando, o dev liga de verdade (sem modo=teste).",
        'Conferir no Log e na aba Produtos se os produtos certos ficaram "Integrado".',
      ] },
    ] },
    { id: "s3", titulo: "Endereço e comandos", blocos: [
      { tipo: "p", texto: "Endereço: GET /api/integracao/v1/produtos — exemplos prontos (chave fictícia abaixo — troque pela sua):" },
      { tipo: "codigo", titulo: "Terminal (curl)", codigo: `# Consulta normal\ncurl "${url}?limite=50" \\\n  ${h}` },
      { tipo: "codigo", titulo: "JavaScript", codigo: `// Consulta normal\nconst r = await fetch(\n  "${url}?limite=50",\n  { headers: { Authorization: "Bearer ${CHAVE_FICTICIA}" } }\n);\nconst dados = await r.json();` },
      { tipo: "codigo", titulo: "Python", codigo: `import requests\nr = requests.get(\n    "${url}",\n    params={"limite": 50},\n    headers={"Authorization": "Bearer ${CHAVE_FICTICIA}"},\n)\ndados = r.json()` },
      { tipo: "codigo", titulo: "Modo teste — produtos de EXEMPLO (fictícios) no formato real; nada vira integrado", codigo: `curl "${url}?modo=teste&limite=20" \\\n  ${h}` },
      { tipo: "codigo", titulo: "Próxima página (cursor)", codigo: `curl "${url}?limite=50&cursor=<proximo_cursor da resposta anterior>" \\\n  ${h}` },
      { tipo: "codigo", titulo: "Reler produtos já integrados (ex.: a resposta anterior se perdeu)", codigo: `curl "${url}?incluir_integrados=1&limite=50" \\\n  ${h}` },
    ] },
    { id: "s4", titulo: "Parâmetros", blocos: [
      { tipo: "tabela", cabecalho: ["Parâmetro", "O que faz", "Padrão", "Exemplo"], linhas: [
        ["modo", "normal ou teste — teste devolve produtos de EXEMPLO fictícios no formato real, nunca dados reais; nada vira integrado", "normal", "modo=teste"],
        ["incluir_integrados", "0 = só integráveis; 1 = inclui os já integrados também", "0", "incluir_integrados=1"],
        ["limite", "nº de produtos por página, até o máximo configurado da loja (hoje, padrão 50); sem limite = o máximo; um produto nunca é partido entre páginas", "o máximo da loja", "limite=50"],
        ["cursor", "devolvido em proximo_cursor da resposta anterior — envie de volta para pedir a próxima página", "vazio (1ª página)", "cursor=…"],
      ] },
      { tipo: "p", texto: TEXTO_PAGINA_PODE_MUDAR },
    ] },
    { id: "s5", titulo: "A resposta explicada", blocos: [
      { tipo: "tabela", cabecalho: ["Campo", "O que é"], linhas: [
        ["versao", "versão do formato da resposta"],
        ["modo", '"normal" ou "teste" (espelha o parâmetro pedido)'],
        ["loja", "{id, nome} — a EMPRESA (não as lojas do Direcionamento)"],
        ["colunas", 'nomes de TODAS as colunas marcadas em "Campos da API", na mesma ordem de valores'],
        ["gerado_em", "data/hora em que esta resposta foi gerada"],
        ["pagina", "{limite, maximo} — limite = quantos produtos por página ESTA resposta usou; maximo = o máximo que a loja permite HOJE (pode mudar). Para páginas maiores, peça limite até pagina.maximo"],
        ["linhas[].tipo", '"produto" (a linha do produto) ou "variante" (uma linha cor × tamanho)'],
        ["produto_id", "id do produto (o mesmo em todas as sublinhas dele)"],
        ["loja_id / loja_nome", "a EMPRESA (não as lojas do Direcionamento)"],
        ["integrado_em", "data/hora em que a API confirmou a entrega (vazio em modo teste — nada é integrado nesse modo)"],
        ["valores", 'na ordem de "colunas"; a coluna Foto traz a LISTA de links (Foto 1..N) na linha do produto — os links expiram'],
        ["proximo_cursor", "passe em cursor na próxima chamada; vazio = não há mais páginas"],
      ] },
      { tipo: "exemplo" },
      { tipo: "codigo", titulo: "JSON de exemplo — modo NORMAL (dados reais da loja; só produtos JÁ INTEGRÁVEIS são levados)", codigo: JSON.stringify(respostaExemplo("normal", origem), null, 2) },
      { tipo: "codigo", titulo: "JSON de exemplo — modo TESTE (produtos FICTÍCIOS, no MESMO FORMATO da loja, nunca dados reais)", codigo: JSON.stringify(respostaExemplo("teste", origem), null, 2) },
      { tipo: "p", texto: 'Nunca dados reais no modo teste — nomes/REFs sempre "Exemplo"/"EXPL..." mesmo que sua loja tenha produtos de verdade. O link da foto também é de exemplo (público).' },
    ] },
    { id: "s6", titulo: "Códigos de resposta", blocos: [
      { tipo: "tabela", cabecalho: ["Código", "O que fazer"], linhas: [
        ["200", "Ok — a resposta veio normal, use os dados."],
        ["400", "Parâmetro inválido — confira modo, incluir_integrados, limite e cursor."],
        ["401", "Chave errada ou revogada — confira a chave; se foi revogada, peça uma nova ao super admin."],
        ["403", "Loja inativa — fale com o super admin."],
        ["429", "Limite excedido (ou IP bloqueado por chaves erradas) — espere o tempo indicado em Retry-After e tente de novo."],
        ["500", "Erro do site — tente de novo; se repetir, avise o suporte."],
      ] },
    ] },
    { id: "s7", titulo: "Boas práticas", blocos: [
      { tipo: "lista", itens: [
        TEXTO_PAGINA_PODE_MUDAR,
        "Guarde o produto_id no seu sistema — é a chave de ligação entre os dois lados.",
        "Se a resposta se perder no meio do caminho, releia com incluir_integrados=1.",
        "Nunca coloque a chave no código do site/app (client-side) — ela é para o servidor do ERP, nunca aparece no navegador.",
        "As fotos expiram em N dias (configuração da loja; padrão 7) — baixe/guarde a foto no seu lado, não dependa do link para sempre.",
      ] },
    ] },
    { id: "s8", titulo: "Perguntas frequentes", blocos: [
      { tipo: "faq", itens: [
        { p: "Posso testar sem afetar os produtos de verdade?", r: "Sim — use modo=teste. A resposta traz produtos de EXEMPLO (fictícios) no mesmo formato da sua loja, nunca dados reais, e nada vira integrado." },
        { p: "Um produto integrado pode ser editado depois?", r: 'Não — os campos que foram para a API ficam travados. Só o super admin pode "Desfazer integração" (com motivo), e aí o produto volta a ser editável.' },
        { p: "Perdi a resposta de uma consulta — e agora?", r: "Releia com incluir_integrados=1: os produtos já confirmados aparecem de novo, sem duplicar nada no banco." },
        { p: "Quantos produtos vêm por página?", r: 'Até o "Máximo de produtos por página" configurado da loja (hoje, padrão 50). A própria resposta diz: pagina.limite (usado nesta resposta) e pagina.maximo (o máximo de hoje). Um produto nunca é dividido entre duas páginas.' },
        { p: "O tamanho da página pode mudar?", r: TEXTO_PAGINA_PODE_MUDAR },
        { p: "O que acontece se eu errar a chave várias vezes?", r: "Depois de N tentativas erradas em 10 minutos (configurável), chaves erradas vindas desse IP ficam bloqueadas por um tempo — a chave certa continua funcionando." },
        { p: "Posso ter mais de uma chave?", r: "Sim — crie uma por integração/ambiente (ex.: uma para o ERP, outra para testes) e revogue a que não usa mais." },
      ] },
    ] },
    { id: "s9", titulo: "Checklist antes de ligar de verdade", blocos: [
      { tipo: "lista", itens: [
        "Testei em modo=teste e a resposta trouxe os campos que eu esperava.",
        "Sei paginar até proximo_cursor vazio.",
        "Guardo o produto_id no meu sistema.",
        "A chave está guardada com segurança (nunca no código do site/app).",
        "Sei o que fazer em cada código de erro (400/401/403/429/500).",
        'Combinei com o time quando os produtos vão passar de "Integrável" para "Integrado" de verdade.',
      ] },
    ] },
  ];
}
