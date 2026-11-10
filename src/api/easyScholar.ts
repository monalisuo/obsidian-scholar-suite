import { requestUrl } from "obsidian";
import { JournalRankBadge } from "../types";
import type ScholarSuitePlugin from "../main";

export class EasyScholarClient {
  private secretKey: string;

  constructor(secretKey: string = "") {
    this.secretKey = secretKey;
  }

  public setSecretKey(key: string) {
    this.secretKey = key;
  }

  /**
   * Clean raw journal name for optimal EasyScholar query matching
   */
  public cleanJournalName(journalName: string): string {
    if (!journalName || journalName.trim().length < 2) return "";
    let clean = journalName
      .replace(/\[\s*[A-Za-z/]+\s*\]/gi, "")
      .replace(/\s*\([^)]*\)$/, "")
      .replace(/\s*（[^）]*）$/, "")
      .replace(/\^ref\d+\b/gi, "")
      .replace(/\s*\(forthcoming\)/i, "")
      .replace(/[,，:：].*$/, "")
      .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
      .trim();

    // Skip book publishers or publication series
    if (
      !clean ||
      clean.includes(":") ||
      clean.toLowerCase().includes("press") ||
      clean.toLowerCase().includes("publisher") ||
      clean.toLowerCase().includes("publishing") ||
      clean.toLowerCase().includes("handbook") ||
      clean.toLowerCase().includes("working paper")
    ) {
      return "";
    }
    return clean;
  }

  /**
   * Fetch journal rank and tier badges from EasyScholar
   */
  public async fetchJournalRanks(
    journalName: string,
    plugin?: ScholarSuitePlugin
  ): Promise<JournalRankBadge[]> {
    const cleanName = this.cleanJournalName(journalName);
    if (!cleanName) return [];

    // 1. Check local cache
    const cacheKey = cleanName.toLowerCase();
    if (plugin?.settings?.journalRankCache?.[cacheKey]) {
      return plugin.settings.journalRankCache[cacheKey];
    }

    if (!this.secretKey) return [];

    const url = `https://www.easyscholar.cc/open/getPublicationRank?secretKey=${this.secretKey}&publicationName=${encodeURIComponent(cleanName)}`;

    try {
      const res = await requestUrl({
        url,
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "ScholarSuite/1.0.0",
        },
      });

      if (res.status === 200 && res.json?.data?.officialRank?.all) {
        const all = res.json.data.officialRank.all;
        const badges: JournalRankBadge[] = [];

        // Chinese Tiers
        if (all.cssci) {
          badges.push({ text: "CSSCI", type: "cssci" });
        }
        if (all.pku === "1" || all.pku === 1 || all.pku === "中文核心" || all.pku) {
          badges.push({ text: "北大核心", type: "pku" });
        }
        if (all.cscd) {
          badges.push({
            text: String(all.cscd).includes("核心") ? "CSCD核心" : "CSCD",
            type: "cscd",
          });
        }
        if (all.eii) {
          badges.push({ text: "EI", type: "ei" });
        }
        if (all.zhongguokejihexin) {
          badges.push({ text: "科技核心", type: "tech" });
        }

        // English / International Tiers
        if (all.sciUpTop) {
          badges.push({ text: "Top期刊", type: "top" });
        }
        if (all.sciUp) {
          const casText = String(all.sciUp).includes("区") ? String(all.sciUp) : `${all.sciUp}区`;
          badges.push({ text: casText, type: "cas" });
        }
        if (all.ssci) {
          badges.push({ text: `SSCI ${all.ssci}`, type: "ssci" });
        }
        if (all.sci && !all.ssci) {
          badges.push({ text: `SCI ${all.sci}`, type: "sci" });
        }
        if (all.sciif) {
          badges.push({ text: `IF ${all.sciif}`, type: "if" });
        }
        if (all.fms) {
          badges.push({ text: `FMS ${all.fms}`, type: "fms" });
        }
        if (all.ajg) {
          badges.push({ text: `AJG ${all.ajg}`, type: "ajg" });
        }

        // Disciplinary priority lists
        if (all.cug && typeof all.cug === "string" && all.cug.includes("T1")) {
          badges.push({ text: all.cug, type: "cug" });
        }

        // Save to cache
        if (plugin?.settings) {
          if (!plugin.settings.journalRankCache) {
            plugin.settings.journalRankCache = {};
          }
          plugin.settings.journalRankCache[cacheKey] = badges;
          plugin.saveSettings().catch(() => {});
        }

        return badges;
      }
    } catch (e) {
      console.warn(`EasyScholar rank query failed for ${cleanName}:`, e);
    }

    return [];
  }
}
