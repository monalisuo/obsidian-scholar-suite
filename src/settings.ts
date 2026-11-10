import { App, PluginSettingTab, Setting } from "obsidian";
import type ScholarSuitePlugin from "./main";
import { DEFAULT_SETTINGS, ScholarSuiteSettings } from "./types";

export class ScholarSuiteSettingTab extends PluginSettingTab {
  plugin: ScholarSuitePlugin;

  constructor(app: App, plugin: ScholarSuitePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Scholar Suite 学术套件设置" });

    containerEl.createEl("h3", { text: "引文知识网络设置 (Zotero-Reference)" });

    new Setting(containerEl)
      .setName("Semantic Scholar API 密钥 (可选)")
      .setDesc("配置 API Key 可大幅提高每分钟请求配额并避免 429 限频。若无则使用公共低频接口。")
      .addText((text) =>
        text
          .setPlaceholder("输入您的 Semantic Scholar API Key")
          .setValue(this.plugin.settings.semanticScholarApiKey)
          .onChange(async (value) => {
            this.plugin.settings.semanticScholarApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Elsevier Scopus API 密钥 (爱思唯尔)")
      .setDesc("配置爱思唯尔 API Key 可解锁 Scopus 官方引证检索、期刊权威被引频次与元数据验证。")
      .addText((text) =>
        text
          .setPlaceholder("输入您的 Elsevier Scopus API Key")
          .setValue(this.plugin.settings.elsevierApiKey)
          .onChange(async (value) => {
            this.plugin.settings.elsevierApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("EasyScholar 密钥 (期刊评级与分区标签)")
      .setDesc("配置 EasyScholar 开放接口 Key，自动标记 CSSCI、北大核心、CSCD、中科院分区、SSCI、Top期刊及影响因子。")
      .addText((text) =>
        text
          .setPlaceholder("输入您的 EasyScholar Secret Key")
          .setValue(this.plugin.settings.easyScholarApiKey)
          .onChange(async (value) => {
            this.plugin.settings.easyScholarApiKey = value.trim();
            if (this.plugin.easyScholarClient) {
              this.plugin.easyScholarClient.setSecretKey(value.trim());
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("首选学术数据源")
      .setDesc("拉取参考文献与施引文献时的优先接口")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("semanticscholar", "Semantic Scholar (推荐，支持被引数与权威引证)")
          .addOption("crossref", "Crossref (官方 DOI 注册库，结构化引文完整)")
          .addOption("openalex", "OpenAlex (全球开放学术图谱)")
          .setValue(this.plugin.settings.preferredApi)
          .onChange(async (value: any) => {
            this.plugin.settings.preferredApi = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Zotero 本地 API 端口")
      .setDesc("Zotero 桌面端运行监听的本地 HTTP 端口 (默认 23119)")
      .addText((text) =>
        text
          .setPlaceholder("23119")
          .setValue(String(this.plugin.settings.zoteroPort))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.zoteroPort = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("新建文献笔记模板路径")
      .setDesc("当从引文侧边栏点击【一键收录】新建卡片时使用的模板文件相对路径")
      .addText((text) =>
        text
          .setPlaceholder("模板/论文精读模板.md")
          .setValue(this.plugin.settings.defaultTemplatePath)
          .onChange(async (value) => {
            this.plugin.settings.defaultTemplatePath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("阅读文献时自动展开侧边栏")
      .setDesc("当切换到带有 DOI 或学术元数据的文献笔记时，自动在右侧激活 Scholar Reference 面板")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOpenSidebar)
          .onChange(async (value) => {
            this.plugin.settings.autoOpenSidebar = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "多模态复核与格式规范设置 (Multimodal Review)" });

    new Setting(containerEl)
      .setName("参考文献条目间强制空行")
      .setDesc("在自动生成 ^refN 块锚点时，强制在每个参考文献条目之间插入空行，确保 Obsidian 块链接正常渲染")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enforceBlankLinesBetweenRefs)
          .onChange(async (value) => {
            this.plugin.settings.enforceBlankLinesBetweenRefs = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
