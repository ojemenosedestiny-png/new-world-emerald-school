import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Plugin } from "vite";

type Field = { key: string; group: string; label: string; kind: string; defaultValue: string };
const files = [
  "Layout", "HeroAbout", "DirectorWelcome", "ParentServices", "ProgramsFacilities",
  "LifeGallery", "AdmissionsNews", "LiveUpdates", "AcademicCalendar", "Widgets",
];
const groups: Record<string, string> = {
  Navbar: "Navigation", Footer: "Footer", Hero: "Welcome banner",
  About: "About the school", WhyChooseUs: "Why choose us", DirectorWelcome: "Director's welcome",
  ParentServices: "Parent services", Programs: "Academic programmes", Facilities: "Facilities",
  SchoolLife: "School life", Gallery: "School gallery", Testimonials: "Parent testimonials",
  NewsEvents: "News and events", AdmissionsFAQ: "Admissions and FAQs", FinalCTA: "Admissions invitation",
  LiveUpdates: "Live updates introduction", AcademicCalendar: "Calendar introduction",
  CookieBanner: "Cookie notice", FloatingButtons: "Contact shortcuts",
};
const properties = new Set(["title", "desc", "description", "text", "name", "role", "age", "question", "answer", "time", "val", "value", "quote", "author", "note", "date", "excerpt", "subtitle", "label"]);
const attributes = new Set(["alt", "title", "placeholder", "aria-label", "text"]);
const virtualId = "virtual:school-content-catalog";
const resolvedId = `\0${virtualId}`;

function jsxText(raw: string) {
  const lines = raw.replace(/\t/g, " ").split(/\r\n|\n|\r/);
  let last = 0;
  lines.forEach((line, index) => { if (/\S/.test(line)) last = index; });
  const text = lines.map((line, index) => {
    if (index !== 0) line = line.replace(/^ +/, "");
    if (index !== lines.length - 1) line = line.replace(/ +$/, "");
    return line ? line + (index !== last ? " " : "") : "";
  }).join("");
  return text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, "\u00a0");
}

