import { useState } from "react";
import { Trash2, Upload, ZoomIn, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useSignedUrl } from "@/hooks/useSignedUrl";

function isImage(path: string) {
  return /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(path);
}

function isPdf(path: string) {
  return /\.pdf$/i.test(path);
}

export function FileField({ label, path, onChange, onClear, disabled = false, bucket = "oc-tecido" }: {
  label: string;
  path: string | null;
  onChange: (f: File) => void;
  onClear: () => void;
  disabled?: boolean;
  bucket?: string;
}) {
  const signedUrl = useSignedUrl(path, bucket);
  const [previewOpen, setPreviewOpen] = useState(false);

  const img = path ? isImage(path) : false;
  const pdf = path ? isPdf(path) : false;

  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      {path ? (
        <div className="flex items-center gap-2">
          {img && signedUrl ? (
            <>
              <button type="button" onClick={() => setPreviewOpen(true)} className="truncate max-w-[260px]">
                <Badge variant="secondary" className="truncate max-w-[260px] cursor-pointer hover:bg-accent">
                  <ZoomIn className="h-3 w-3 mr-1" />
                  {path.split("/").pop()}
                </Badge>
              </button>
              <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-w-5xl p-1 border-none bg-transparent shadow-none [&>button]:!text-white [&>button]:top-2 [&>button]:right-2">
                  <img src={signedUrl} alt={label} className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl" />
                </DialogContent>
              </Dialog>
            </>
          ) : pdf && signedUrl ? (
            <>
              <button type="button" onClick={() => setPreviewOpen(true)} className="truncate max-w-[260px]">
                <Badge variant="secondary" className="truncate max-w-[260px] cursor-pointer hover:bg-accent">
                  <FileText className="h-3 w-3 mr-1" />
                  {path.split("/").pop()}
                </Badge>
              </button>
              <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-w-4xl p-0 border-none bg-white shadow-none h-[85vh] [&>button]:!text-black [&>button]:top-2 [&>button]:right-2">
                  <iframe src={signedUrl} className="w-full h-full rounded-md" title={label} />
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <a href={signedUrl ?? path} target="_blank" rel="noreferrer" className="truncate max-w-[260px]">
              <Badge variant="secondary" className="truncate max-w-[260px]">{path.split("/").pop()}</Badge>
            </a>
          )}
          {!disabled && (
            <Button size="sm" variant="ghost" onClick={onClear}><Trash2 className="h-4 w-4" /></Button>
          )}
        </div>
      ) : disabled ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> Selecionar arquivo
          <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && onChange(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}
