export type TemplateId = "admissions" | "event" | "announcement";
export type SizeId = "landscape" | "square";

export interface GraphicFields {
  title: string;
  description: string;
  detail: string;
  cta: string;
}

export const LIMITS = { title: 80, description: 220, detail: 60, cta: 32 };
export const SIZES: Record<SizeId, { w: number; h: number; label: string }> = {
  landscape: { w: 1200, h: 630, label: "Landscape 1200 x 630" },
  square: { w: 1080, h: 1080, label: "Square 1080 x 1080" },
};

interface Palette { bg1: string; bg2: string; ink: string; sub: string; accent: string; ctaBg: string; ctaInk: string; kicker: string }
const PALETTES: Record<TemplateId, Palette & { name: string }> = {
  admissions: { name: "Admissions", bg1: "#0b4a2f", bg2: "#06301f", ink: "#ffffff", sub: "#d5e8dd", accent: "#d9b441", ctaBg: "#d9b441", ctaInk: "#0f172a", kicker: "ADMISSIONS" },
  event: { name: "School event", bg1: "#14203a", bg2: "#0c1426", ink: "#ffffff", sub: "#cbd5e6", accent: "#d9b441", ctaBg: "#ffffff", ctaInk: "#0c1426", kicker: "SCHOOL EVENT" },
  announcement: { name: "Announcement", bg1: "#f7f3e6", bg2: "#ebe4cd", ink: "#0b3a26", sub: "#3f5148", accent: "#0b4a2f", ctaBg: "#0b4a2f", ctaInk: "#ffffff", kicker: "ANNOUNCEMENT" },
};
export const TEMPLATE_OPTIONS = (Object.keys(PALETTES) as TemplateId[]).map((id) => ({ id, name: PALETTES[id].name }));

export function escapeXml(v: string): string {
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

let measurementContext: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string, fontSize: number, factor: number): number {
  if (typeof document !== "undefined") {
    measurementContext ??= document.createElement("canvas").getContext("2d");
    if (measurementContext) {
      measurementContext.font = factor === 0.56
        ? `700 ${fontSize}px Georgia, 'Times New Roman', serif`
        : `${factor >= 0.58 ? 700 : 400} ${fontSize}px 'Segoe UI', Helvetica, Arial, sans-serif`;
      return measurementContext.measureText(text).width;
    }
  }
  // Conservative fallback when no browser canvas is available.
  return Array.from(text).length * fontSize * 1.1;
}

function wrap(text: string, maxWidth: number, fontSize: number, factor: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let word of words) {
    while (textWidth(word, fontSize, factor) > maxWidth) {
      if (cur) { lines.push(cur); cur = ""; }
      const chars = Array.from(word);
      let chunk = chars.shift() ?? "";
      while (chars.length && textWidth(chunk + chars[0], fontSize, factor) <= maxWidth) {
        chunk += chars.shift();
      }
      lines.push(chunk);
      word = chars.join("");
    }
    if (!cur) cur = word;
    else if (textWidth(cur + " " + word, fontSize, factor) <= maxWidth) cur += " " + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = Array.from(kept[maxLines - 1]);
    while (last.length && textWidth(last.join("") + "\u2026", fontSize, factor) > maxWidth) last.pop();
    kept[maxLines - 1] = last.join("") + "\u2026";
    return kept;
  }
  return lines;
}

function fitTitle(text: string, width: number, startSize: number, maxLines: number) {
  let size = startSize;
  while (size > 34) {
    if (wrap(text, width, size, 0.56, 99).length <= maxLines) break;
    size -= 4;
  }
  return { size, lines: wrap(text, width, size, 0.56, maxLines) };
}

