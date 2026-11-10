import { Plugin, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { DEFAULT_SETTINGS, ScholarSuiteSettings } from "./types";
import { ScholarSuiteSettingTab } from "./settings";
import { VaultMatcher } from "./core/vaultMatcher";
import { SemanticScholarClient } from "./api/semanticScholar";
import { CrossrefClient } from "./api/crossref";
import { OpenAlexClient } from "./api/openAlex";
import { ElsevierClient } from "./api/elsevier";
import { EasyScholarClient } from "./api/easyScholar";
import { ZoteroLocalClient } from "./api/zoteroLocal";
import { CnkiBridge } from "./api/cnkiBridge";
import { MathDoctor } from "./core/mathDoctor";
import { TableConverter } from "./core/tableConverter";
import { CitationLinker } from "./core/citationLinker";
import { PdfAligner } from "./core/pdfAligner";
import { ReferenceView, VIEW_TYPE_SCHOLAR_REFERENCE } from "./views/ReferenceView";
import { MultimodalAuditModal } from "./views/MultimodalAuditModal";

export default class ScholarSuitePlugin extends Plugin {
  settings: ScholarSuiteSettings = DEFAULT_SETTINGS;

  // Core Services
  vaultMatcher: VaultMatcher;
  semanticScholarClient: SemanticScholarClient;
  crossrefClient: CrossrefClient;
  openAlexClient: OpenAlexClient;
  elsevierClient: ElsevierClient;
  easyScholarClient: EasyScholarClient;
  zoteroLocalClient: ZoteroLocalClient;
  cnkiBridge: CnkiBridge;
  mathDoctor: MathDoctor;
  tableConverter: TableConverter;
  citationLinker: CitationLinker;
  pdfAligner: PdfAligner;

  async onload(): Promise<void> {
    await this.loadSettings();

    // 1. Initialize services
    this.vaultMatcher = new VaultMatcher(this.app);
    this.semanticScholarClient = new SemanticScholarClient(this.settings.semanticScholarApiKey);
    this.crossrefClient = new CrossrefClient();
    this.openAlexClient = new OpenAlexClient();
    this.elsevierClient = new ElsevierClient(this.settings.elsevierApiKey);
    this.easyScholarClient = new EasyScholarClient(this.settings.easyScholarApiKey);
    this.zoteroLocalClient = new ZoteroLocalClient(this.settings.zoteroPort);
    this.cnkiBridge = new CnkiBridge();
    this.mathDoctor = new MathDoctor();
    this.tableConverter = new TableConverter();
    this.citationLinker = new CitationLinker();
    this.pdfAligner = new PdfAligner(this.app);

    // 2. Index vault on layout ready
    this.app.workspace.onLayoutReady(() => {
      this.vaultMatcher.rebuildIndex();
    });

    // Keep vault index updated on file changes
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.vaultMatcher.rebuildIndex();
      })
    );

    // 3. Register Reference sidebar view
    this.registerView(VIEW_TYPE_SCHOLAR_REFERENCE, (leaf) => new ReferenceView(leaf, this));

    // 4. Ribbon Icon
    this.addRibbonIcon("book-open", "Scholar Suite: 文献引文与多模态复核", () => {
      this.activateReferenceView();
    });

    // 5. Register Commands
    this.addCommand({
      id: "toggle-scholar-reference-view",
      name: "展开/切换文献引文知识网络侧边栏 (Zotero-Reference)",
      callback: () => {
        this.activateReferenceView();
      },
    });

    this.addCommand({
      id: "audit-current-paper-multimodal",
      name: "对当前文献运行多模态质检与格式体检 (Multimodal Audit)",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          if (!checking) {
            this.openMultimodalAuditModal(file);
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "optimize-citation-links",
      name: "为当前文献注入/优化双向引文锚点与跳转链接 (Style B)",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          if (!checking) {
            this.optimizeActiveFileCitations(file);
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "convert-html-tables",
      name: "将当前文献中的 HTML 表格转换为 Markdown 管道表格",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          if (!checking) {
            this.convertActiveFileTables(file);
          }
          return true;
        }
        return false;
      },
    });

    // 6. Settings tab
    this.addSettingTab(new ScholarSuiteSettingTab(this.app, this));

    // 7. Auto-open sidebar when navigating to scholarly paper if enabled
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || file.extension !== "md") return;
        if (this.settings.autoOpenSidebar) {
          const cache = this.app.metadataCache.getFileCache(file);
          const hasDoi = Boolean(cache?.frontmatter?.doi);
          const hasCitekey = Boolean(cache?.frontmatter?.citekey);
          const isLiterature = file.path.includes("文献/");

          if (hasDoi || hasCitekey || isLiterature) {
            const refView = this.getReferenceView();
            if (refView) {
              refView.refreshForActiveFile();
            }
          }
        }
      })
    );
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SCHOLAR_REFERENCE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.semanticScholarClient) {
      this.semanticScholarClient.setApiKey(this.settings.semanticScholarApiKey);
    }
    if (this.elsevierClient) {
      this.elsevierClient.setApiKey(this.settings.elsevierApiKey);
    }
    if (this.easyScholarClient) {
      this.easyScholarClient.setSecretKey(this.settings.easyScholarApiKey);
    }
    if (this.zoteroLocalClient) {
      this.zoteroLocalClient.setPort(this.settings.zoteroPort);
    }
  }

  public getReferenceView(): ReferenceView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SCHOLAR_REFERENCE);
    if (leaves.length > 0) {
      return leaves[0].view as ReferenceView;
    }
    return null;
  }

  public async activateReferenceView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_SCHOLAR_REFERENCE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_SCHOLAR_REFERENCE,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      const view = leaf.view as ReferenceView;
      await view.refreshForActiveFile();
    }
  }

  public openMultimodalAuditModal(file: TFile): void {
    new MultimodalAuditModal(this.app, this, file).open();
  }

  public async optimizeActiveFileCitations(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const result = this.citationLinker.optimizeCitationLinks(
      content,
      this.settings.enforceBlankLinesBetweenRefs
    );

    if (result.changed) {
      await this.app.vault.modify(file, result.optimizedContent);
      new Notice(`引文双向链接优化完成！+${result.linksAdded} 正文跳转链接，+${result.anchorsAdded} 块锚点`);
    } else {
      new Notice("当前笔记引文链接已处于最优状态，无需更新。");
    }
  }

  public async convertActiveFileTables(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const result = this.tableConverter.convertAllTables(content);

    if (result.count > 0) {
      await this.app.vault.modify(file, result.convertedContent);
      new Notice(`已成功将 ${result.count} 个 HTML 表格转换为标准 Markdown 管道表格！`);
    } else {
      new Notice("当前笔记未包含 HTML <table> 结构。");
    }
  }
}
