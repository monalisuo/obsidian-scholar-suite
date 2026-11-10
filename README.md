# Obsidian Scholar Suite

[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-blueviolet?style=flat-square&logo=obsidian)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/monalisuo/obsidian-scholar-suite?style=flat-square)](https://github.com/monalisuo/obsidian-scholar-suite/releases)

**Obsidian Scholar Suite** 是专为人文社科、经济地理与学术科研工作者打造的高性能学术文献增强套件。

借鉴并融合了 **Zotero-Reference** 与 **ReadCube Papers** 的优秀交互设计，让您在 Obsidian 中阅读 Markdown 论文笔记时，能够右侧实时展现完整的**参考文献网络**、**外部权威施引图谱**、**期刊分区标签（EasyScholar）**，并与本地知识库建立双向穿透链接。此外，套件内置了专为 MinerU 等 OCR 转换工具设计的**多模态论文质检与修复工具箱**。

---

## ✨ 核心特性

### 1. 🎓 Zotero-Reference 级引文网络视窗
- **双栏学术视窗**：
  - **参考文献 (References)**：阅读当前论文时，右侧栏即时呈现该文引用的全部学术文献。
  - **引证文献 (Citations / Cited-by)**：查询有哪些后续学者在顶刊中引用了本文，追踪研究脉络与学术前沿。
- **全格式自适应解析引擎**：
  - 深度适配 **GB/T 7714 顺序编码制**（如 `[1] 作者. 题名[J]. 刊名, 年`）；
  - 完美支持 **APA 著者-出版年制**（如 `Author, A. (2020). Title...`），绝不将作者姓名缩写句点误切；
  - 自动解构国内顶刊（《地理学报》《经济研究》等）特有的**中英双语对照引文**；
  - 智能兼容圈码页下注（`①` `②`）、字间带空格标题（`## 参 考 文 献`）及无标题直接陈列等排版变体。
- **本地知识库双向穿透比对 (Vault Cross-Matching)**：
  - 自动检测引文列表中有哪些论文已存在于您的 Obsidian Vault 中；
  - 已收录文献显示 `[在库]` 徽章，点击即可秒级打开本地对应笔记；
  - 未收录文献支持一键复制 BibTeX 或快速检索。

---

### 2. 🏷️ 权威期刊层级与 EasyScholar 分区标签
集成 EasyScholar 官方开放接口，自动对当前论文及其所有引文的期刊进行智能检索与可视化标记：
- **中文核心**：`[CSSCI]`、`[北大核心]`、`[CSCD]`、`[卓越行动计划]`
- **国际评级**：`[中科院1区Top]`、`[SSCI Q1]`、`[SCI Q1]`、`[JCR Q1]`
- **影响因子与预警提示**：实时显示 JCR 影响因子与官方期刊预警状态。
- **持久层本地缓存**：查询结果自动保存在本地，避免频繁重复请求。

---

### 3. 🌐 开放引文图谱与权威数据补盲
- **多数据源协同**：深度融合 **OpenAlex**、**Elsevier Scopus** 与 **Semantic Scholar**；
- **权威被引频次**：直接展示 Scopus 与 OpenAlex 的真实学术被引数；
- **元数据自动补盲机制**：
  - 本地解析优先（保障中文顶刊 100% 离线秒开）；
  - 若某篇英文笔记正文中未附带参考文献段落，插件将自动调用 OpenAlex 批量 API（`referenced_works`）在线补齐规整的结构化引文。

---

### 4. 🔍 多模态 PDF-to-MD 质检与一键修复
专为 MinerU / GPT-4o 批量转换 PDF 文献后的学术 Markdown 清洗设计：
- **LaTeX 公式防冲突检测**：精准扫描单 `$` 混排、反斜杠 `\$` 误判与 `$$...$$` 跨行闭合异常；
- **表格清洗**：智能识别 OCR 残留的冗长 HTML 表格并转换为标准 Markdown 表格；
- **死链与断链检测**：扫描并修复 `![](images/...)` 缺失的配图与失效的维基链接；
- **排版合规**：一键执行段落间距规范化与参考文献格式标准化。

---

### 5. 📥 Zotero 桌面端无缝协同
- 监听本地 Zotero Connector 与 Local API 端口（23119）；
- 跨端状态实时感知（Zotero 是否在后台运行）；
- 未来扩展一键将未收录的引证论文直接导入 Zotero 专属文献分类中。

---

## 🚀 安装指南

### 方法一：通过 BRAT 插件直接安装（推荐）
1. 在 Obsidian 中安装并启用 **Obsidian42 - BRAT** 插件；
2. 打开 BRAT 设置，点击 `Add Beta plugin`；
3. 输入本仓库地址：`https://github.com/monalisuo/obsidian-scholar-suite`；
4. 点击添加后，在“第三方插件”列表中启用 **Scholar Suite** 即可。

### 方法二：手动安装
1. 前往 [Releases](https://github.com/monalisuo/obsidian-scholar-suite/releases) 下载最新版的发布包；
2. 解压得到 `main.js`、`manifest.json`、`styles.css` 三个文件；
3. 将解压出的文件夹重命名为 `obsidian-scholar-suite`，拷贝至您的知识库目录：
   ```text
   <Your-Vault>/.obsidian/plugins/obsidian-scholar-suite/
   ```
4. 在 Obsidian `设置 -> 第三方插件` 中点击刷新，并开启 **Scholar Suite**。

---

## ⚙️ 配置说明

安装后可在 `设置 -> Scholar Suite 学术套件` 中按需配置：

| 配置项 | 说明 |
| :--- | :--- |
| **Elsevier Scopus API Key** | （推荐配置）用于获取权威的 Scopus 施引文献与被引次数。可前往 [Elsevier Developer Portal](https://dev.elsevier.com/) 免费申请。 |
| **EasyScholar 密钥** | （强烈推荐）用于自动渲染中文期刊 CSSCI / 北大核心与国际 SCI/SSCI 分区标签。可前往 [EasyScholar 官网](https://www.easyscholar.cc/) 个人中心复制。 |
| **Semantic Scholar API Key** | （可选）配置后可提高 Semantic Scholar 的请求频率上限。 |
| **默认文献精读模板路径** | 用于一键创建在库引文笔记时套用的 Templater 模板路径。 |

---

## 🛠️ 本地开发与构建

如果您希望为本项目贡献代码或二次开发：

```bash
# 1. 克隆仓库
git clone https://github.com/monalisuo/obsidian-scholar-suite.git
cd obsidian-scholar-suite

# 2. 安装依赖
npm install

# 3. 开发模式（监听文件改动自动编译）
npm run dev

# 4. 生产环境构建打包
npm run build
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源协议分发与使用。
欢迎提出 Issue 或 Pull Request 共同改进！
