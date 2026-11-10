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

    const titleContainer = titleWrapper.createDiv({ cls: "scholar-paper-title-container" });

    const renderTitle = () => {
      titleContainer.empty();

      if (item.zhTitle && item.zhTitle !== item.title) {
        // Bilingual Title: Chinese translated title prominent, English original below
        const zhTitleEl = titleContainer.createDiv({
          cls: `scholar-paper-title scholar-paper-title-zh ${item.inVault ? "scholar-title-linked" : ""}`,
          text: `【译】${item.zhTitle}`,
        });
        const origTitleEl = titleContainer.createDiv({
          cls: "scholar-paper-title-sub",
          text: item.title,
        });

        if (item.inVault && item.vaultFile) {
          zhTitleEl.title = `点击在编辑区打开: ${item.vaultFile.basename}`;
          origTitleEl.title = `点击在编辑区打开: ${item.vaultFile.basename}`;
          const openAction = async () => {
            await app.workspace.getLeaf(false).openFile(item.vaultFile!);
          };
          zhTitleEl.onclick = openAction;
          origTitleEl.onclick = openAction;
        }
      } else {
        const titleEl = titleContainer.createSpan({
          cls: `scholar-paper-title ${item.inVault ? "scholar-title-linked" : ""}`,
          text: item.title,
        });

        if (item.inVault && item.vaultFile) {
          titleEl.title = `点击在编辑区打开: ${item.vaultFile.basename}`;
          titleEl.onclick = async () => {
            await app.workspace.getLeaf(false).openFile(item.vaultFile!);
          };
        }
      }
    };
    renderTitle();

    // Status Badge: inVault (green) > inZotero (purple) > missing (gray)
    const badgeEl = headerEl.createEl("span", { cls: "scholar-vault-badge" });
    const updateBadge = () => {
      badgeEl.empty();
      if (item.inVault) {
        badgeEl.className = "scholar-vault-badge scholar-badge-in-vault";
        badgeEl.innerText = "已在库中";
        badgeEl.title = item.vaultFile ? `笔记文件: ${item.vaultFile.path}` : "本地 Obsidian 库中已存在此笔记";
        badgeEl.onclick = async () => {
          if (item.vaultFile) {
            await app.workspace.getLeaf(false).openFile(item.vaultFile);
          }
        };
      } else if (item.inZotero) {
        badgeEl.className = "scholar-vault-badge scholar-badge-zotero";
        badgeEl.innerText = "Zotero已收";
        badgeEl.title = "Zotero 桌面端已收录该文献";
        badgeEl.onclick = null;
      } else {
        badgeEl.className = "scholar-vault-badge scholar-badge-missing";
        badgeEl.innerText = "未收录";
        badgeEl.title = "本地笔记与 Zotero 均未收录";
        badgeEl.onclick = null;
      }
    };
    updateBadge();

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

    // 1. One-click Fetch Abstract & Translate (Unified)
    const abstractBtn = actionsEl.createEl("button", {
      cls: "scholar-action-btn scholar-abstract-toggle-btn",
      text: item.abstract ? "📄 查看摘要" : "🌐 抓取摘要并翻译",
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

      absBox.createDiv({
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

      // Translate / Revert toggle
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
      } else if (item.abstractZh && item.abstract && item.abstract !== item.abstractZh) {
        const revertBtn = absTools.createEl("button", {
          cls: "scholar-sub-btn",
          text: "🔤 显示英文原文",
        });
        revertBtn.onclick = () => {
          const showingZh = absTools.getAttribute("data-showing") !== "en";
          const textEl = absBox.querySelector(".scholar-abstract-text");
          if (showingZh) {
            if (textEl) textEl.textContent = item.abstract!;
            revertBtn.innerText = "🌐 显示中文译文";
            absTools.setAttribute("data-showing", "en");
          } else {
            if (textEl) textEl.textContent = item.abstractZh!;
            revertBtn.innerText = "🔤 显示英文原文";
            absTools.setAttribute("data-showing", "zh");
          }
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
        await fetchAbstractAndTranslate();
      };
    };

    const fetchAbstractAndTranslate = async () => {
      abstractContainer.empty();
      abstractContainer.style.display = "block";
      abstractBtn.innerText = "📄 收起摘要";
      isAbstractOpen = true;

      const loadingEl = abstractContainer.createDiv({
        cls: "scholar-abstract-loading",
        text: "正在全域检索并自动翻译 (本地笔记 / Zotero / 知网CNKI / Crossref / OpenAlex)...",
      });

      // 1. Fetch Abstract
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

        // 2. Auto-translate abstract if in English
        const isEnglishAbs = !/[\u4e00-\u9fa5]/.test(result.abstract.substring(0, 50));
        if (isEnglishAbs && !item.abstractZh) {
          loadingEl.innerText = "正在智能翻译摘要及标题...";
          const [zhAbs, zhTitle] = await Promise.all([
            AbstractHelper.translateText(result.abstract),
            !item.zhTitle && isEnglishTitle ? AbstractHelper.translateText(item.title) : Promise.resolve(null),
          ]);
          if (zhAbs) item.abstractZh = zhAbs;
          if (zhTitle) {
            item.zhTitle = zhTitle;
            renderTitle();
          }
        } else if (!item.zhTitle && isEnglishTitle) {
          // Translate title if not done
          AbstractHelper.translateText(item.title).then((zhTitle) => {
            if (zhTitle) {
              item.zhTitle = zhTitle;
              renderTitle();
            }
          });
        }

        renderAbstractBox();
      } else {
        // If abstract not found, still try to translate title if English
        if (!item.zhTitle && isEnglishTitle) {
          AbstractHelper.translateText(item.title).then((zhTitle) => {
            if (zhTitle) {
              item.zhTitle = zhTitle;
              renderTitle();
            }
          });
        }

        abstractContainer.empty();
        const errBox = abstractContainer.createDiv({ cls: "scholar-abstract-box" });
        errBox.createDiv({
          cls: "scholar-abstract-empty",
          text: "未在本地库、Zotero、Crossref 或 OpenAlex 中检索到该文献的公开摘要。",
        });

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

    abstractBtn.onclick = async () => {
      isAbstractOpen = !isAbstractOpen;
      if (isAbstractOpen) {
        abstractContainer.style.display = "block";
        abstractBtn.innerText = "📄 收起摘要";

        if (!item.abstract) {
          await fetchAbstractAndTranslate();
        } else {
          // If already has English abstract but no translation, auto translate
          const isEnglishAbs = item.abstract && !/[\u4e00-\u9fa5]/.test(item.abstract.substring(0, 40));
          if (isEnglishAbs && !item.abstractZh) {
            AbstractHelper.translateText(item.abstract).then((zh) => {
              if (zh) {
                item.abstractZh = zh;
                renderAbstractBox();
              }
            });
          }
          renderAbstractBox();
        }
      } else {
        abstractContainer.style.display = "none";
        abstractBtn.innerText = item.abstract ? "📄 查看摘要" : "🌐 抓取摘要并翻译";
      }
    };

    // 2. Translate Title Button (if English title)
    const isEnglishTitle = item.title && !/[\u4e00-\u9fa5]/.test(item.title);
    if (isEnglishTitle && !item.zhTitle) {
      const transTitleBtn = actionsEl.createEl("button", {
        cls: "scholar-action-btn scholar-trans-title-btn",
        text: "🔤 翻译标题",
      });
      transTitleBtn.title = "将英文论文标题一键翻译为中文";
      transTitleBtn.onclick = async () => {
        transTitleBtn.innerText = "正在翻译...";
        transTitleBtn.disabled = true;
        const zh = await AbstractHelper.translateText(item.title);
        if (zh) {
          item.zhTitle = zh;
          renderTitle();
          transTitleBtn.remove();
          new Notice(`标题已翻译: ${zh}`);
        } else {
          transTitleBtn.innerText = "翻译失败重试";
          transTitleBtn.disabled = false;
        }
      };
    }

    // 3. One-click create note (inVault = false)
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

          if (item.abstractZh || item.abstract) {
            content += `## 摘要\n\n${item.abstractZh || item.abstract}\n\n`;
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
          updateBadge();
          createBtn.remove();
          if (onNoteCreated) onNoteCreated(newFile);
        } catch (e: any) {
          new Notice(`创建卡片失败: ${e.message}`);
        }
      };
    }

    // 4. One-click Save to Zotero (Replaces old BibTeX, prominent & smart)
    const zoteroBtn = actionsEl.createEl("button", {
      cls: `scholar-action-btn ${item.inZotero ? "scholar-btn-zotero-saved" : "scholar-zotero-btn"}`,
      text: item.inZotero ? "✅ Zotero已收" : "➕ 存入 Zotero",
    });
    zoteroBtn.title = item.inZotero
      ? "Zotero 库中已收录此条目（点击可重新推入当前集合）"
      : "一键将文献元数据及摘要直接存入 Zotero 桌面端当前集合";

    zoteroBtn.onclick = async () => {
      zoteroBtn.innerText = "正在存入...";
      zoteroBtn.disabled = true;
      const res = await plugin.zoteroLocalClient.saveItemToZotero(item);
      if (res.success) {
        item.inZotero = true;
        zoteroBtn.innerText = "✅ 已存 Zotero";
        zoteroBtn.className = "scholar-action-btn scholar-btn-zotero-saved";
        zoteroBtn.disabled = false;
        updateBadge();
        new Notice(`已成功将文献《${item.zhTitle || item.title}》存入 Zotero！`);
      } else {
        zoteroBtn.innerText = "重试存入 Zotero";
        zoteroBtn.disabled = false;
        new Notice(`存入 Zotero 失败: ${res.message || "请确认 Zotero 桌面端已开启"}`);
      }
    };

    // 5. Open External Link (DOI / Scholar / CNKI)
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
