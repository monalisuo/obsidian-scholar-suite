import { requestUrl } from "obsidian";
import { CitationItem } from "../types";

export interface ScopusPaperResult {
  title?: string;
  creator?: string;
  journal?: string;
  doi?: string;
  citationCount?: number;
  scopusId?: string;
  year?: string;
}

export class ElsevierClient {
  private apiKey: string;

  constructor(apiKey: string = "") {
    this.apiKey = apiKey;
  }

  public setApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Search Scopus database for a paper by DOI or Title
   */
  public async fetchScopusData(doiOrTitle: string, title?: string): Promise<ScopusPaperResult | null> {
    if (!this.apiKey) return null;

    let query = "";
    if (doiOrTitle.startsWith("10.") || doiOrTitle.includes("10.")) {
      const cleanDoi = doiOrTitle.replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim();
      query = `doi(${cleanDoi})`;
    } else {
      const targetTitle = (title || doiOrTitle)
        .replace(/[\[\]"']/g, " ")
        .replace(/[^\w\s]/g, " ")
        .trim();
      const firstWords = targetTitle.split(/\s+/).slice(0, 8).join(" ");
      query = `title("${firstWords}")`;
    }

    const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(query)}&apiKey=${this.apiKey}`;

    try {
      const res = await requestUrl({
        url,
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (res.status === 200 && res.json?.["search-results"]?.entry?.length > 0) {
        const entry = res.json["search-results"].entry[0];
        const countStr = entry["citedby-count"];
        const citationCount = countStr !== undefined ? parseInt(countStr, 10) : undefined;

        return {
          title: entry["dc:title"],
          creator: entry["dc:creator"],
          journal: entry["prism:publicationName"],
          doi: entry["prism:doi"],
          citationCount: isNaN(citationCount as number) ? undefined : citationCount,
          scopusId: entry["dc:identifier"],
          year: entry["prism:coverDate"] ? entry["prism:coverDate"].substring(0, 4) : undefined,
        };
      }
    } catch (e) {
      console.warn("Elsevier Scopus fetch failed:", e);
    }
    return null;
  }

  /**
   * Fetch papers citing this paper via Scopus `refeid(...)`
   */
  public async fetchCitingPapers(scopusIdOrDoi: string): Promise<CitationItem[]> {
    if (!this.apiKey || !scopusIdOrDoi) return [];

    let query = "";
    if (scopusIdOrDoi.startsWith("SCOPUS_ID:") || /^\d+$/.test(scopusIdOrDoi)) {
      const id = scopusIdOrDoi.replace("SCOPUS_ID:", "").trim();
      query = `refeid(${id})`;
    } else if (scopusIdOrDoi.includes("10.")) {
      const cleanDoi = scopusIdOrDoi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim();
      query = `refdoi(${cleanDoi})`;
    } else {
      return [];
    }

    const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(query)}&count=25&apiKey=${this.apiKey}`;

    try {
      const res = await requestUrl({
        url,
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (res.status === 200 && res.json?.["search-results"]?.entry?.length > 0) {
        const entries = res.json["search-results"].entry;
        return entries.map((e: any, idx: number) => {
          const countStr = e["citedby-count"];
          const citationCount = countStr !== undefined ? parseInt(countStr, 10) : undefined;
          return {
            id: e["dc:identifier"] || `scopus_cite_${idx}`,
            index: idx + 1,
            title: e["dc:title"] || "Untitled",
            authors: e["dc:creator"] ? [e["dc:creator"]] : [],
            year: e["prism:coverDate"] ? e["prism:coverDate"].substring(0, 4) : undefined,
            journal: e["prism:publicationName"],
            doi: e["prism:doi"],
            citationCount: isNaN(citationCount as number) ? undefined : citationCount,
            inVault: false,
          };
        });
      }
    } catch (e) {
      console.warn("Elsevier Scopus citing papers query failed:", e);
    }
    return [];
  }
}
