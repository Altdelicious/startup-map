// Logo checks: SVG or PNG, at most 100 KB, square, and SVGs free of scripts and external references.
import { readFileSync, statSync } from "node:fs";

export const MAX_LOGO_BYTES = 100 * 1024;

export function checkLogo(abs: string): string[] {
  const errors: string[] = [];
  let size: number;
  try {
    size = statSync(abs).size;
  } catch {
    return ["logo file does not exist"];
  }
  if (size > MAX_LOGO_BYTES) errors.push(`logo is ${Math.round(size / 1024)} KB; the limit is 100 KB`);
  const buf = readFileSync(abs);

  let dims: { w: number; h: number } | null = null;
  if (abs.endsWith(".png")) {
    const sig = buf.subarray(0, 8).toString("hex");
    if (sig !== "89504e470d0a1a0a" || buf.subarray(12, 16).toString("latin1") !== "IHDR") {
      return [...errors, "logo has a .png extension but is not a PNG file"];
    }
    dims = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } else if (abs.endsWith(".svg")) {
    const text = buf.toString("utf8");
    errors.push(...svgSafetyProblems(text));
    dims = svgSize(text);
    if (!dims) errors.push("SVG logo needs a viewBox or numeric width and height");
  } else {
    errors.push("logo must be .svg or .png");
  }

  if (dims && Math.abs(dims.w - dims.h) > 0.01 * Math.max(dims.w, dims.h)) {
    errors.push(`logo must be square (it is ${dims.w} × ${dims.h})`);
  }
  return errors;
}

export function svgSafetyProblems(svg: string): string[] {
  const problems: string[] = [];
  const rules: [RegExp, string][] = [
    [/<script\b/i, "contains a <script> element"],
    [/<foreignObject\b/i, "contains a <foreignObject> element"],
    [/<!(DOCTYPE|ENTITY)\b/i, "contains a DOCTYPE or ENTITY declaration"],
    [/\son[a-z]+\s*=/i, "contains an event handler attribute (on...=)"],
    [/javascript:/i, "contains a javascript: URL"],
    [/(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(?:png|jpeg|gif|webp);base64,)/i, "links to an external resource (only #fragment or inline image data is allowed)"],
    [/url\(\s*["']?\s*(?!#|data:image\/)/i, "uses url() to load an external resource"],
    [/@import\b/i, "uses @import"],
    [/<(iframe|embed|object|audio|video)\b/i, "embeds other content"],
  ];
  for (const [re, msg] of rules) if (re.test(svg)) problems.push(`SVG logo ${msg}`);
  return problems;
}

function svgSize(svg: string): { w: number; h: number } | null {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!root) return null;
  const vb = root.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i);
  if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
  const w = root.match(/\bwidth\s*=\s*["']([\d.]+)(px)?["']/i);
  const h = root.match(/\bheight\s*=\s*["']([\d.]+)(px)?["']/i);
  return w && h ? { w: Number(w[1]), h: Number(h[1]) } : null;
}
