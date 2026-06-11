import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Rocket, Search, Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/producao/lancamentos")({
  component: LancamentosPage,
});

type Card = {
  modelo_id: string;
  cad_id: string;
  ref: string | null;
  nome: string | null;
  colecao: string | null;
  semana: string | null;
  mes_id: string | null;
  ano_id: string | null;
  categoria_nome: string | null;
  fotos_modelo: string[];
  lancamento?: any;
  signedFoto?: string | null;
};

function LancamentosPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useState("all");
  const [fSemana, setFSemana] = useState("all");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");

  const { data: cards = [], isLoading } = useQuery<Card[]>({
    queryKey: ["lancamentos-cards"],
    queryFn: async () => {
      // Modelos com CAD existente e que tenham direcionamento (fluxo completo)
      const { data: modelos, error } = await supabase
        .from("modelos")
        .select("id, ref, nome, colecao, semana, mes_id, ano_id, fotos_modelo, categorias_produto:categoria_principal_id(nome), cad(id), lancamentos(id, data_lancamento, foto_peca_amostra, semana_lancamento, mes_lancamento, ano_lancamento)")
        .eq("enviado_cad", true);
      if (error) throw error;

      const list = (modelos ?? []).filter((m: any) => m.cad?.[0]?.id);
      const cadIds = list.map((m: any) => m.cad[0].id);
      const dirSet = new Set<string>();
      if (cadIds.length) {
        const { data: dirs } = await supabase.from("direcionamento").select("cad_id").in("cad_id", cadIds);
        (dirs ?? []).forEach((d: any) => dirSet.add(d.cad_id));
      }

      return list
        .filter((m: any) => dirSet.has(m.cad[0].id))
        .map((m: any) => ({
          modelo_id: m.id,
          cad_id: m.cad[0].id,
          ref: m.ref,
          nome: m.nome,
          colecao: m.colecao,
          semana: m.semana,
          mes_id: m.mes_id,
          ano_id: m.ano_id,
          categoria_nome: m.categorias_produto?.nome ?? null,
          fotos_modelo: Array.isArray(m.fotos_modelo) ? m.fotos_modelo : [],
          lancamento: m.lancamentos?.[0] ?? null,
        }));
    },
  });

  const { data: meses = [] } = useQuery({
    queryKey: ["opt", "meses"],
    queryFn: async () => (await supabase.from("meses").select("id, nome").order("nome")).data ?? [],
  });
  const { data: anos = [] } = useQuery({
    queryKey: ["opt", "anos"],
    queryFn: async () => (await supabase.from("anos").select("id, nome").order("nome")).data ?? [],
  });

  const colecoes = useMemo(
    () => Array.from(new Set(cards.map((c) => c.colecao).filter(Boolean))) as string[],
    [cards],
  );
  const semanas = useMemo(
    () => Array.from(new Set(cards.map((c) => c.semana).filter(Boolean))) as string[],
    [cards],
  );

  const filtered = cards.filter((c) => {
    if (q && !`${c.ref ?? ""} ${c.nome ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (fColecao !== "all" && c.colecao !== fColecao) return false;
    if (fSemana !== "all" && c.semana !== fSemana) return false;
    if (fMes !== "all" && c.mes_id !== fMes) return false;
    if (fAno !== "all" && c.ano_id !== fAno) return false;
    return true;
  });

  const uploadMut = useMutation({
    mutationFn: async (args: { card: Card; file: File }) => {
      const { card, file } = args;
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${card.modelo_id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("lancamentos").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      const today = new Date().toISOString().slice(0, 10);
      const payload = {
        cad_id: card.cad_id,
        modelo_id: card.modelo_id,
        foto_peca_amostra: path,
        data_lancamento: card.lancamento?.data_lancamento ?? today,
        semana_lancamento: card.semana ?? null,
        verificado: true,
      };
      if (card.lancamento?.id) {
        const { error } = await supabase.from("lancamentos").update(payload).eq("id", card.lancamento.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("lancamentos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("Foto enviada");
      await qc.invalidateQueries({ queryKey: ["lancamentos-cards"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao enviar foto"),
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Rocket className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Lançamentos</h1>
          <p className="text-sm text-muted-foreground">Produtos que completaram todo o fluxo de produção.</p>
        </div>
      </header>

      <Card className="p-4 grid gap-3 md:grid-cols-5">
        <div className="relative md:col-span-2">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="REF ou nome…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={fSemana} onValueChange={setFSemana}>
          <SelectTrigger><SelectValue placeholder="Semana" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas semanas</SelectItem>
            {semanas.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fMes} onValueChange={setFMes}>
          <SelectTrigger><SelectValue placeholder="Mês" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos meses</SelectItem>
            {(meses as any[]).map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fAno} onValueChange={setFAno}>
          <SelectTrigger><SelectValue placeholder="Ano" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos anos</SelectItem>
            {(anos as any[]).map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fColecao} onValueChange={setFColecao}>
          <SelectTrigger><SelectValue placeholder="Coleção" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas coleções</SelectItem>
            {colecoes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && filtered.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum produto pronto para lançamento.</Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filtered.map((c) => (
          <LancamentoCard key={c.modelo_id} card={c} onUpload={(file) => uploadMut.mutate({ card: c, file })} uploading={uploadMut.isPending} />
        ))}
      </div>
    </div>
  );
}

function LancamentoCard(props: { card: Card; onUpload: (f: File) => void; uploading: boolean }) {
  const { card, onUpload, uploading } = props;
  const ref = useRef<HTMLInputElement>(null);

  const { data: amostraUrl } = useQuery({
    queryKey: ["lanc-amostra", card.lancamento?.foto_peca_amostra],
    enabled: !!card.lancamento?.foto_peca_amostra,
    queryFn: async () => {
      const { data } = await supabase.storage.from("lancamentos").createSignedUrl(card.lancamento.foto_peca_amostra, 3600);
      return data?.signedUrl ?? null;
    },
  });

  const { data: modeloFoto } = useQuery({
    queryKey: ["modelo-foto", card.fotos_modelo?.[0]],
    enabled: !!card.fotos_modelo?.[0],
    queryFn: async () => {
      const path = card.fotos_modelo[0];
      const { data } = await supabase.storage.from("modelos").createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    },
  });

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="aspect-square bg-muted relative">
        {amostraUrl ? (
          <img src={amostraUrl} alt={card.ref ?? ""} className="w-full h-full object-cover" />
        ) : modeloFoto ? (
          <img src={modeloFoto} alt={card.ref ?? ""} className="w-full h-full object-cover opacity-60" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">Sem foto</div>
        )}
        {card.lancamento?.verificado && (
          <Badge className="absolute top-2 right-2 bg-emerald-500 text-white">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Lançado
          </Badge>
        )}
      </div>
      <div className="p-3 space-y-1 flex-1">
        <p className="font-mono text-xs text-primary">{card.ref ?? "—"}</p>
        <p className="font-semibold text-sm leading-tight line-clamp-2">{card.nome ?? "—"}</p>
        <p className="text-xs text-muted-foreground">{card.categoria_nome ?? "—"}</p>
        <p className="text-xs text-muted-foreground">
          {card.lancamento?.data_lancamento ?? "Sem data"}
        </p>
      </div>
      <div className="p-3 pt-0">
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" className="w-full" onClick={() => ref.current?.click()} disabled={uploading}>
          <Upload className="h-3.5 w-3.5 mr-1" />
          {card.lancamento?.foto_peca_amostra ? "Trocar foto" : "Enviar foto"}
        </Button>
      </div>
    </Card>
  );
}
