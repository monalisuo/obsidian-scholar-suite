import { App, TFile, Notice } from "obsidian";
import { ReferenceItem, CitationItem } from "../../types";
import { AbstractHelper } from "../../core/abstractHelper";
import type ScholarSuitePlugin from "../../main";

export class PaperCard {
  public static render(
    container: HTMLElement,
    item: ReferenceItem | CitationItem,
    app: App,
    plugin: ScholarSuitePlugin,
    onNoteCreated?: (file: TFile) => void
  ): HTMLElement {
    const card = container.createDiv({ cls: "scholar-paper-card" });

    // Header: [Index] Title + Status Badge
    const headerEl = card.createDiv({ cls: "scholar-paper-card-header" });

    const titleWrapper = headerEl.createDiv({ cls: "scholar-title-wrapper" });
    if (item.index !== undefined) {
      titleWrapper.createSpan({ cls: "scholar-index-tag", text: `[${item.index}]` });
    }

    const titleEl = titleWrapper.createSpan({
      cls: `scholar-paper-title ${item.inVault ? "scholar-title-linked" : ""}`,
      text: item.title,
    });

    if (item.inVault && item.vaultFile) {
      titleEl.title = `点击在编辑区打开: ${item.vaultFile.basename}`;
      titleEl.onclick = async () => {
        await app.workspace.getLeaf(false).openFile(item.vaultFile!);
      };
    }

    const badgeEl = headerEl.createEl("span", {
      cls: `scholar-vault-badge ${item.inVault ? "scholar-badge-in-vault" : "scholar-badge-missing"}`,
      text: item.inVault ? "已在库中" : "未收录",
    });

    if (item.inVault && item.vaultFile) {
      badgeEl.title = item.vaultFile.path;
      badgeEl.onclick = async () => {
        await app.workspace.getLeaf(false).openFile(item.vaultFile!);
      };
    }

    // Meta line: Authors, Year, Journal, Citation count, Journal Rank Badges
    const metaEl = card.createDiv({ cls: "scholar-paper-meta" });
    const updateMetaText = () => {
      metaEl.empty();
      const authorsText =
        item.authors && item.authors.length > 0
          ? item.authors.slice(0, 3).join(", ") + (item.authors.length > 3 ? " 等" : "")
          : "未知作者";
      const yearText = item.year ? `(${item.year})` : "";
      const journalText = item.journal ? ` · ${item.journal}` : "";
      metaEl.createEl("span", { text: `${authorsText} ${yearText}${journalText}` });

      // Render Journal Rank Badges (EasyScholar)
      if (item.journalRanks && item.journalRanks.length > 0) {
        const ranksEl = metaEl.createSpan({ cls: "scholar-journal-ranks" });
        for (const b of item.journalRanks) {
          ranksEl.createSpan({
            cls: `scholar-rank-badge rank-${b.type}`,
            text: b.text,
          });
        }
      }

      if (item.citationCount !== undefined && item.citationCount > 0) {
        metaEl.createEl("span", {
          cls: "scholar-citation-count-tag",
          text: `被引: ${item.citationCount} 次`,
        });
      }

      if ("isInfluential" in item && item.isInfluential) {
        metaEl.createEl("span", {
          cls: "scholar-influential-tag",
          text: "★ 权威引证",
        });
      }
    };
    updateMetaText();

    // Asynchronously resolve Journal Ranks via EasyScholar if available
    if (item.journal && (!item.journalRanks || item.journalRanks.length === 0)) {
      plugin.easyScholarClient.fetchJournalRanks(item.journal, plugin).then((ranks) => {
        if (ranks && ranks.length > 0) {
          item.journalRanks = ranks;
          updateMetaText();
        }
      });
    }

    // Abstract Drawer (Accordion)
    const abstractContainer = card.createDiv({ cls: "scholar-abstract-container" });
    abstractContainer.style.display = "none";

    // Actions row
    const actionsEl = card.createDiv({ cls: "scholar-paper-actions" });

    // 1. Abstract Toggle Button
    const abstractToggleBtn = actionsEl.createEl("button", {
      cls: "scholar-action-btn scholar-abstract-toggle-btn",
      text: "📄 查看摘要",
    });

    let isAbstractOpen = false;

    const renderAbstractBox = () => {
      abstractContainer.empty();
      const absBox = abstractContainer.createDiv({ cls: "scholar-abstract-box" });

      // Source pill
      if (item.abstractSource) {
        const sourcePill = absBox.createDiv({ cls: "scholar-abstract-source-tag" });
        sourcePill.createSpan({ text: `来源: ${item.abstractSource}` });
      }

      if (item.abstractZh) {
        absBox.createDiv({
          cls: "scholar-abstract-source-tag",
          text: "🌐 中文译文",
        });
      }

      const textEl = absBox.createDiv({
        cls: "scholar-abstract-text",
        text: item.abstractZh || item.abstract || "暂无摘要",
      });

      const absTools = absBox.createDiv({ cls: "scholar-abstract-tools" });

      // Copy Abstract
      const copyAbsBtn = absTools.createEl("button", {
        cls: "scholar-sub-btn",
        text: "📋 复制摘要",
      });
      copyAbsBtn.onclick = () => {
        navigator.clipboard.writeText(item.abstractZh || item.abstract || "");
        new Notice("摘要已复制到剪贴板！");
      };

      // Translate Abstract (if English)
      const isEnglish = item.abstract && !/[\u4e00-\u9fa5]/.test(item.abstract.substring(0, 40));
      if (item.abstract && isEnglish && !item.abstractZh) {
        const transBtn = absTools.createEl("button", {
          cls: "scholar-sub-btn scholar-trans-btn",
          text: "🌐 翻译摘要",
        });
        transBtn.onclick = async () => {
          transBtn.innerText = "正在翻译...";
          const zh = await AbstractHelper.translateText(item.abstract!);
          if (zh) {
            item.abstractZh = zh;
            renderAbstractBox();
            new Notice("摘要翻译完成！");
          } else {
            transBtn.innerText = "翻译失败，点击重试";
            new Notice("翻译服务暂时不可用，请检查网络连接");
          }
        };
      } else if (item.abstractZh) {
        const revertBtn = absTools.createEl("button", {
          cls: "scholar-sub-btn",
          text: "🔤 显示英文原文",
        });
        revertBtn.onclick = () => {
          item.abstractZh = undefined;
          renderAbstractBox();
        };
      }

      // Re-fetch button
      const refetchBtn = absTools.createEl("button", {
        cls: "scholar-sub-btn",
        text: "🔄 重新抓取",
      });
      refetchBtn.onclick = async () => {
        item.abstract = undefined;
        item.abstractZh = undefined;
        item.abstractSource = undefined;
        await fetchAbstractData();
      };
    };

    const fetchAbstractData = async () => {
      abstractContainer.empty();
      const loadingEl = abstractContainer.createDiv({
        cls: "scholar-abstract-loading",
        text: "正在全域知识网络检索摘要 (本地笔记 / Zotero / 知网CNKI / Crossref / OpenAlex)...",
      });

      const result = await AbstractHelper.fetchAbstractUnified(app, plugin, item);

      if (result && result.abstract) {
        item.abstract = result.abstract;
        item.abstractSource = result.source;
        if (result.authors && (!item.authors || item.authors.length === 0)) {
          item.authors = result.authors;
        }
        if (result.journal && !item.journal) {
          item.journal = result.journal;
        }
        if (result.doi && !item.doi) {
          item.doi = result.doi;
        }
        updateMetaText();
        renderAbstractBox();
      } else {
        abstractContainer.empty();
        const errBox = abstractContainer.createDiv({ cls: "scholar-abstract-box" });
        errBox.createDiv({
          cls: "scholar-abstract-empty",
          text: "未在本地库、Zotero、Crossref 或 OpenAlex 中检索到该文献的公开摘要。",
        });

        // Offer direct search link
        const targetQ = item.zhTitle || item.title;
        const isZh = /[\u4e00-\u9fa5]/.test(targetQ);
        const searchUrl = isZh
          ? `https://kns.cnki.net/kns8s/defaultresult/index?korder=SU&kw=${encodeURIComponent(targetQ)}`
          : `https://scholar.google.com/scholar?q=${encodeURIComponent(targetQ)}`;

        const directLink = errBox.createEl("a", {
          cls: "scholar-action-link",
          text: isZh ? "🔍 在知网直接搜索此文献 ↗" : "🔍 在 Google Scholar 检索此文献 ↗",
          href: searchUrl,
        });
        directLink.target = "_blank";
      }
    };

    abstractToggleBtn.onclick = async () => {
      isAbstractOpen = !isAbstractOpen;
      if (isAbstractOpen) {
        abstractContainer.style.display = "block";
        abstractToggleBtn.innerText = "📄 收起摘要";

        if (!item.abstract) {
          await fetchAbstractData();
        } else {
          renderAbstractBox();
        }
      } else {
        abstractContainer.style.display = "none";
        abstractToggleBtn.innerText = "📄 查看摘要";
      }
    };

    // 2. One-click create note
    if (!item.inVault) {
      const createBtn = actionsEl.createEl("button", {
        cls: "scholar-action-btn scholar-create-btn",
        text: "📥 一键建卡",
      });
      createBtn.onclick = async () => {
        try {
          const rawName = item.zhTitle || item.title;
          const safeTitle = rawName.replace(/[\\/:*?"<>|]/g, "_").substring(0, 80);
          const newPath = `📥 收件箱/${safeTitle}.md`;

          let content = `---\ntitle: "${rawName.replace(/"/g, '\\"')}"\nauthors:\n${(item.authors || [])
            .map((a) => `  - "${a}"`)
            .join("\n")}\ndate: "${item.year || ""}"\ndoi: "${item.doi || ""}"\nstatus: 待读\nsource: Scholar-Suite\n---\n\n# ${rawName}\n\n`;

          if (item.abstract) {
            content += `## 摘要\n\n${item.abstract}\n\n`;
          }

          const templateFile = app.vault.getAbstractFileByPath(plugin.settings.defaultTemplatePath);
          if (templateFile instanceof TFile) {
            const tmplText = await app.vault.read(templateFile);
            content = tmplText
              .replace(/{{title}}/g, rawName)
              .replace(/{{date}}/g, String(item.year || ""))
              .replace(/{{doi}}/g, item.doi || "");
          }

          const newFile = await app.vault.create(newPath, content);
          new Notice(`已在收件箱创建文献卡片: ${safeTitle}`);
          item.inVault = true;
          item.vaultFile = newFile;
          badgeEl.className = "scholar-vault-badge scholar-badge-in-vault";
          badgeEl.innerText = "已在库中";
          createBtn.remove();
          if (onNoteCreated) onNoteCreated(newFile);
        } catch (e: any) {
          new Notice(`创建卡片失败: ${e.message}`);
        }
      };
    }

    // 3. One-click Save to Zotero
    const zoteroBtn = actionsEl.createEl("button", {
      cls: "scholar-action-btn scholar-zotero-btn",
      text: "➕ 存入 Zotero",
    });
    zoteroBtn.title = "一键将文献元数据及摘要存入 Zotero 桌面端当前集合";
    zoteroBtn.onclick = async () => {
      zoteroBtn.innerText = "正在存入...";
      zoteroBtn.disabled = true;
      const res = await plugin.zoteroLocalClient.saveItemToZotero(item);
      if (res.success) {
        zoteroBtn.innerText = "✅ 已存 Zotero";
        new Notice(`已成功将文献《${item.zhTitle || item.title}》存入 Zotero！`);
      } else {
        zoteroBtn.innerText = "重试存入 Zotero";
        zoteroBtn.disabled = false;
        new Notice(`存入 Zotero 失败: ${res.message || "请确认 Zotero 桌面端已开启"}`);
      }
    };

    // 4. Copy BibTeX
    const copyBibBtn = actionsEl.createEl("button", {
      cls: "scholar-action-btn",
      text: "BibTeX",
    });
    copyBibBtn.onclick = () => {
      const firstAuthor = item.authors[0]?.split(" ").pop() || "Author";
      const citekey = `${firstAuthor}${item.year || "Year"}`;
      const bib = `@article{${citekey},\n  title={${item.title}},\n  author={${item.authors.join(" and ")}},\n  year={${item.year || ""}},\n  doi={${item.doi || ""}}\n}`;
      navigator.clipboard.writeText(bib);
      new Notice("已复制 BibTeX 条目到剪贴板");
    };

    // 4. Open External Link (DOI / Scholar / CNKI)
    if (item.doi) {
      const doiBtn = actionsEl.createEl("a", {
        cls: "scholar-action-link",
        text: "DOI ↗",
        href: `https://doi.org/${item.doi}`,
      });
      doiBtn.target = "_blank";
    }

    // Search link
    const targetQuery = item.zhTitle || item.title;
    const isChinese = /[\u4e00-\u9fa5]/.test(targetQuery);
    const searchUrl = isChinese
      ? `https://kns.cnki.net/kns8s/defaultresult/index?korder=SU&kw=${encodeURIComponent(targetQuery)}`
      : `https://scholar.google.com/scholar?q=${encodeURIComponent(targetQuery)}`;

    const searchLink = actionsEl.createEl("a", {
      cls: "scholar-action-link",
      text: isChinese ? "知网 ↗" : "Scholar ↗",
      href: searchUrl,
    });
    searchLink.target = "_blank";

    return card;
  }
}
