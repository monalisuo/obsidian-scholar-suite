import { App, Modal, TFile, Notice } from "obsidian";
import type ScholarSuitePlugin from "../main";
import { AuditIssue } from "../types";

export class MultimodalAuditModal extends Modal {
  private plugin: ScholarSuitePlugin;
  private targetFile: TFile;
  private issues: AuditIssue[] = [];
  private pdfPath: string | null = null;
  private isAuditing: boolean = true;

  constructor(app: App, plugin: ScholarSuitePlugin, targetFile: TFile) {
    super(app);
    this.plugin = plugin;
    this.targetFile = targetFile;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("scholar-audit-modal-container");

    contentEl.createEl("h2", { text: `多模态质量复核体检报告: ${this.targetFile.basename}` });

    this.runAudit();
  }

  private async runAudit(): Promise<void> {
    const content = await this.app.vault.read(this.targetFile);
    this.pdfPath = this.plugin.pdfAligner.findSourcePdf(this.targetFile);

    // 1. Math Doctor
    const mathIssues = this.plugin.mathDoctor.auditMath(content);

    // 2. Table Converter
    const tableIssues = this.plugin.tableConverter.auditTables(content);

    // 3. Citation Linker
    const citationIssues = this.plugin.citationLinker.auditCitations(content);

    // 4. PDF Aligner
    const alignIssues = this.plugin.pdfAligner.auditAlignment(content, this.pdfPath);

    this.issues = [...mathIssues, ...tableIssues, ...citationIssues, ...alignIssues];
    this.isAuditing = false;
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: `多模态文献体检: ${this.targetFile.basename}` });

    // Meta row
    const metaRow = contentEl.createDiv({ cls: "scholar-audit-meta-row" });
    metaRow.createEl("span", {
      text: `关联 PDF: ${this.pdfPath ? this.pdfPath : "未关联 (仅纯文本审计)"}`,
    });

    // Overview cards
    const cardsRow = contentEl.createDiv({ cls: "scholar-audit-cards-grid" });

    const mathCount = this.issues.filter((i) => i.category === "math").length;
    const tableCount = this.issues.filter((i) => i.category === "table").length;
    const citeCount = this.issues.filter((i) => i.category === "citation").length;
    const alignCount = this.issues.filter((i) => i.category === "align").length;

    this.renderMetricCard(cardsRow, "📐 LaTeX 公式", mathCount, mathCount === 0 ? "全部闭合正常" : `${mathCount} 项需注意`);
    this.renderMetricCard(cardsRow, "📊 表格管道化", tableCount, tableCount === 0 ? "全部标准管道表" : `${tableCount} 个 HTML 表`);
    this.renderMetricCard(cardsRow, "🔗 引文双向链接", citeCount, citeCount === 0 ? "双向跳转无死链" : `${citeCount} 项可优化`);
    this.renderMetricCard(cardsRow, "📄 PDF 对齐状态", alignCount, this.pdfPath ? (alignCount === 0 ? "无异常断字" : `${alignCount} 处存疑`) : "未绑定 PDF");

    // Fixable count
    const fixableCount = this.issues.filter((i) => i.autoFixable).length;

    // Actions row
    const actionsRow = contentEl.createDiv({ cls: "scholar-audit-actions-row" });
    if (fixableCount > 0) {
      const fixAllBtn = actionsRow.createEl("button", {
        cls: "mod-cta scholar-fix-all-btn",
        text: `⚡ 一键安全修复全部项 (${fixableCount} 项可自动修复)`,
      });
      fixAllBtn.onclick = async () => {
        await this.applyAutoFixes();
      };
    }

    const recheckBtn = actionsRow.createEl("button", {
      text: "🔄 重新检查",
    });
    recheckBtn.onclick = () => {
      this.runAudit();
    };

    // Issues list
    const issuesContainer = contentEl.createDiv({ cls: "scholar-audit-issues-list" });
    issuesContainer.createEl("h3", { text: `体检详细问题清单 (${this.issues.length})` });

    if (this.issues.length === 0) {
      const allGreen = issuesContainer.createDiv({ cls: "scholar-all-green-msg" });
      allGreen.createEl("div", { text: "🎉 完美！该文献笔记通过了全部多模态质检指标，无任何公式冲突、HTML表格或死链！" });
      return;
    }

    for (const issue of this.issues) {
      const issueEl = issuesContainer.createDiv({ cls: `scholar-issue-item scholar-severity-${issue.severity}` });
      const badge = issueEl.createSpan({ cls: `scholar-issue-badge category-${issue.category}`, text: issue.category.toUpperCase() });
      const lineSpan = issueEl.createSpan({ cls: "scholar-issue-line", text: `第 ${issue.line} 行: ` });
      issueEl.createSpan({ cls: "scholar-issue-msg", text: issue.message });
      if (issue.preview) {
        issueEl.createDiv({ cls: "scholar-issue-preview", text: issue.preview });
      }
    }
  }

  private renderMetricCard(container: HTMLElement, label: string, count: number, subtext: string): void {
    const card = container.createDiv({ cls: `scholar-metric-card ${count === 0 ? "card-pass" : "card-warn"}` });
    card.createDiv({ cls: "scholar-card-label", text: label });
    card.createDiv({ cls: "scholar-card-count", text: count === 0 ? "0" : String(count) });
    card.createDiv({ cls: "scholar-card-subtext", text: subtext });
  }

  private async applyAutoFixes(): Promise<void> {
    let content = await this.app.vault.read(this.targetFile);
    let totalFixed = 0;

    // 1. Math Doctor
    const mathRes = this.plugin.mathDoctor.fixMath(content);
    content = mathRes.fixedContent;
    totalFixed += mathRes.fixesCount;

    // 2. Table Converter
    const tableRes = this.plugin.tableConverter.convertAllTables(content);
    content = tableRes.convertedContent;
    totalFixed += tableRes.count;

    // 3. Citation Linker
    const citeRes = this.plugin.citationLinker.optimizeCitationLinks(
      content,
      this.plugin.settings.enforceBlankLinesBetweenRefs
    );
    content = citeRes.optimizedContent;
    totalFixed += citeRes.linksAdded + citeRes.anchorsAdded;

    await this.app.vault.modify(this.targetFile, content);
    new Notice(`已完成自动修复！累计优化/转换 ${totalFixed} 处元素。`);
    await this.runAudit();
  }
}
