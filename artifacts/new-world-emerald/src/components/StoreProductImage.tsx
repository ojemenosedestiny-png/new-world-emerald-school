import type { StoreProduct } from "@workspace/api-client-react";
import { asset } from "@/lib/asset";

export function StoreProductImage({ product }: { product: StoreProduct }) {
  if (!product.imageUrl) {
    return (
      <div className="flex h-40 items-end bg-primary/10 p-5">
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{product.category}</span>
      </div>
    );
  }

  const src = product.imageUrl.startsWith("/") ? asset(product.imageUrl) : product.imageUrl;
  const isDemo = product.description.startsWith("DEMO:");
  const isDemoProductImage = isDemo && product.imageUrl.startsWith("/store-products/");

  return (
    <figure className="border-b border-border bg-muted/30">
      <div className={product.category === "uniform" ? "aspect-[3/4] overflow-hidden" : "aspect-[4/3] overflow-hidden"}>
        <img
          src={src}
          alt={isDemoProductImage ? `Standalone ${product.title.replace(/^Demo — /, "")}, demo product illustration` : isDemo ? `School photograph illustrating ${product.title.replace(/^Demo — /, "")}` : product.title}
          loading="lazy"
          decoding="async"
          className={isDemoProductImage ? "h-full w-full object-contain" : "h-full w-full object-cover"}
          data-testid={`img-product-${product.id}`}
        />
      </div>
      {isDemo && (
        <figcaption className="px-4 py-2 text-center text-[10px] font-medium tracking-wide text-muted-foreground">
          {isDemoProductImage ? "Demo product illustration" : "School photo · illustrative demo"}
        </figcaption>
      )}
    </figure>
  );
}