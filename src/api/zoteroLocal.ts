import { requestUrl } from "obsidian";
import { ReferenceItem, CitationItem, ScholarlyPaper } from "../types";

function nodeRequest(options: {
  hostname?: string;
  port: number;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
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

  constructor(port: number = 23119) {
    this.port = port;
  }

  public setPort(port: number) {
    this.port = port;
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

  /**
   * Fast check if a paper exists in local Zotero library (Zero Auth / Local Read API)
   */
  public async checkItemInZotero(paper: {
    doi?: string;
    title?: string;
    zhTitle?: string;
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

      // Check matched items
      const targetNorm = this.cleanTitle(rawTitle);
      for (const it of items) {
        const data = it.data || {};
        const itDoi = (data.DOI || "").trim().toLowerCase();
        const itTitle = this.cleanTitle(data.title || "");

        // Match condition 1: DOI matches
        if (cleanDoi && itDoi && (itDoi === cleanDoi || itDoi.includes(cleanDoi) || cleanDoi.includes(itDoi))) {
          const result = { inZotero: true, zoteroKey: it.key || data.key };
          this.checkedCache.set(cacheKey, result);
          return result;
        }

        // Match condition 2: Title exact match or substring
        if (targetNorm.length >= 6 && itTitle.length >= 6) {
          if (itTitle === targetNorm || itTitle.includes(targetNorm) || targetNorm.includes(itTitle)) {
            const result = { inZotero: true, zoteroKey: it.key || data.key };
            this.checkedCache.set(cacheKey, result);
            return result;
          }
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
   * One-click save paper to Zotero desktop via /connector/saveItems (Zero Auth / No Key Needed)
   */
  public async saveItemToZotero(item: ReferenceItem | CitationItem | ScholarlyPaper): Promise<{
    success: boolean;
    message?: string;
  }> {
    const rawTitle = (item as any).zhTitle || item.title || "Untitled Paper";
    const title = rawTitle.replace(/\s*\([^)]*\)$/, "").trim();
    const cleanDoi = item.doi ? item.doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "") : "";
    const sid = `obsidian-scholar-${Date.now()}`;
    const targetUrl = cleanDoi ? `https://doi.org/${cleanDoi}` : ((item as any).url || "https://scholar.google.com");

    const zoteroItem: any = {
      id: item.id || `item_${Date.now()}`,
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

    // 1. Direct Node HTTP (100% reliable)
    try {
      const res = await nodeRequest({
        port: this.port,
        path: "/connector/saveItems",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(payload)),
        },
        body: payload,
        timeoutMs: 4000,
      });

      if (res.status === 200 || res.status === 201) {
        // Cache mark as in Zotero
        const cacheKey = cleanDoi || this.cleanTitle(rawTitle);
        this.checkedCache.set(cacheKey, { inZotero: true });
        return { success: true };
      }
    } catch {}

    // 2. Fallback: requestUrl
    try {
      const res = await requestUrl({
        url: `http://127.0.0.1:${this.port}/connector/saveItems`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

      if (res.status === 200 || res.status === 201) {
        const cacheKey = cleanDoi || this.cleanTitle(rawTitle);
        this.checkedCache.set(cacheKey, { inZotero: true });
        return { success: true };
      }
      return { success: false, message: `HTTP ${res.status}` };
    } catch (e: any) {
      return { success: false, message: e.message || "连接失败" };
    }
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
