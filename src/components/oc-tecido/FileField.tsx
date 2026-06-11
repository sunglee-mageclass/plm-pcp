import { Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function FileField({ label, path, onChange, onClear }: {
  label: string;
  path: string | null;
  onChange: (f: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      {path ? (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="truncate max-w-[200px]">{path.split("/").pop()}</Badge>
          <Button size="sm" variant="ghost" onClick={onClear}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ) : (
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> Selecionar arquivo
          <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && onChange(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}
