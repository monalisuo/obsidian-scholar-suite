import { requestUrl } from "obsidian";
import { ReferenceItem, CitationItem, ScholarlyPaper } from "../types";

export interface SaveToZoteroResult {
  success: boolean;
  message?: string;
  hasPdf?: boolean;
  pdfSizeKb?: number;
  pdfSource?: string;
}

function nodeRequest(options: {
  hostname?: string;
  port: number;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
}): Promise<{ status: number; body: string; json?: any }> {
  return new Promise((resolve, reject) => {
    try {
      let httpModule: any = null;
      if (typeof require !== "undefined") {
        try {
          httpModule = require("http");
        } catch {}
      }

      if (!httpModule) {
        return reject(new Error("Node HTTP unavailable"));
      }

      const req = httpModule.request(
        {
          hostname: options.hostname || "127.0.0.1",
          port: options.port,
          path: options.path,
          method: options.method,
          headers: options.headers || {},
          timeout: options.timeoutMs || 2500,
        },
        (res: any) => {
          let data = "";
          res.on("data", (chunk: any) => (data += chunk));
          res.on("end", () => {
            let json: any = undefined;
            try {
              json = JSON.parse(data);
            } catch {}
            resolve({ status: res.statusCode, body: data, json });
          });
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Timeout"));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

export class ZoteroLocalClient {
  private port: number;
  private checkedCache: Map<string, { inZotero: boolean; zoteroKey?: string }> = new Map();
  private cnkiBridge?: any;

  constructor(port: number = 23119) {
    this.port = port;
  }

  public setPort(port: number) {
    this.port = port;
  }

  public setCnkiBridge(bridge: any) {
    this.cnkiBridge = bridge;
  }

  /**
   * Check if Zotero desktop is running.
   * Priority: Direct Node.js TCP loopback (100% immune to CORS and proxy) -> Fallback to requestUrl
   */
  public async isZoteroRunning(): Promise<boolean> {
    // 1. Native Node.js HTTP loopback (Direct TCP socket, completely bypasses Chromium CORS & proxies)
    try {
      const res = await nodeRequest({
        port: this.port,
        path: "/connector/ping",
        method: "GET",
        timeoutMs: 1500,
      });
      if (res.status === 200) return true;
    } catch {}

    // 2. Try Node items endpoint
    try {
      const res = await nodeRequest({
        port: this.port,
        path: "/api/users/0/items?limit=1",
        method: "GET",
        timeoutMs: 1500,
      });
      if (res.status === 200) return true;
    } catch {}

    // 3. Fallback: Obsidian requestUrl
    try {
      const res = await requestUrl({
        url: `http://127.0.0.1:${this.port}/connector/ping`,
        method: "GET",
      });
      if (res.status === 200) return true;
    } catch {}

    return false;
  }

  private cleanTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")
      .trim();
  }

  private extractKeywords(text: string): string[] {
    const STOP = new Set([
      "the", "and", "for", "that", "this", "with", "from", "are", "was",
      "were", "into", "their", "about", "study", "analysis", "case", "based"
    ]);
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w));
  }

  /**
   * High-accuracy fuzzy matcher for Zotero items:
   * 1. Normalized exact / substring match
   * 2. Main title before colon / dash
   * 3. Chinese Longest Common Substring & Character Overlap (>= 75%)
   * 4. English Token Jaccard / Overlap (>= 65%)
   * 5. Author + Year cross verification
   */
  public isFuzzyMatch(
    targetTitle: string,
    itemTitle: string,
    targetYear?: string,
    itemYear?: string,
    targetAuthors?: string[],
    itemCreators?: any[]
  ): boolean {
    if (!targetTitle || !itemTitle) return false;

    const norm1 = this.cleanTitle(targetTitle);
    const norm2 = this.cleanTitle(itemTitle);
    if (!norm1 || !norm2) return false;

    // 1. Direct equality or substring containment
    if (norm1 === norm2) return true;
    if (norm1.length >= 8 && norm2.length >= 8) {
      if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
    }

    // 2. Main title before colon/dash
    const main1 = this.cleanTitle(targetTitle.split(/[:：—–-]/)[0]);
    const main2 = this.cleanTitle(itemTitle.split(/[:：—–-]/)[0]);
    if (main1.length >= 8 && main2.length >= 8) {
      if (main1 === main2 || main1.includes(main2) || main2.includes(main1)) return true;
    }

    // 3. Chinese Character Overlap & Subsequence
    const isChinese = /[\u4e00-\u9fa5]/.test(norm1) || /[\u4e00-\u9fa5]/.test(norm2);
    if (isChinese) {
      const set1 = new Set(norm1.split(""));
      let common = 0;
      for (const ch of norm2) {
        if (set1.has(ch)) common++;
      }
      const overlapRatio = (common * 2) / (norm1.length + norm2.length);
      if (common >= 6 && overlapRatio >= 0.72) {
        return true;
      }
    } else {
      // 4. English Token Jaccard Overlap
      const kw1 = this.extractKeywords(targetTitle);
      const kw2 = this.extractKeywords(itemTitle);
      if (kw1.length >= 3 && kw2.length >= 3) {
        const set1 = new Set(kw1);
        let shared = 0;
        for (const w of kw2) {
          if (set1.has(w)) shared++;
        }
        const jaccard = (shared * 2) / (kw1.length + kw2.length);
        if (shared >= 3 && jaccard >= 0.65) {
          return true;
        }
      }
    }

    // 5. Author + Year cross verification
    if (targetYear && itemYear && targetAuthors && targetAuthors.length > 0 && Array.isArray(itemCreators)) {
      const cleanY1 = targetYear.replace(/\D/g, "");
      const cleanY2 = itemYear.replace(/\D/g, "");
      if (cleanY1 && cleanY1 === cleanY2) {
        const firstTargetAuth = targetAuthors[0].toLowerCase().split(/\s+/).pop()?.replace(/[^a-z\u4e00-\u9fa5]/g, "");
        if (firstTargetAuth && firstTargetAuth.length >= 2) {
          const authMatched = itemCreators.some((c) => {
            const last = (c.lastName || c.name || "").toLowerCase();
            return last.includes(firstTargetAuth);
          });
          if (authMatched) {
            // If year and author match, only need 2 shared keywords
            const kw1 = this.extractKeywords(targetTitle);
            const kw2 = this.extractKeywords(itemTitle);
            const shared = kw1.filter((w) => kw2.includes(w)).length;
            if (shared >= 2) return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Fast check if a paper exists in local Zotero library (Zero Auth / Local Read API)
   * Supports robust multi-dimensional fuzzy matching (DOI, Chinese overlap, English Token Jaccard, Subtitle split)
   */
  public async checkItemInZotero(paper: {
    doi?: string;
    title?: string;
    zhTitle?: string;
    authors?: string[];
    year?: string | number;
  }): Promise<{ inZotero: boolean; zoteroKey?: string }> {
    const cleanDoi = paper.doi ? paper.doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "") : "";
    const rawTitle = paper.zhTitle || paper.title || "";
    const cacheKey = cleanDoi || this.cleanTitle(rawTitle);

    if (!cacheKey || cacheKey.length < 3) {
      return { inZotero: false };
    }

    if (this.checkedCache.has(cacheKey)) {
      return this.checkedCache.get(cacheKey)!;
    }

    try {
      let items: any[] = [];

      // 1. If DOI exists, search by DOI first with qmode=everything
      if (cleanDoi) {
        const qDoi = encodeURIComponent(cleanDoi);
        const path = `/api/users/0/items?q=${qDoi}&qmode=everything&limit=5`;
        try {
          const res = await nodeRequest({
            port: this.port,
            path,
            method: "GET",
            timeoutMs: 1500,
          });
          if (res.status === 200 && Array.isArray(res.json)) {
            items = res.json;
          }
        } catch {}
      }

      // 2. If no items found by DOI, search by title keyword
      if (items.length === 0 && rawTitle && rawTitle.trim().length >= 4) {
        // Extract 2-3 prominent title words or first 25 chars for search
        const qWords = rawTitle
          .replace(/[\[\]【】\(\)（）"':：_—–-]/g, " ")
          .trim()
          .split(/\s+/)
          .filter((w) => w.length >= 3)
          .slice(0, 3)
          .join(" ");

        const queryTerm = qWords.length >= 3 ? qWords : rawTitle.substring(0, 25);
        const q = encodeURIComponent(queryTerm);
        const path = `/api/users/0/items?q=${q}&qmode=everything&limit=8`;

        try {
          const res = await nodeRequest({
            port: this.port,
            path,
            method: "GET",
            timeoutMs: 1800,
          });
          if (res.status === 200 && Array.isArray(res.json)) {
            items = res.json;
          }
        } catch {}
      }

      // 3. Multi-dimensional fuzzy matching against returned items
      const targetYearStr = paper.year ? String(paper.year) : undefined;
      for (const it of items) {
        const data = it.data || {};
        const itDoi = (data.DOI || "").trim().toLowerCase();
        const itTitle = data.title || "";
        const itYear = (data.date || "").trim();
        const itCreators = data.creators || [];

        // Match condition 1: DOI matches
        if (cleanDoi && itDoi && (itDoi === cleanDoi || itDoi.includes(cleanDoi) || cleanDoi.includes(itDoi))) {
          const result = { inZotero: true, zoteroKey: it.key || data.key };
          this.checkedCache.set(cacheKey, result);
          return result;
        }

        // Match condition 2: Fuzzy title match (Chinese overlap / English Jaccard / Subtitle)
        if (
          this.isFuzzyMatch(rawTitle, itTitle, targetYearStr, itYear, paper.authors, itCreators) ||
          (paper.title && this.isFuzzyMatch(paper.title, itTitle, targetYearStr, itYear, paper.authors, itCreators)) ||
          (paper.zhTitle && this.isFuzzyMatch(paper.zhTitle, itTitle, targetYearStr, itYear, paper.authors, itCreators))
        ) {
          const result = { inZotero: true, zoteroKey: it.key || data.key };
          this.checkedCache.set(cacheKey, result);
          return result;
        }
      }
    } catch (e) {
      // Zotero offline
    }

    const notFound = { inZotero: false };
    this.checkedCache.set(cacheKey, notFound);
    return notFound;
  }

  /**
   * Download a PDF from an external URL, validating magic bytes (%PDF) and size (>20KB)
   */
  public async downloadPdfBuffer(targetUrl: string, maxRedirects: number = 5): Promise<Buffer | null> {
    if (!targetUrl || maxRedirects <= 0) return null;

    // 1. Try Obsidian native requestUrl (auto redirect, proxies, CORS-safe)
    try {
      const res = await requestUrl({
        url: targetUrl,
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/pdf,application/octet-stream,*/*",
        },
      });

      if (res.status === 200 && res.arrayBuffer) {
        const buf = Buffer.from(res.arrayBuffer);
        if (buf.length > 20000 && buf.subarray(0, 4).toString() === "%PDF") {
          return buf;
        }
      }
    } catch {}

    // 2. Fallback to Node.js http/https
    try {
      let httpModule: any = null;
      let httpsModule: any = null;
      let urlModule: any = null;
      if (typeof require !== "undefined") {
        try {
          httpModule = require("http");
          httpsModule = require("https");
          urlModule = require("url");
        } catch {}
      }

      if (httpModule && httpsModule && urlModule) {
        const parsed = new urlModule.URL(targetUrl);
        const client = parsed.protocol === "https:" ? httpsModule : httpModule;

        const buf: Buffer = await new Promise((resolve, reject) => {
          const req = client.get(
            targetUrl,
            {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "application/pdf,application/octet-stream,*/*",
              },
              timeout: 25000,
            },
            (res: any) => {
              if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const nextUrl = new urlModule.URL(res.headers.location, targetUrl).toString();
                return this.downloadPdfBuffer(nextUrl, maxRedirects - 1)
                  .then(resolve)
                  .catch(reject);
              }

              if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
              }

              const chunks: any[] = [];
              res.on("data", (chunk: any) => chunks.push(chunk));
              res.on("end", () => resolve(Buffer.concat(chunks)));
            }
          );
          req.on("error", reject);
          req.on("timeout", () => {
            req.destroy();
            reject(new Error("Timeout"));
          });
        });

        if (buf && buf.length > 20000 && buf.subarray(0, 4).toString() === "%PDF") {
          return buf;
        }
      }
    } catch {}

    return null;
  }

  /**
   * Search local Obsidian vault files or staging directories for existing full-text PDF
   */
  public async findLocalPdf(title: string): Promise<{ buffer: Buffer; url: string; source: string } | null> {
    try {
      const cleanT = this.cleanTitle(title);
      if (cleanT.length < 4) return null;

      // 1. Check in Obsidian Vault
      const app = (window as any).app;
      if (app && app.vault) {
        const files = app.vault.getFiles();
        for (const file of files) {
          if (file.extension === "pdf") {
            const fTitle = this.cleanTitle(file.basename);
            if (fTitle.includes(cleanT) || cleanT.includes(fTitle)) {
              const arrayBuf = await app.vault.readBinary(file);
              const buf = Buffer.from(arrayBuf);
              if (buf.length > 20000 && buf.subarray(0, 4).toString() === "%PDF") {
                return {
                  buffer: buf,
                  url: `file:///${file.path}`,
                  source: `Vault 本地文件 (${file.basename})`,
                };
              }
            }
          }
        }
      }

      // 2. Check local staging directory if Node fs available
      if (typeof require !== "undefined") {
        const fs = require("fs");
        const path = require("path");
        const adapter = app?.vault?.adapter;
        const basePath = adapter?.basePath || "";
        if (basePath) {
          const stagingDir = path.join(basePath, "01_数据", "cnki", "pdf_staging");
          if (fs.existsSync(stagingDir)) {
            const files = fs.readdirSync(stagingDir);
            for (const f of files) {
              if (f.toLowerCase().endsWith(".pdf")) {
                const fTitle = this.cleanTitle(f);
                if (fTitle.includes(cleanT) || cleanT.includes(fTitle)) {
                  const fullPath = path.join(stagingDir, f);
                  const buf = fs.readFileSync(fullPath);
                  if (buf.length > 20000 && buf.subarray(0, 4).toString() === "%PDF") {
                    return {
                      buffer: buf,
                      url: `file:///${fullPath}`,
                      source: `CNKI 本地缓存 (${f})`,
                    };
                  }
                }
              }
            }
          }
        }
      }
    } catch {}
    return null;
  }

  /**
   * Multi-lane sniffer for full-text PDF:
   * Lane 1: OpenAlex (250M+ OA papers, zero token required)
   * Lane 2: Semantic Scholar openAccessPdf
   * Lane 3: Unpaywall
   * Lane 4: Local Vault / Staging
   */
  public async sniffPdf(
    doi?: string,
    title?: string
  ): Promise<{ buffer: Buffer; url: string; source: string } | null> {
    const cleanDoi = doi ? doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "") : "";

    // 1. Try DOI based Open Access endpoints
    if (cleanDoi) {
      // 1.1 OpenAlex
      try {
        const alexUrl = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(cleanDoi)}`;
        const alexRes = await requestUrl({ url: alexUrl, method: "GET" });
        if (alexRes.status === 200 && alexRes.json) {
          const pdfUrl =
            alexRes.json.best_oa_location?.pdf_url ||
            alexRes.json.primary_location?.pdf_url;
          if (pdfUrl && typeof pdfUrl === "string") {
            const buf = await this.downloadPdfBuffer(pdfUrl);
            if (buf) return { buffer: buf, url: pdfUrl, source: "OpenAlex OA" };
          }
        }
      } catch {}

      // 1.2 Semantic Scholar
      try {
        const s2Url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(cleanDoi)}?fields=openAccessPdf`;
        const s2Res = await requestUrl({ url: s2Url, method: "GET" });
        if (s2Res.status === 200 && s2Res.json?.openAccessPdf?.url) {
          const pdfUrl = s2Res.json.openAccessPdf.url;
          if (typeof pdfUrl === "string") {
            const buf = await this.downloadPdfBuffer(pdfUrl);
            if (buf) return { buffer: buf, url: pdfUrl, source: "Semantic Scholar OA" };
          }
        }
      } catch {}

      // 1.3 Unpaywall
      try {
        const unpUrl = `https://api.unpaywall.org/v2/${encodeURIComponent(cleanDoi)}?email=researcher@university.edu`;
        const unpRes = await requestUrl({ url: unpUrl, method: "GET" });
        if (unpRes.status === 200 && unpRes.json?.best_oa_location?.url_for_pdf) {
          const pdfUrl = unpRes.json.best_oa_location.url_for_pdf;
          if (typeof pdfUrl === "string") {
            const buf = await this.downloadPdfBuffer(pdfUrl);
            if (buf) return { buffer: buf, url: pdfUrl, source: "Unpaywall OA" };
          }
        }
      } catch {}
    }

    // 2. Check local Obsidian vault / staging
    if (title && title.length > 4) {
      const local = await this.findLocalPdf(title);
      if (local) return local;
    }

    // 3. For Chinese papers: Call CNKI Bridge to download via resident Chrome CDP 9222
    if (title && /[\u4e00-\u9fa5]/.test(title) && this.cnkiBridge) {
      try {
        const cnkiRes = await this.cnkiBridge.downloadCnkiPdf(title);
        if (cnkiRes && cnkiRes.success && cnkiRes.file_path) {
          if (typeof require !== "undefined") {
            const fs = require("fs");
            if (fs.existsSync(cnkiRes.file_path)) {
              const buf = fs.readFileSync(cnkiRes.file_path);
              if (buf && buf.length > 20000 && buf.subarray(0, 4).toString() === "%PDF") {
                return {
                  buffer: buf,
                  url: `file:///${cnkiRes.file_path}`,
                  source: "知网 (CNKI) 全文直下",
                };
              }
            }
          }
        }
      } catch (e) {
        console.warn("CNKI bridge download error:", e);
      }
    }

    return null;
  }

  /**
   * One-click save paper to Zotero desktop with full-text PDF attachment via Connector (Zero Auth / No Key Needed)
   */
  public async saveItemToZotero(
    item: ReferenceItem | CitationItem | ScholarlyPaper
  ): Promise<SaveToZoteroResult> {
    const rawTitle = (item as any).zhTitle || item.title || "Untitled Paper";
    const title = rawTitle.replace(/\s*\([^)]*\)$/, "").trim();
    const cleanDoi = item.doi ? item.doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "") : "";
    const tid = item.id || `item_${Date.now()}`;
    const sid = `obsidian-scholar-${Date.now()}`;
    const targetUrl = cleanDoi ? `https://doi.org/${cleanDoi}` : ((item as any).url || "https://scholar.google.com");

    const zoteroItem: any = {
      id: tid,
      itemType: "journalArticle",
      title,
      creators: (item.authors || []).map((name) => {
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) {
          return { firstName: "", lastName: parts[0], creatorType: "author" };
        }
        return {
          firstName: parts.slice(0, -1).join(" "),
          lastName: parts[parts.length - 1],
          creatorType: "author",
        };
      }),
      publicationTitle: item.journal || "",
      date: String(item.year || ""),
      DOI: cleanDoi,
      abstractNote: item.abstract || "",
      url: targetUrl,
      tags: [{ tag: "ScholarSuite" }],
      notes: [],
    };

    const payload = JSON.stringify({
      items: [zoteroItem],
      uri: targetUrl,
      sessionID: sid,
    });

    // Step 1: Sniff for full-text PDF in background/parallel
    let pdfData: { buffer: Buffer; url: string; source: string } | null = null;
    try {
      pdfData = await this.sniffPdf(cleanDoi, rawTitle);
    } catch (e) {
      console.warn("PDF sniff error:", e);
    }

    // Step 2: Save paper metadata via /connector/saveItems
    let itemSaved = false;

    // 2.1 Direct Node HTTP (100% reliable)
    try {
      const res = await nodeRequest({
        port: this.port,
        path: "/connector/saveItems",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(payload)),
          "X-Zotero-Connector-API-Version": "3",
        },
        body: payload,
        timeoutMs: 4000,
      });

      if (res.status === 200 || res.status === 201) {
        itemSaved = true;
      }
    } catch {}

    // 2.2 Fallback: requestUrl
    if (!itemSaved) {
      try {
        const res = await requestUrl({
          url: `http://127.0.0.1:${this.port}/connector/saveItems`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Zotero-Connector-API-Version": "3",
          },
          body: payload,
        });

        if (res.status === 200 || res.status === 201) {
          itemSaved = true;
        }
      } catch {}
    }

    if (!itemSaved) {
      return { success: false, message: "无法连接 Zotero 桌面端，请确认已开启 Zotero" };
    }

    // Cache mark as in Zotero
    const cacheKey = cleanDoi || this.cleanTitle(rawTitle);
    this.checkedCache.set(cacheKey, { inZotero: true });

    // Step 3: If PDF was found, attach it via /connector/saveAttachment
    let hasPdf = false;
    let pdfSizeKb = 0;
    let pdfSource = "";

    if (pdfData && pdfData.buffer) {
      try {
        const meta = {
          sessionID: sid,
          parentItemID: tid,
          title: "Full Text PDF",
          url: pdfData.url || targetUrl,
        };

        const attachRes = await nodeRequest({
          port: this.port,
          path: "/connector/saveAttachment",
          method: "POST",
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(pdfData.buffer.length),
            "X-Metadata": JSON.stringify(meta),
            "X-Zotero-Connector-API-Version": "3",
          },
          body: pdfData.buffer,
          timeoutMs: 30000,
        });

        if (attachRes.status === 200 || attachRes.status === 201) {
          hasPdf = true;
          pdfSizeKb = Math.round(pdfData.buffer.length / 1024);
          pdfSource = pdfData.source;
        }
      } catch (attachErr) {
        console.warn("Failed to attach PDF to Zotero:", attachErr);
      }
    }

    return {
      success: true,
      hasPdf,
      pdfSizeKb,
      pdfSource,
    };
  }

  /**
   * Search Zotero local library for paper and return its abstractNote if available
   */
  public async searchAbstract(title: string, doi?: string): Promise<{
    abstract?: string;
    item?: any;
  } | null> {
    try {
      if (!title || title.trim().length < 4) return null;

      const cleanTitle = title
        .replace(/[\[\]【】\(\)（）]/g, " ")
        .replace(/["':：]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const searchTerm = doi || cleanTitle.substring(0, 50);
      const q = encodeURIComponent(searchTerm);
      const path = `/api/users/0/items?q=${q}&qmode=everything&limit=5`;

      let items: any[] = [];

      // 1. Try Node HTTP
      try {
        const res = await nodeRequest({
          port: this.port,
          path,
          method: "GET",
          timeoutMs: 2000,
        });
        if (res.status === 200 && Array.isArray(res.json)) {
          items = res.json;
        }
      } catch {}

      // 2. Fallback requestUrl
      if (items.length === 0) {
        try {
          const res = await requestUrl({
            url: `http://127.0.0.1:${this.port}${path}`,
            method: "GET",
          });
          if (res.status === 200 && Array.isArray(res.json)) {
            items = res.json;
          }
        } catch {}
      }

      for (const it of items) {
        const data = it.data || {};
        const itemTitle = (data.title || "").toLowerCase();
        const itemDoi = (data.DOI || "").toLowerCase();
        const targetTitle = cleanTitle.toLowerCase();

        if (
          (doi && itemDoi && itemDoi.includes(doi.toLowerCase())) ||
          (targetTitle.length > 5 && itemTitle.includes(targetTitle)) ||
          (itemTitle.length > 5 && targetTitle.includes(itemTitle))
        ) {
          if (data.abstractNote && data.abstractNote.trim().length > 10) {
            return {
              abstract: data.abstractNote.trim(),
              item: data,
            };
          }
        }
      }
    } catch (e) {
      // Zotero offline
    }
    return null;
  }
}
