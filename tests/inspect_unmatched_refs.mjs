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
const refRegex = /^\s*(?:[-*+]\s+)?(?:[（\[【〖〔]\s*)?(\d{1,3})\s*[）\]】〗〕\.\s]\s*(.*)$/gm;

console.log("Sample files with reference heading but 0 entries parsed:");
let count = 0;
for (const p of allMd) {
  const content = readFileSync(p, "utf-8");
  const m = headRegex.exec(content);
  if (m) {
    const tail = content.substring(m.index);
    const matches = [...tail.matchAll(refRegex)];
    if (matches.length === 0) {
      count++;
      const fname = p.split("\\").pop();
      console.log(`\n[${count}] ${fname}`);
      console.log("First 300 chars of tail:");
      console.log(tail.substring(0, 300));
      if (count >= 5) break;
    }
  }
}
