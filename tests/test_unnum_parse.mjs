import { readFileSync } from "fs";

const p = "F:\\Vaults\\服务业地理\\文献\\产业集聚\\References_LeapSpace\\Cai - 2022 - 中国285个城市的产业集聚与工业SO2排放：来自多种集聚类型的证据\\Cai - 2022 - 中国285个城市的产业集聚与工业SO2排放：来自多种集聚类型的证据.md";
const content = readFileSync(p, "utf-8");

const headRegex =
  /^(?:#{1,6}\s*)?[【\[〖〔（\(\]]?\s*(?:参考文献|References|REFERENCES)(?:\s*[\(（][A-Za-z\s]+[\)）])?\s*[】\]〗〕）\)]?/im;

const m = headRegex.exec(content);
const tail = content.substring(m.index);

// Split tail by paragraphs (double newlines or lines starting with author)
const paragraphs = tail.split(/\n\s*\n/).slice(1).map(p => p.trim()).filter(p => p.length > 15 && !p.startsWith("#"));
console.log("Total references parsed in Cai 2022:", paragraphs.length);
for (let i = 0; i < Math.min(5, paragraphs.length); i++) {
  console.log(`\nRef ${i+1}:`, paragraphs[i].replace(/\n/g, " ").substring(0, 100));
}
