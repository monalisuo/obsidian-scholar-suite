import { requestUrl } from "obsidian";
import { ReferenceItem, CitationItem, ScholarlyPaper } from "../types";

export interface OpenAlexAbstractResult {
  abstract?: string;
  doi?: string;
  title?: string;
}

export class OpenAlexClient {
  public async fetchPaperByDoi(doi: string): Promise<{
    paper?: ScholarlyPaper;
    references: ReferenceItem[];
    citations: CitationItem[];
  }> {
    const cleanDoi = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(cleanDoi)}`;

    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          "User-Agent": "ObsidianScholarSuite/1.0.0 (mailto:scholar-suite@obsidian.md)",
        },
      });

      if (response.status !== 200) {
        throw new Error(`OpenAlex API returned status ${response.status}`);
      }

      const data = response.json;
      const abstract = this.decodeInvertedIndex(data.abstract_inverted_index) || undefined;

      const paper: ScholarlyPaper = {
        title: data.title || "",
        authors: (data.authorships || []).map((a: any) => a.author?.display_name || ""),
        year: data.publication_year,
        journal: data.primary_location?.source?.display_name || "",
        doi: cleanDoi,
        citationCount: data.cited_by_count,
        abstract,
      };

      const references: ReferenceItem[] = (data.referenced_works || []).slice(0, 50).map((id: string, idx: number) => ({
        id: id || `oa_${idx}`,
        title: `Work ${id.replace("https://openalex.org/", "")}`,
        authors: [],
        inVault: false,
      }));

      return { paper, references, citations: [] };
    } catch (err) {
      console.warn("OpenAlex fetch failed:", err);
      return { references: [], citations: [] };
    }
  }

  /**
   * Fetch full references (referenced_works) for a paper via OpenAlex batch query
   */
  public async fetchReferencedWorks(doiOrTitle: string, title?: string): Promise<ReferenceItem[]> {
    try {
      let rawRefs: string[] = [];
      if (doiOrTitle.startsWith("10.") || doiOrTitle.includes("10.")) {
        const cleanDoi = doiOrTitle.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
        const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(cleanDoi)}?mailto=scholar-suite@obsidian.md`;
        const res = await requestUrl({
          url,
          method: "GET",
          headers: { "User-Agent": "ScholarSuite/1.0.0 (mailto:scholar-suite@obsidian.md)" },
        });
        if (res.status === 200 && Array.isArray(res.json?.referenced_works)) {
          rawRefs = res.json.referenced_works;
        }
      }

      if (rawRefs.length === 0) return [];

      // Extract IDs (e.g. W99945393) up to 50
      const ids = rawRefs
        .slice(0, 50)
        .map((u) => u.split("/").pop())
        .filter(Boolean);

      if (ids.length === 0) return [];

      const batchUrl = `https://api.openalex.org/works?filter=openalex_id:${ids.join("|")}&per-page=50&mailto=scholar-suite@obsidian.md`;
      const batchRes = await requestUrl({
        url: batchUrl,
        method: "GET",
        headers: { "User-Agent": "ScholarSuite/1.0.0 (mailto:scholar-suite@obsidian.md)" },
      });

      if (batchRes.status === 200 && Array.isArray(batchRes.json?.results)) {
        return batchRes.json.results.map((w: any, idx: number) => {
          const rawDoi = w.doi ? w.doi.replace("https://doi.org/", "") : undefined;
          const abstract = this.decodeInvertedIndex(w.abstract_inverted_index) || undefined;
          return {
            id: w.id || `oa_ref_${idx}`,
            index: idx + 1,
            title: w.title || "Untitled",
            authors: (w.authorships || []).map((a: any) => a.author?.display_name || "").filter(Boolean),
            year: w.publication_year ? String(w.publication_year) : undefined,
            journal: w.primary_location?.source?.display_name || "",
            doi: rawDoi,
            abstract,
            citationCount: w.cited_by_count,
            inVault: false,
          };
        });
      }
    } catch (e) {
      console.warn("OpenAlex batch referenced_works failed:", e);
    }
    return [];
  }

  /**
   * Fetch abstract directly by DOI from OpenAlex
   */
  public async fetchAbstractByDoi(doi: string): Promise<string | null> {
    const cleanDoi = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(cleanDoi)}?mailto=scholar-suite@obsidian.md`;
    try {
      const res = await requestUrl({
        url,
        method: "GET",
        headers: {
          "User-Agent": "ScholarSuite/1.0.0 (mailto:scholar-suite@obsidian.md)",
        },
      });
      if (res.status === 200 && res.json?.abstract_inverted_index) {
        return this.decodeInvertedIndex(res.json.abstract_inverted_index);
      }
    } catch (e) {
      // Fallback
    }
    return null;
  }

  /**
   * Fetch abstract and DOI by title search from OpenAlex
   */
  public async fetchAbstractByTitle(title: string): Promise<OpenAlexAbstractResult | null> {
    if (!title || title.length < 5 || /[\u4e00-\u9fa5]/.test(title)) return null;

    const clean = title
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const firstWords = clean.split(" ").slice(0, 10).join(" ");

    const url = `https://api.openalex.org/works?search=${encodeURIComponent(firstWords)}&per-page=5`;
    try {
      const res = await requestUrl({
        url,
        method: "GET",
        headers: {
          "User-Agent": "ObsidianScholarSuite/1.0.0 (mailto:scholar-suite@obsidian.md)",
        },
      });

      if (res.status === 200 && Array.isArray(res.json?.results) && res.json.results.length > 0) {
        const results = res.json.results;
        for (const w of results) {
          if (w.abstract_inverted_index) {
            const ab = this.decodeInvertedIndex(w.abstract_inverted_index);
            if (ab && ab.length > 20) {
              const rawDoi = w.doi ? w.doi.replace("https://doi.org/", "") : undefined;
              return {
                abstract: ab,
                doi: rawDoi,
                title: w.title,
              };
            }
          }
        }
      }
    } catch (e) {
      // Fallback
    }
    return null;
  }

  /**
   * Helper to verify if the candidate paper title matches the search target
   */
  private verifyTitleMatch(query: string, candidateTitle?: string): boolean {
    if (!candidateTitle) return false;
    const cleanQ = query.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, "");
    const cleanC = candidateTitle.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, "");
    if (!cleanQ || !cleanC) return false;

    // Direct containment
    if (cleanC.includes(cleanQ) || cleanQ.includes(cleanC)) return true;

    // Character / Token overlap
    const qChars = new Set(cleanQ.split(""));
    let overlap = 0;
    for (const ch of cleanC) {
      if (qChars.has(ch)) overlap++;
    }
    const ratio = (overlap * 2) / (cleanQ.length + cleanC.length);
    return ratio >= 0.45;
  }

  /**
   * Fetch papers citing this work from OpenAlex
   */
  public async fetchCitingPapers(doiOrTitle: string, title?: string): Promise<{
    totalCount: number;
    citations: CitationItem[];
  }> {
    try {
      let workId: string | null = null;
      let totalCited = 0;

      // 1. Resolve work ID by DOI
      if (doiOrTitle.startsWith("10.") || doiOrTitle.includes("10.")) {
        const cleanDoi = doiOrTitle.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
        const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(cleanDoi)}?mailto=scholar-suite@obsidian.md`;
        const res = await requestUrl({
          url,
          method: "GET",
          headers: { "User-Agent": "ScholarSuite/1.0.0 (mailto:scholar-suite@obsidian.md)" },
        });
        if (res.status === 200 && res.json?.id) {
          workId = res.json.id.split("/").pop() || null;
          totalCited = res.json.cited_by_count || 0;
        }
      }

      // 2. Resolve work ID by Title if no DOI
      if (!workId) {
        const rawSearch = (title || doiOrTitle);
        // Retain both English words and Chinese characters!
        const searchTitle = rawSearch
          .replace(/[^\w\s\u4e00-\u9fa5]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (searchTitle.length >= 3) {
          const firstWords = searchTitle.split(" ").slice(0, 10).join(" ");
          const url = `https://api.openalex.org/works?search=${encodeURIComponent(firstWords)}&per-page=3&mailto=scholar-suite@obsidian.md`;
          const res = await requestUrl({
            url,
            method: "GET",
            headers: { "User-Agent": "ScholarSuite/1.0.0 (mailto:scholar-suite@obsidian.md)" },
          });
          if (res.status === 200 && Array.isArray(res.json?.results) && res.json.results.length > 0) {
            // Find first result that matches title similarity
            for (const cand of res.json.results) {
              if (this.verifyTitleMatch(rawSearch, cand.title)) {
                workId = cand.id.split("/").pop() || null;
                totalCited = cand.cited_by_count || 0;
                break;
              }
            }
          }
        }
      }

      if (!workId) {
        return { totalCount: 0, citations: [] };
      }

      // 3. Query works citing this work ID
      const citeUrl = `https://api.openalex.org/works?filter=cites:${workId}&sort=cited_by_count:desc&per-page=30&mailto=scholar-suite@obsidian.md`;
      const citeRes = await requestUrl({
        url: citeUrl,
        method: "GET",
        headers: { "User-Agent": "ScholarSuite/1.0.0 (mailto:scholar-suite@obsidian.md)" },
      });

      if (citeRes.status === 200 && Array.isArray(citeRes.json?.results)) {
        const total = citeRes.json.meta?.count ?? totalCited;
        const list: CitationItem[] = citeRes.json.results.map((w: any, idx: number) => {
          const rawDoi = w.doi ? w.doi.replace("https://doi.org/", "") : undefined;
          const abstract = this.decodeInvertedIndex(w.abstract_inverted_index) || undefined;
          return {
            id: w.id || `oa_cite_${idx}`,
            index: idx + 1,
            title: w.title || "Untitled",
            authors: (w.authorships || []).map((a: any) => a.author?.display_name || "").filter(Boolean),
            year: w.publication_year,
            journal: w.primary_location?.source?.display_name || "",
            doi: rawDoi,
            abstract,
            citationCount: w.cited_by_count,
            inVault: false,
          };
        });
        return { totalCount: total, citations: list };
      }
    } catch (e) {
      console.warn("OpenAlex fetch citing papers failed:", e);
    }
    return { totalCount: 0, citations: [] };
  }

  private decodeInvertedIndex(inv?: Record<string, number[]>): string | null {
    if (!inv || typeof inv !== "object") return null;
    try {
      const wordList: [number, string][] = [];
      for (const [word, positions] of Object.entries(inv)) {
        for (const pos of positions) {
          wordList.push([pos, word]);
        }
      }
      wordList.sort((a, b) => a[0] - b[0]);
      const full = wordList.map((x) => x[1]).join(" ").trim();
      return full.length > 20 ? full : null;
    } catch {
      return null;
    }
  }
}
