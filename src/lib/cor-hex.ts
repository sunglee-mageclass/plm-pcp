// Deriva um hex aproximado a partir do NOME da cor (PT-BR), para o swatch da variante.
// Sem migration: o banco só guarda o NOME da cor. Nomes comuns mapeiam para um hex;
// nome que não casa → null (o swatch cai no fallback neutro var(--muted)).

const MAPA: Record<string, string> = {
  branco: "#ffffff", "off-white": "#f4f1ea", "off white": "#f4f1ea", cru: "#e9e2d0", natural: "#e9e2d0", marfim: "#f5f0e1", gelo: "#eef1f2", perola: "#f0ead6",
  preto: "#1a1a1a", cinza: "#8a8a8a", grafite: "#3a3a3a", chumbo: "#4a4e54", prata: "#c0c0c0",
  vermelho: "#c0392b", vinho: "#5e1f2e", bordo: "#5e1f2e", carmim: "#a01f34", coral: "#e8735a", telha: "#b5533a",
  rosa: "#e79bb0", rose: "#c98a8a", pink: "#e84393", salmao: "#f2a488", magenta: "#c2185b",
  laranja: "#e67e22", terracota: "#b5613f", ferrugem: "#a44a2f", mostarda: "#d4a017", amarelo: "#f1c40f", ouro: "#c9a227", dourado: "#c9a227", canario: "#f7dc6f",
  verde: "#3fae5a", oliva: "#6f7a4d", musgo: "#5a6340", menta: "#9fd8c0", esmeralda: "#2e8b57", militar: "#4b5320", limao: "#c3d600",
  azul: "#2e6fb0", marinho: "#1f2d5a", turquesa: "#1abc9c", celeste: "#8fb8de", jeans: "#4a6a8a", petroleo: "#0f5e6e", "azul bebe": "#a9cce3",
  roxo: "#7d3c98", lilas: "#b39ddb", violeta: "#8e44ad", lavanda: "#c7b8e6", uva: "#5e2b5e",
  marrom: "#6b4423", cafe: "#4b3621", caramelo: "#a86b3c", bege: "#d8c3a5", areia: "#dcc9a6", nude: "#e3c2a8", castanho: "#5b3a29", tabaco: "#6d4c30",
};

const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Retorna um hex aproximado para o nome da cor, ou null se não reconhecer. */
export function corParaHex(nome?: string | null): string | null {
  if (!nome) return null;
  const n = norm(nome);
  if (!n) return null;
  if (MAPA[n]) return MAPA[n];
  // casa por token: pega a primeira cor conhecida contida no nome (ex.: "Azul Royal" → azul)
  for (const key of Object.keys(MAPA)) {
    if (n === key || n.includes(key)) return MAPA[key];
  }
  return null;
}
