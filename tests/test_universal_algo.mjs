import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function getFiles(dir, files = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      getFiles(p, files);
    } else if (f.endsWith(".md")) {
      files.push(p);
    }
  }
  return files;
}

const allMd = getFiles("F:\\Vaults\\服务业地理\\文献");

const headRegex =
  /^(?:#{1,6}\s*)?[【\[〖〔（\(\]]?\s*(?:参考文献|References|REFERENCES)(?:\s*[\(（][A-Za-z\s]+[\)）])?\s*[】\]〗〕）\)]?/im;

const numRegex = /^\s*(?:[-*+]\s+)?(?:[（\[【〖〔]\s*)?(\d{1,3})\s*[）\]】〗〕\.\s]\s*(.*)$/;

function parseReferencesFromContent(content) {
  let heads = headRegex.exec(content);
  let cut = -1;
  if (heads) {
    cut = heads.index;
  } else {
    const unheaded = /\n\s*(?:[（\[【〖〔]\s*1\s*[）\]】〗〕]|1\s*[\.、])\s+[A-Za-z\u4e00-\u9fa5]/.exec(content);
    if (unheaded && unheaded.index > content.length * 0.4) {
      cut = unheaded.index;
    }
  }

  if (cut === -1) return [];

  const tail = content.substring(cut);
  const lines = tail.split("\n");

  // Strategy 1: Check if there are numbered lines
  const numberedItems = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const m = numRegex.exec(l);
    if (m) {
      numberedItems.push({
        num: parseInt(m[1], 10),
        raw: m[2].replace(/\^ref\d+\b/, "").trim(),
      });
    }
  }

  if (numberedItems.length >= 3) {
    return numberedItems.map((it, idx) => ({
      index: it.num,
      raw: it.raw,
      type: "numbered"
    }));
  }

  // Strategy 2: Paragraph separation (Author-Year style)
  const paras = tail.split(/\n\s*\n/).slice(1).map(p => p.trim()).filter(p => p.length > 20 && !p.startsWith("#"));
  if (paras.length >= 2) {
    return paras.map((p, idx) => ({
      index: idx + 1,
      raw: p.replace(/\^ref\d+\b/, "").replace(/\n/g, " ").trim(),
      type: "author-year"
    }));
  }

  return [];
}

let success = 0;
let fail = 0;
for (const p of allMd) {
  const c = readFileSync(p, "utf-8");
  const refs = parseReferencesFromContent(c);
  if (refs.length > 0) {
    success++;
  } else {
    fail++;
  }
}

console.log(`Universal Parser Result:`);
console.log(`  Success: ${success}/${allMd.length} papers parsed!`);
console.log(`  Fail: ${fail}/${allMd.length}`);
