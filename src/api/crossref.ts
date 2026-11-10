import { requestUrl } from "obsidian";
import { ReferenceItem, ScholarlyPaper } from "../types";

export interface CrossrefAbstractResult {
  abstract?: string;
  doi?: string;
  title?: string;
}

export class CrossrefClient {
  public async fetchPaperAndReferences(doi: string): Promise<{
    paper?: ScholarlyPaper;
    references: ReferenceItem[];
  }> {
    const cleanDoi = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    const url = `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`;

    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          "User-Agent": "ObsidianScholarSuite/1.0.0 (mailto:scholar-suite@obsidian.md)",
        },
      });

      if (response.status !== 200) {
        throw new Error(`Crossref API returned status ${response.status}`);
      }

      const msg = response.json?.message;
      if (!msg) return { references: [] };

      let abstract = msg.abstract;
      if (abstract) {
        abstract = abstract.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      }

      const paper: ScholarlyPaper = {
        title: (msg.title && msg.title[0]) || "",
        authors: (msg.author || []).map((a: any) => `${a.given || ""} ${a.family || ""}`.trim()),
        year: msg.published?.["date-parts"]?.[0]?.[0] || msg["published-print"]?.["date-parts"]?.[0]?.[0],
        journal: (msg["container-title"] && msg["container-title"][0]) || "",
        doi: msg.DOI,
        citationCount: msg["is-referenced-by-count"],
        abstract,
      };

      const references: ReferenceItem[] = (msg.reference || []).map((r: any, idx: number) => {
        const title = r["article-title"] || r["volume-title"] || r["unstructured"] || `Reference ${idx + 1}`;
        const authors = r.author ? [r.author] : [];
        return {
          id: r.key || `cr_${idx}`,
          title,
          authors,
          year: r.year,
          journal: r["journal-title"],
          doi: r.DOI,
          rawText: r["unstructured"],
          inVault: false,
        };
      });

      return { paper, references };
    } catch (err) {
      console.warn("Crossref fetch failed:", err);
      return { references: [] };
    }
  }

  /**
   * Fetch abstract and resolved DOI from Crossref
   */
  public async fetchAbstractWithDoi(doiOrTitle: string, title?: string): Promise<CrossrefAbstractResult | null> {
    const headers = {
      "User-Agent": "ObsidianScholarSuite/1.0.0 (mailto:scholar-suite@obsidian.md)",
    };

    try {
      // 1. By DOI
      if (doiOrTitle.startsWith("10.") || doiOrTitle.includes("10.")) {
        const cleanDoi = doiOrTitle.replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim();
        const url = `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`;
        const res = await requestUrl({ url, method: "GET", headers });
        if (res.status === 200 && res.json?.message) {
          const msg = res.json.message;
          const ab = msg.abstract ? msg.abstract.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : undefined;
          return { abstract: ab, doi: msg.DOI || cleanDoi, title: msg.title?.[0] };
        }
      }

      // 2. Query by bibliographic title
      const queryTitle = title || doiOrTitle;
      if (queryTitle && queryTitle.length > 5 && !/[\u4e00-\u9fa5]/.test(queryTitle)) {
        const clean = queryTitle
          .replace(/[\[\]"']/g, " ")
          .replace(/[\?:]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const firstWords = clean.split(" ").slice(0, 10).join(" ");

        const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(firstWords)}&rows=3&mailto=scholar-suite@obsidian.md`;
        const res = await requestUrl({ url, method: "GET", headers });
        if (res.status === 200 && res.json?.message?.items?.length > 0) {
          const items = res.json.message.items;
          for (const item of items) {
            const ab = item.abstract ? item.abstract.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : undefined;
            return {
              abstract: ab,
              doi: item.DOI,
              title: item.title?.[0],
            };
          }
        }
      }
    } catch (e) {
      // Fallback
    }
    return null;
  }
}
