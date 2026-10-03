import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { customFetch, useRequestUploadUrl } from "@workspace/api-client-react";
import { productPhotoUrl } from "@/lib/productPhotoUrl";

const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
const maxBytes = 10 * 1024 * 1024;

type ProductPhotoUploadProps = {
  productKey: string | number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onUploadingChange: (uploading: boolean) => void;
};

export function ProductPhotoUpload({
  productKey,
  value,
  onChange,
  disabled = false,
  onUploadingChange,
}: ProductPhotoUploadProps) {
  const upload = useRequestUploadUrl();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestRef = useRef<object | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const productKeyRef = useRef(productKey);
  const valueRef = useRef(value);
  productKeyRef.current = productKey;
  valueRef.current = value;

  useEffect(() => () => {
    requestRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  async function uploadPhoto(file?: File) {
    if (!file || requestRef.current !== null) return;
    if (!allowedTypes.includes(file.type) || file.size > maxBytes) {
      setError("Choose a JPEG, PNG or WebP photo no larger than 10 MB. Your current photo has not changed.");
      setMessage("");
      return;
    }

    const requestToken = {};
    const controller = new AbortController();
    const startingProductKey = productKey;
    const startingValue = value;
    requestRef.current = requestToken;
    controllerRef.current = controller;
    setUploading(true);
    onUploadingChange(true);
    setError("");
    setMessage("");

    try {
      const result = await upload.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      if (requestRef.current !== requestToken) return;
      await customFetch(result.uploadURL, {
        method: "PUT",
        credentials: "omit",
        headers: { "Content-Type": file.type },
        body: file,
        signal: controller.signal,
        responseType: "text",
      });
      if (
        requestRef.current !== requestToken ||
        productKeyRef.current !== startingProductKey ||
        valueRef.current !== startingValue
      ) return;

      onChange(productPhotoUrl(result.objectPath, import.meta.env.BASE_URL));
      setMessage("Photo uploaded. Save the product to apply this change.");
    } catch (cause) {
      if (requestRef.current !== requestToken) return;
      const reason = cause instanceof Error ? cause.message : "The upload request failed.";
      setError(`${reason} Your previous photo is unchanged.`);
    } finally {
      if (requestRef.current === requestToken) {
        requestRef.current = null;
        controllerRef.current = null;
        setUploading(false);
        onUploadingChange(false);
      }
    }
  }

  return (
    <div className="space-y-3">
      <span className="block text-sm font-semibold">Product photo <span className="font-normal text-muted-foreground">(optional)</span></span>
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center">
        <div className="flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/50 sm:w-36">
          {value
            ? <img src={value} alt="Product preview" className="h-full w-full object-contain" data-testid="img-product-photo-preview" />
            : <div className="flex flex-col items-center gap-2 text-muted-foreground"><ImagePlus size={24} /><span className="text-xs">Photo preview</span></div>}
        </div>
        <div className="min-w-0 flex-1">
          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm font-semibold text-primary ${disabled ? "pointer-events-none opacity-60" : "hover:bg-primary/10"}`}>
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {uploading ? "Uploading photo…" : value ? "Replace photo" : "Choose a photo"}
            <input
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              disabled={disabled || uploading}
              data-testid="input-product-photo"
              onChange={(event) => {
                void uploadPhoto(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">JPEG, PNG or WebP · maximum 10 MB. Uploading does not publish or save the product.</p>
          {value && <button type="button" disabled={disabled || uploading} onClick={() => { setError(""); setMessage(""); onChange(""); }} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-destructive disabled:opacity-50" data-testid="button-clear-product-photo"><Trash2 size={13} /> Clear photo</button>}
        </div>
      </div>
      <label className="block text-xs font-semibold text-muted-foreground">
        Or enter a photo URL
        <input
          value={value}
          disabled={disabled || uploading}
          onChange={(event) => { setError(""); setMessage(""); onChange(event.target.value); }}
          placeholder="Optional HTTPS URL"
          data-testid="input-product-image-url"
          className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-normal text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
        />
      </label>
      {error && <p role="alert" className="rounded-lg bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive" data-testid="error-product-photo-upload">{error}</p>}
      {message && <p role="status" className="text-xs font-medium text-primary" data-testid="status-product-photo-upload">{message}</p>}
    </div>
  );
}