export function buildGraphicSvg(template: TemplateId, sizeId: SizeId, f: GraphicFields, logoDataUri: string | null): string {
  const { w, h } = SIZES[sizeId];
  const p = PALETTES[template];
  const sq = sizeId === "square";
  const pad = sq ? 84 : 72;
  const textW = w - pad * 2;
  const serif = "Georgia, 'Times New Roman', serif";
  const sans = "'Segoe UI', Helvetica, Arial, sans-serif";
  const logoSize = sq ? 120 : 96;

  const title = f.title.trim() || "Your headline here";
  const t = fitTitle(title, textW, sq ? 92 : 68, sq ? 3 : 2);
  const tLH = t.size * 1.14;
  const titleTop = (sq ? 400 : 270);
  const titleSvg = t.lines.map((l, i) => `<text x="${pad}" y="${titleTop + i * tLH}" font-family="${serif}" font-weight="700" font-size="${t.size}" fill="${p.ink}">${escapeXml(l)}</text>`).join("");

  const dSize = sq ? 34 : 26;
  const dTop = titleTop + (t.lines.length - 1) * tLH + (sq ? 70 : 52);
  const dLines = wrap(f.description.trim(), textW, dSize, 0.5, sq ? 5 : 3);
  const descSvg = dLines.map((l, i) => `<text x="${pad}" y="${dTop + i * dSize * 1.45}" font-family="${sans}" font-size="${dSize}" fill="${p.sub}">${escapeXml(l)}</text>`).join("");

  const bandY = h - (sq ? 170 : 128);
  const detail = f.detail.trim();
  const cta = f.cta.trim();
  const ctaSize = sq ? 30 : 24;
  const ctaW = Math.min(textW * 0.5, cta.length * ctaSize * 0.62 + 64);
  const ctaH = sq ? 70 : 58;
  const ctaSvg = cta
    ? `<rect x="${w - pad - ctaW}" y="${bandY + 30}" width="${ctaW}" height="${ctaH}" rx="${ctaH / 2}" fill="${p.ctaBg}"/><text x="${w - pad - ctaW / 2}" y="${bandY + 30 + ctaH / 2 + ctaSize * 0.34}" text-anchor="middle" font-family="${sans}" font-weight="700" font-size="${ctaSize}" fill="${p.ctaInk}">${escapeXml(wrap(cta, ctaW - 40, ctaSize, 0.6, 1)[0] ?? "")}</text>`
    : "";
  const detailMax = cta ? textW - ctaW - 30 : textW;
  const detailSvg = detail
    ? `<text x="${pad}" y="${bandY + 30 + ctaH / 2 + 10}" font-family="${sans}" font-weight="600" font-size="${sq ? 32 : 26}" fill="${p.ink}">${escapeXml(wrap(detail, detailMax, sq ? 32 : 26, 0.58, 1)[0] ?? "")}</text>`
    : "";

  const logo = logoDataUri
    ? `<clipPath id="lc"><circle cx="${pad + logoSize / 2}" cy="${pad + logoSize / 2 - 10}" r="${logoSize / 2}"/></clipPath><image href="${logoDataUri}" x="${pad}" y="${pad - 10}" width="${logoSize}" height="${logoSize}" clip-path="url(#lc)" preserveAspectRatio="xMidYMid slice"/>`
    : "";
  const nameX = pad + (logoDataUri ? logoSize + 22 : 0);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(title)}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#bg)"/>
<circle cx="${w - 40}" cy="${sq ? 200 : 60}" r="${sq ? 360 : 280}" fill="${p.accent}" fill-opacity="0.10"/>
<circle cx="${w - 40}" cy="${sq ? 200 : 60}" r="${sq ? 250 : 190}" fill="none" stroke="${p.accent}" stroke-opacity="0.35" stroke-width="3"/>
<rect x="0" y="0" width="${w}" height="12" fill="${p.accent}"/>
${logo}
<text x="${nameX}" y="${pad + logoSize / 2 - 22}" font-family="${serif}" font-weight="700" font-size="${sq ? 36 : 30}" fill="${p.ink}">New World Emerald</text>
<text x="${nameX}" y="${pad + logoSize / 2 + 16}" font-family="${sans}" font-size="${sq ? 20 : 17}" letter-spacing="4" fill="${p.sub}">PRIVATE SCHOOL</text>
<text x="${pad}" y="${titleTop - t.size - (sq ? 30 : 22)}" font-family="${sans}" font-weight="700" font-size="${sq ? 24 : 20}" letter-spacing="6" fill="${p.accent}">${p.kicker}</text>
<rect x="${pad}" y="${titleTop - t.size - (sq ? 10 : 6)}" width="72" height="5" fill="${p.accent}"/>
${titleSvg}
${descSvg}
<line x1="${pad}" y1="${bandY}" x2="${w - pad}" y2="${bandY}" stroke="${p.accent}" stroke-opacity="0.5" stroke-width="2"/>
${detailSvg}
${ctaSvg}
</svg>`;
}

export async function fetchLogoDataUri(url: string): Promise<string> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Logo request failed");
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Logo read failed"));
    r.readAsDataURL(blob);
  });
}

export function svgToPngBlob(svg: string, w: number, h: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((b) => (b && b.type === "image/png" ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png");
      } catch (e) { reject(e instanceof Error ? e : new Error("PNG export failed")); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Graphic could not be rendered")); };
    img.src = url;
  });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
