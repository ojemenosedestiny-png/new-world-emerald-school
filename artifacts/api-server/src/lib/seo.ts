/**
 * What search engines are told about each address on the site: its title, description, canonical
 * address and whether it may be indexed, plus the school's identity as Schema.org data on the homepage.
 * Every fact here was confirmed by the school (2026-10-30); add nothing unverified (no ratings,
 * accreditation or affiliations, and social profiles only once the school supplies the links).
 */

export const DEFAULT_SITE_URL = "https://newworldemeraldprivateschool.com";

export const SCHOOL = {
  name: "New World Emerald Private School",
  email: "info@newworldemeraldprivateschool.com",
  telephone: "+2348136037074",
  address: {
    streetAddress: "Emerald Building, New World Crescent, Oyigene Audu Avenue, F01",
    addressLocality: "Kubwa",
    addressRegion: "Federal Capital Territory",
    addressCountry: "NG",
  },
  /** Official social profile links (Facebook, Instagram, ...). Empty until the school confirms them. */
  sameAs: [] as string[],
};

/** The site's one address for search engines: PUBLIC_SITE_URL when valid, otherwise the school's domain. */
export function siteOrigin(configured = process.env.PUBLIC_SITE_URL) {
  try {
    return new URL(configured || DEFAULT_SITE_URL).origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export type PageSeo =
  | { kind: "public"; path: string; title: string; description: string }
  | { kind: "private" }
  | { kind: "missing" };

/** The public pages, which are the only ones in the sitemap. */
export const PUBLIC_PAGES: { path: string; title: string; description: string }[] = [
  {
    path: "/",
    title: "New World Emerald Private School | Kubwa, Abuja",
    description: "Discover New World Emerald Private School in Kubwa, Abuja. Explore our educational environment, admissions, learning programmes, school activities and student opportunities.",
  },
  {
    path: "/commerce",
    title: "Uniforms & School Payments | New World Emerald Private School",
    description: "Order uniforms and school items, see class fee schedules and tell the school office about a fee transfer at New World Emerald Private School, Kubwa, Abuja.",
  },
];

// Signed-in areas and sign-in screens: served to people, never indexed.
const PRIVATE_ROUTES = [
  /^\/sign-in(\/|$)/, /^\/sign-up(\/|$)/, /^\/account$/, /^\/admin$/, /^\/director$/, /^\/teacher$/,
  /^\/portal$/, /^\/portal\/manage$/, /^\/portal\/activate$/, /^\/portal\/exam\/[^/]+$/,
];

/** How an address of the website app is presented to search engines. */
export function pageSeo(rawPath: string): PageSeo {
  const path = rawPath.replace(/\/+$/, "") || "/";
  const page = PUBLIC_PAGES.find((p) => p.path === path);
  if (page) return { kind: "public", ...page };
  if (PRIVATE_ROUTES.some((r) => r.test(path))) return { kind: "private" };
  return { kind: "missing" };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The school and the website as one Schema.org graph, with stable ids so other pages can refer to them. */
export function schoolStructuredData(origin = siteOrigin()) {
  const school = `${origin}/#school`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "School",
        "@id": school,
        name: SCHOOL.name,
        url: `${origin}/`,
        logo: { "@type": "ImageObject", url: `${origin}/logo.jpg` },
        image: `${origin}/campus-building-background.webp`,
        email: SCHOOL.email,
        telephone: SCHOOL.telephone,
        address: { "@type": "PostalAddress", ...SCHOOL.address },
        ...(SCHOOL.sameAs.length ? { sameAs: SCHOOL.sameAs } : {}),
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: SCHOOL.name,
        url: `${origin}/`,
        inLanguage: "en-NG",
        publisher: { "@id": school },
      },
    ],
  };
}

/**
 * Rewrites the app shell's head for one address: title, description, robots, canonical and social
 * tags, and the structured data on the homepage. JSON-LD is a data block, so the security policy is unaffected.
 */
export function withPageSeo(html: string, seo: PageSeo, origin = siteOrigin()) {
  if (seo.kind !== "public") {
    return html.replace(/<meta name="robots" content="[^"]*"\s*\/?>/, '<meta name="robots" content="noindex, nofollow" />');
  }
  const url = `${origin}${seo.path === "/" ? "/" : seo.path}`;
  const image = `${origin}/campus-building-background.webp`;
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(seo.title)}</title>`)
    .replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*(")/g, `$1${esc(seo.description)}$2`)
    .replace(/(<meta (?:property|name)="(?:og:title|twitter:title)" content=")[^"]*(")/g, `$1${esc(seo.title)}$2`);
  const tags = [
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:alt" content="The ${esc(SCHOOL.name)} building" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ];
  if (seo.path === "/") {
    const json = JSON.stringify(schoolStructuredData(origin)).replace(/</g, "\\u003c");
    tags.push(`<script type="application/ld+json">${json}</script>`);
  }
  out = out.includes("</head>") ? out.replace("</head>", `${tags.join("")}</head>`) : out;
  return out;
}

export function robotsTxt(origin = siteOrigin()) {
  return [
    "# New World Emerald Private School",
    "# Signed-in areas send a noindex header and need a login; they are not hidden by this file.",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml(origin = siteOrigin()) {
  const urls = PUBLIC_PAGES.map((p) => `  <url><loc>${esc(origin + p.path)}</loc><changefreq>weekly</changefreq><priority>${p.path === "/" ? "1.0" : "0.6"}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
