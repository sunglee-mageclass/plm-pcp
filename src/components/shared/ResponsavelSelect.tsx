import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

// Responsável de uma OC: escolhe primeiro o TIPO de colaborador (Estilista, Modelista,
// Piloteiro ou qualquer tipo customizado) OU "Livre" (texto), e então o colaborador daquele
// tipo. Emite (nome, id): quem guarda só o nome ignora o id (OC Aviamento/Insumo); OC Tecido
// guarda ambos. Controlado por `nome`/`id` do pai; o modo é derivado deles na carga.

const LIVRE = "__livre__";
const BUILTIN_TIPOS: { value: string; label: string }[] = [
  { value: "estilista", label: "Estilista" },
  { value: "modelista", label: "Modelista" },
  { value: "piloteiro", label: "Piloteiro" },
];

type Colab = { id: string; nome: string; tipo: string | null };

export function ResponsavelSelect({
  nome,
  id,
  onChange,
  disabled,
}: {
  nome: string;
  id?: string | null;
  onChange: (nome: string | null, id: string | null) => void;
  disabled?: boolean;
}) {
  const colabQuery = useQuery({
    queryKey: ["colaboradores-todos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome, tipo").order("nome");
      if (error) throw error;
      return (data ?? []) as Colab[];
    },
  });
  const colaboradores = colabQuery.data ?? [];

  const { data: tiposCustom = [] } = useQuery({
    queryKey: ["tipos-colaborador-nomes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tipos_colaborador" as any).select("nome").order("nome");
      if (error) throw error;
      return ((data ?? []) as any[]).map((t) => t.nome as string);
    },
  });

  // Lista de tipos: fixos + customizados + quaisquer tipos já presentes nos colaboradores.
  const tipos = useMemo(() => {
    const m = new Map<string, string>();
    BUILTIN_TIPOS.forEach((b) => m.set(b.value, b.label));
    tiposCustom.forEach((t) => { if (t && !m.has(t)) m.set(t, t); });
    colaboradores.forEach((c) => { if (c.tipo && !m.has(c.tipo)) m.set(c.tipo, c.tipo); });
    return [...m].map(([value, label]) => ({ value, label }));
  }, [tiposCustom, colaboradores]);

  const [mode, setMode] = useState<string>("estilista"); // tipo string ou LIVRE
  const [seeded, setSeeded] = useState(false);

  // Semeia o modo UMA vez a partir do valor carregado (edição). Prioriza o id; senão o nome.
  useEffect(() => {
    if (seeded || !colabQuery.isSuccess) return;
    if (id) {
      const c = colaboradores.find((x) => x.id === id);
      if (c) { setMode(c.tipo ?? LIVRE); setSeeded(true); return; }
    }
    if (nome) {
      const c = colaboradores.find((x) => x.nome === nome);
      setMode(c?.tipo ?? LIVRE);
      setSeeded(true);
    }
  }, [colabQuery.isSuccess, id, nome, seeded]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedId = useMemo(() => {
    if (mode === LIVRE || !mode) return "";
    if (id && colaboradores.some((c) => c.id === id)) return id;
    return colaboradores.find((c) => c.nome === nome && c.tipo === mode)?.id ?? "";
  }, [mode, id, nome, colaboradores]);

  const opcoes = colaboradores.filter((c) => c.tipo === mode);

  return (
    <div className="flex gap-2">
      <Select
        value={mode}
        onValueChange={(v) => {
          setSeeded(true);
          setMode(v);
          if (v === LIVRE) onChange(nome || "", null);
          else onChange(null, null); // troca de tipo limpa a seleção anterior
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-32 shrink-0"><SelectValue placeholder="Tipo" /></SelectTrigger>
        <SelectContent>
          {tipos.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          <SelectItem value={LIVRE}>Livre</SelectItem>
        </SelectContent>
      </Select>

      {mode === LIVRE ? (
        <Input className="flex-1" value={nome} onChange={(e) => onChange(e.target.value, null)} disabled={disabled} />
      ) : (
        <Select
          value={selectedId}
          onValueChange={(cid) => { const c = colaboradores.find((x) => x.id === cid); onChange(c?.nome ?? null, c?.id ?? null); }}
          disabled={disabled}
        >
          <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione…" /></SelectTrigger>
          <SelectContent>
            {opcoes.length === 0
              ? <div className="p-2 text-xs text-muted-foreground">Nenhum colaborador deste tipo.</div>
              : opcoes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
