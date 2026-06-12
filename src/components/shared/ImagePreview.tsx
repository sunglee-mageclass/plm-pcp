import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export function ImagePreview({ src, alt, children }: {
  src: string;
  alt: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        className="cursor-zoom-in"
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl p-1 border-none bg-transparent shadow-none [&>button]:!text-white [&>button]:top-2 [&>button]:right-2">
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
