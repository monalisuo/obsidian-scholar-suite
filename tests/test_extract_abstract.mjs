import { readFileSync } from "fs";

// Test extracting abstract from a vault file
const p = "F:\\Vaults\\服务业地理\\文献\\服务业地理\\郭倩钰 等 - 2025 - 北京市制造业与生产性服务业协同集聚的测度方法与时空演变\\郭倩钰 等 - 2025 - 北京市制造业与生产性服务业协同集聚的测度方法与时空演变.md";
const text = readFileSync(p, "utf-8");

function extractLocalAbstract(content) {
  // 1. Check Frontmatter
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const yaml = fmMatch[1];
    const absFm = yaml.match(/^abstract:\s*(.*)$/m);
    if (absFm && absFm[1].trim()) return absFm[1].trim();
  }

  // 2. Check ## 摘要 or 摘要：
  const absRegex = /(?:^#{1,4}\s*|[*_]{0,2})摘要[*_]{0,2}[:：]?\s*([\s\S]*?)(?=\n#{1,4}\s|\n\n\*\*|\n---)/i;
  const m = absRegex.exec(content);
  if (m) {
    const clean = m[1].replace(/<[^>]+>/g, "").trim();
    if (clean.length > 20) return clean.substring(0, 500);
  }

  // 3. Check Abstract (English)
  const enAbsRegex = /(?:^#{1,4}\s*|[*_]{0,2})Abstract[*_]{0,2}[:：]?\s*([\s\S]*?)(?=\n#{1,4}\s|\n\n\*\*|\n---)/i;
  const mEn = enAbsRegex.exec(content);
  if (mEn) {
    const clean = mEn[1].replace(/<[^>]+>/g, "").trim();
    if (clean.length > 20) return clean.substring(0, 500);
  }

  return null;
}

const abs = extractLocalAbstract(text);
console.log("Extracted Abstract from Guo 2025:");
console.log(abs ? abs.substring(0, 200) + "..." : "NONE");
