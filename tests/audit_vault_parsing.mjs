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
console.log("Total literature MD files:", allMd.length);

const headRegex =
  /^(?:#{1,6}\s*)?[【\[〖〔（\(\]]?\s*(?:参考文献|References|REFERENCES)(?:\s*[\(（][A-Za-z\s]+[\)）])?\s*[】\]〗〕）\)]?/im;

let hasHead = 0;
let hasRefs = 0;
let totalRefsParsed = 0;

for (const p of allMd) {
  const content = readFileSync(p, "utf-8");
  const m = headRegex.exec(content);
  if (m) {
    hasHead++;
    const tail = content.substring(m.index);
    const refRegex = /^\s*(?:[-*+]\s+)?(?:[（\[【〖〔]\s*)?(\d{1,3})\s*[）\]】〗〕\.\s]\s*(.*)$/gm;
    const matches = [...tail.matchAll(refRegex)];
    if (matches.length > 0) {
      hasRefs++;
      totalRefsParsed += matches.length;
    }
  }
}

console.log(`Files with reference heading: ${hasHead}/${allMd.length}`);
console.log(`Files with parsed reference entries: ${hasRefs}/${allMd.length} (total entries: ${totalRefsParsed})`);
