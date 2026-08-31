import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Trash2, ImageIcon, FileText } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImagePreview, AnexoThumbZoom } from "@/components/shared/ImagePreview";

const BUCKET = "oc-tecido";

// O campo aceita PDF além de imagem (accept="image/*,application/pdf") — detecta pelo
// path pra desviar do <img> (nunca carrega PDF) pro tratamento correto em cada renderizador.
const isPdfPath = (path: string) => /\.pdf(\?|$)/i.test(path);

/** Nome legível do arquivo a partir do path do storage (remove prefixo uuid-). */
function nomeArquivo(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/^[0-9a-f-]{36}-/i, "");
}

const urlCache = new Map<string, { url: string; exp: number }>();

function useSignedUrls(paths: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const now = Date.now();
    const missing: string[] = [];
    const next: Record<string, string> = {};
    paths.forEach((p) => {
      const c = urlCache.get(p);
      if (c && c.exp > now + 60_000) next[p] = c.url;
      else missing.push(p);
    });
    setUrls(next);
    if (missing.length === 0) return;
    (async () => {
      const results = await Promise.all(
        missing.map((p) => supabase.storage.from(BUCKET).createSignedUrl(p, 3600)),
      );
      if (!alive) return;
      const merged = { ...next };
      results.forEach((r, i) => {
        const url = r.data?.signedUrl;
        if (url) {
          urlCache.set(missing[i], { url, exp: now + 3600_000 });
          merged[missing[i]] = url;
        }
      });
      setUrls(merged);
    })();
    return () => {
      alive = false;
    };
  }, [paths.join("|")]);
  return urls;
}