// This compile-time adapter preserves the original components, real school
// copy, photographs, layout and heading animations. Only public content values
// become editable; IDs, CSS, event handlers and internal app routes do not.
export function schoolContentPlugin(root: string): Plugin {
  const selected = files.map((file) => path.join(root, "src/components", `${file}.tsx`));
  const catalog = new Map<string, Field>();

  function transformSource(code: string, filename: string) {
    const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const baseGroup = path.basename(filename, ".tsx");
    let scope: string | undefined;
    let privateBranch = false;
    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      const f = context.factory;
      function value(kind: string, fallback: string, expression?: ts.Expression, linkLabel?: string) {
        const group = scope ?? baseGroup;
        const hash = createHash("sha256").update(`${group}:${kind}:${fallback}${linkLabel ? `:${linkLabel}` : ""}`).digest("hex").slice(0, 14);
        const key = `${group}.${kind}.${hash}`;
        catalog.set(key, {
          key, group: groups[group] ?? group.replace(/([a-z])([A-Z])/g, "$1 $2"),
          kind, label: linkLabel ? `Link: ${linkLabel}` : kind === "text" ? fallback.trim().slice(0, 90) : fallback,
          defaultValue: fallback,
        });
        return f.createCallExpression(f.createIdentifier("resolveSchoolContent"), undefined, [
          f.createStringLiteral(key), expression ?? f.createStringLiteral(fallback),
        ]);
      }
      function propertyKind(node: ts.PropertyAssignment) {
        const name = node.name.getText(source).replace(/['"]/g, "");
        if (name === "value" && baseGroup !== "HeroAbout") return undefined;
        if (properties.has(name) && ts.isStringLiteral(node.initializer)) return "text";
        if (["href", "url"].includes(name) && ts.isStringLiteral(node.initializer) &&
          /^(https:\/\/|mailto:|tel:)/.test(node.initializer.text)) return "link";
        return undefined;
      }
      const visit: ts.Visitor = (node) => {
        // Never expose the signed-in calendar form as editable public copy.
        if (ts.isJsxExpression(node) && node.expression?.getText(source).includes("officeMode && isAuthenticated")) {
          const before = privateBranch; privateBranch = true;
          const result = ts.visitEachChild(node, visit, context);
          privateBranch = before; return result;
        }
        if (privateBranch) return ts.visitEachChild(node, visit, context);
        if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text) && node.body) {
          const before = scope; scope = node.name.text;
          const result = ts.visitEachChild(node, visit, context) as ts.FunctionDeclaration;
          scope = before;
          return f.updateFunctionDeclaration(result, result.modifiers, result.asteriskToken,
            result.name, result.typeParameters, result.parameters, result.type,
            f.updateBlock(result.body!, [
              f.createExpressionStatement(f.createCallExpression(f.createIdentifier("useSchoolContentRevision"), undefined, [])),
              ...result.body!.statements,
            ]));
        }
        if (ts.isJsxText(node) && /\S/.test(node.text)) {
          const fallback = jsxText(node.text);
          return f.createJsxExpression(undefined, value("text", fallback));
        }
        if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
          const name = node.name.getText(source);
          const fallback = node.initializer.text;
          const parentElement = node.parent.parent.parent;
          if (name === "aria-label" && ts.isJsxElement(parentElement) &&
            /(?:^|\.)h[1-6]$/.test(parentElement.openingElement.tagName.getText(source))) {
            const headlineLines: string[] = [];
            function collectHeadlineLines(child: ts.Node) {
              if (ts.isJsxSelfClosingElement(child) && child.tagName.getText(source) === "AnimatedHeadlineText") {
                const text = child.attributes.properties.find((attribute) =>
                  ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "text");
                if (text && ts.isJsxAttribute(text) && text.initializer && ts.isStringLiteral(text.initializer))
                  headlineLines.push(text.initializer.text);
              }
              ts.forEachChild(child, collectHeadlineLines);
            }
            parentElement.children.forEach(collectHeadlineLines);
            if (headlineLines.length) {
              // The accessible name must use the same saved values as the visible lines.
              return f.updateJsxAttribute(node, node.name, f.createJsxExpression(undefined,
                f.createCallExpression(f.createPropertyAccessExpression(
                  f.createArrayLiteralExpression(headlineLines.map((line) => value("text", line))), "join"),
                  undefined, [f.createStringLiteral(" ")])));
            }
          }
          const kind = attributes.has(name) ? "text"
            : name === "src" ? "image"
            : name === "href" && (/^(https:\/\/|mailto:|tel:)/.test(fallback) || fallback === "#") ? "link" : undefined;
          if (kind) {
            const element = node.parent.parent.parent;
            const label = kind === "link" && fallback === "#" && ts.isJsxElement(element)
              ? element.children.filter(ts.isJsxText).map((child) => jsxText(child.text)).join(" ").trim()
              : undefined;
            return f.updateJsxAttribute(node, node.name, f.createJsxExpression(undefined, value(kind, fallback, undefined, label)));
          }
        }
        if (ts.isPropertyAssignment(node)) {
          const kind = propertyKind(node);
          if (kind && ts.isStringLiteral(node.initializer)) {
            const result = value(kind, node.initializer.text);
            // Getters keep top-level card data live when published content changes.
            if (!scope) return f.createGetAccessorDeclaration(undefined, node.name, [], undefined,
              f.createBlock([f.createReturnStatement(result)], true));
            return f.updatePropertyAssignment(node, node.name, result);
          }
          if (!scope && ts.isCallExpression(node.initializer) &&
            node.initializer.expression.getText(source) === "asset" &&
            node.initializer.arguments[0] && ts.isStringLiteral(node.initializer.arguments[0])) {
            const fallback = node.initializer.arguments[0].text;
            const kind = /\.(mp4|webm)$/i.test(fallback) ? "media" : /\.(pdf|docx?)$/i.test(fallback) ? "file" : "image";
            return f.createGetAccessorDeclaration(undefined, node.name, [], undefined,
              f.createBlock([f.createReturnStatement(value(kind, fallback, node.initializer))], true));
          }
        }
        if (scope && ts.isStringLiteral(node) && ts.isArrayLiteralExpression(node.parent) &&
          ts.isPropertyAssignment(node.parent.parent) && node.parent.parent.name.getText(source) === "focus") {
          return value("text", node.text);
        }
        if (scope && ts.isCallExpression(node) && node.expression.getText(source) === "asset" &&
          node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          const fallback = node.arguments[0].text;
          if (/\.(jpe?g|png|webp|gif|svg|mp4|webm|pdf|docx?)$/i.test(fallback)) {
            const kind = /\.(mp4|webm)$/i.test(fallback) ? "media" : /\.(pdf|docx?)$/i.test(fallback) ? "file" : "image";
            return value(kind, fallback, node);
          }
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    };
    const result = ts.transform(source, [transformer]);
    const output = ts.createPrinter().printFile(result.transformed[0]);
    result.dispose();
    return `import { resolveSchoolContent, useSchoolContentRevision } from "@/lib/siteContent";\n${output}`;
  }

  function collect() {
    catalog.clear();
    selected.forEach((filename) => transformSource(readFileSync(filename, "utf8"), filename));
    Object.entries(groups).filter(([name]) => !["Navbar", "Footer", "CookieBanner", "FloatingButtons"].includes(name))
      .forEach(([name, group]) => catalog.set(`visibility.${name}`, {
        key: `visibility.${name}`, group, kind: "toggle", label: "Show this section on the homepage", defaultValue: "true",
      }));
  }

  return {
    name: "school-website-content",
    enforce: "pre",
    resolveId(id) { if (id === virtualId) return resolvedId; },
    load(id) {
      if (id !== resolvedId) return;
      collect();
      return `export const schoolContentFields = ${JSON.stringify([...catalog.values()])};`;
    },
    transform(code, id) {
      const filename = id.split("?")[0];
      if (selected.includes(filename)) return { code: transformSource(code, filename), map: null };
    },
    handleHotUpdate(ctx) {
      if (!selected.includes(ctx.file)) return;
      const module = ctx.server.moduleGraph.getModuleById(resolvedId);
      if (module) ctx.server.moduleGraph.invalidateModule(module);
    },
  };
}