async function uploadEtiqueta(file: File) {
  const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = `${tenant}/etiqueta_lavagem/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

function Thumb({ path, signed, onRemove }: { path: string; signed?: string; onRemove?: () => void }) {
  // PDF: <img> nunca carrega esse tipo — delega miniatura+zoom+remover pro AnexoThumbZoom
  // (já trata PDF via iframe e já embute o botão de remover, então retorna cedo p/ não duplicar).
  if (isPdfPath(path)) {
    return <AnexoThumbZoom url={signed} isPdf onRemove={onRemove} />;
  }
  return (
    <div className="relative group">
      {signed ? (
        <ImagePreview src={signed} alt="Etiqueta de lavagem">
          <img
            src={signed}
            alt="Etiqueta de lavagem"
            className="h-20 w-20 object-cover rounded border bg-muted cursor-zoom-in"
          />
        </ImagePreview>
      ) : (
        <div className="h-20 w-20 rounded border bg-muted flex items-center justify-center text-muted-foreground">
          <ImageIcon className="h-6 w-6" />
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-2 -right-2 rounded-full bg-destructive text-destructive-foreground p-1 opacity-0 group-hover:opacity-100 transition"
          title="Remover etiqueta"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/** Read-only thumbnails for an artigo's etiquetas. */
export function EtiquetaLavagemArtigoView({
  artigoId,
  label = "Etiqueta de Lavagem",
  size = "md",
}: {
  artigoId: string | null | undefined;
  label?: string;
  size?: "sm" | "md";
}) {
  const { data: urls = [] } = useQuery({
    queryKey: ["artigo-etiqueta", artigoId],
    enabled: !!artigoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("etiqueta_lavagem_urls")
        .eq("id", artigoId!)
        .maybeSingle();
      if (error) throw error;
      return ((data as any)?.etiqueta_lavagem_urls ?? []) as string[];
    },
    staleTime: 60_000,
  });
  const signed = useSignedUrls(urls);
  if (!artigoId || urls.length === 0) return null;
  const dim = size === "sm" ? "h-12 w-12" : "h-20 w-20";
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {urls.map((p) =>
          isPdfPath(p) ? (
            // AnexoThumbZoom é h-20/w-20 fixo — não respeita size="sm" (h-12) usado pelas
            // 3 telas que consomem esta View (Explosão/CAD/Dev). Pra não quebrar o tamanho
            // consistente da fileira nem duplicar um segundo componente de miniatura,
            // usa um link simples com ícone de PDF no MESMO `dim`, nos dois tamanhos.
            <a
              key={p}
              href={signed[p] ?? "#"}
              target="_blank"
              rel="noreferrer"
              title="Abrir etiqueta (PDF)"
              className={`${dim} rounded border bg-muted flex flex-col items-center justify-center gap-0.5 text-muted-foreground hover:bg-accent transition`}
            >
              <FileText className={size === "sm" ? "h-4 w-4" : "h-6 w-6"} />
              <span className="text-[9px] leading-none">PDF</span>
            </a>
          ) : (
            <ImagePreview key={p} src={signed[p]} alt="Etiqueta de lavagem">
              <img
                src={signed[p]}
                alt="Etiqueta de lavagem"
                className={`${dim} object-cover rounded border bg-muted cursor-zoom-in`}
              />
            </ImagePreview>
          ),
        )}
      </div>
    </div>
  );
}

/** Versão p/ impressão: <img> simples, sem ImagePreview/botão (que o print esconde). */
export function EtiquetaLavagemArtigoPrint({ artigoId }: { artigoId: string | null | undefined }) {
  const { data: urls = [] } = useQuery({
    queryKey: ["artigo-etiqueta", artigoId],
    enabled: !!artigoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("etiqueta_lavagem_urls")
        .eq("id", artigoId!)
        .maybeSingle();
      if (error) throw error;
      return ((data as any)?.etiqueta_lavagem_urls ?? []) as string[];
    },
    staleTime: 60_000,
  });
  const signed = useSignedUrls(urls);
  if (!artigoId || urls.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {urls.map((p) => {
        if (isPdfPath(p)) {
          // Nem <iframe> nem <img> renderizam PDF no papel (impressão) — mostra um bloco
          // honesto com o nome do arquivo em vez de um espaço vazio/quebrado.
          return (
            <div
              key={p}
              style={{
                maxHeight: 96,
                minWidth: 90,
                maxWidth: 150,
                padding: "8px 10px",
                border: "1px solid #ccc",
                borderRadius: 4,
                fontSize: 10,
                lineHeight: 1.3,
                wordBreak: "break-word",
              }}
            >
              📄 Etiqueta (PDF)
              <br />
              {nomeArquivo(p)}
            </div>
          );
        }
        return signed[p] ? (
          <img
            key={p}
            src={signed[p]}
            alt="Etiqueta de lavagem"
            style={{ maxHeight: 96, maxWidth: 150, height: "auto", width: "auto", objectFit: "contain", border: "1px solid #ccc", borderRadius: 4 }}
          />
        ) : null;
      })}
    </div>
  );
}

/** Editable etiquetas for an artigo (used in OC recebimento). */
export function EtiquetaLavagemArtigoEditor({
  artigoId,
  label = "Etiqueta de Lavagem",
}: {
  artigoId: string | null | undefined;
  label?: string;
}) {
  const qc = useQueryClient();
  const { data: urls = [], isLoading } = useQuery({
    queryKey: ["artigo-etiqueta", artigoId],
    enabled: !!artigoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("etiqueta_lavagem_urls")
        .eq("id", artigoId!)
        .maybeSingle();
      if (error) throw error;
      return ((data as any)?.etiqueta_lavagem_urls ?? []) as string[];
    },
  });
  const signed = useSignedUrls(urls);

  const saveMut = useMutation({
    mutationFn: async (next: string[]) => {
      if (!artigoId) throw new Error("Artigo não selecionado");
      const { error } = await supabase
        .from("artigos")
        .update({ etiqueta_lavagem_urls: next })
        .eq("id", artigoId);
      if (error) throw error;
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["artigo-etiqueta", artigoId] }),
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const onAdd = async (file: File) => {
    try {
      const path = await uploadEtiqueta(file);
      saveMut.mutate([...urls, path]);
      toast.success("Etiqueta salva no tecido");
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  const onRemove = (path: string) => {
    saveMut.mutate(urls.filter((u) => u !== path));
    // Best-effort: apaga o arquivo do bucket p/ não deixar órfão (não bloqueia o save).
    supabase.storage.from(BUCKET).remove([path]);
  };

  if (!artigoId) {
    return (
      <div className="grid gap-1">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">Selecione um tecido para anexar etiqueta.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : urls.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma etiqueta cadastrada para este tecido.</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {urls.map((p) => (
            <Thumb key={p} path={p} signed={signed[p]} onRemove={() => onRemove(p)} />
          ))}
        </div>
      )}
      <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
        <Upload className="h-4 w-4" />
        {urls.length > 0 ? "Adicionar/Substituir" : "Selecionar arquivo"}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onAdd(e.target.files[0])}
        />
      </label>
    </div>
  );
}
