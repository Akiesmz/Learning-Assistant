# AI Smart Learning Assistant（本地 RAG 学习助手）

一个基于 **RAG (检索增强生成)** 技术的本地智能学习助手。专为个人知识管理和深度学习设计，它将你的 PDF/DOCX/TXT/MD 等资料上传到本机后端，通过深度解析、语义分块、双重检索和知识可视化，帮助你高效管理和内化知识。

---

## 🌟 核心特点

- **🛡️ 本地优先 (Local-First)**：文档、向量库、索引和学习数据默认存储在本地目录，确保绝对的数据隐私和安全。
- **🧠 深度语义理解**：摒弃机械切分，采用**语义分块 (Semantic Chunking)**，确保知识片段的完整性。
- **🔍 双重检索架构**：结合 **FAISS 快速召回** 与 **BGE 重排序 (Rerank)**，在海量文档中精准定位答案，显著降低幻觉。
- **🕸️ 知识图谱 (KG)**：自动提取实体与关系，并引入**社区检测**算法，直观展示知识结构与聚类。
- **⚡ 实时流式反馈**：全链路 SSE 流式输出，从检索过程到 AI 思考，毫秒级响应。
- **📚 学习闭环**：从文档解析 -> 知识提取 -> 问答解惑 -> 闪卡/测验，打造完整的学习工作流。

---

## 🚀 深度技术解析

本项目在 RAG 流程的每个关键环节都进行了深度优化，以解决传统 RAG 系统“检索不准、回答空泛”的痛点。

### 1. 多模态深度解析 (Advanced Document Parsing)
为了解决 "Garbage In, Garbage Out" 问题，我们实现了智能分流解析策略：
- **MinerU 高精度解析**：针对排版复杂的 PDF（多栏、表格、公式），集成 **MinerU API** (基于 LayoutLMv3)。它能精准识别文档结构，将 PDF 转换为高质量 Markdown，保留标题层级和表格逻辑。
- **智能回退机制**：若未配置 MinerU 或解析非 PDF 文档，自动降级使用本地解析器（`pdfplumber` for PDF, `python-docx` for Word），并配合正则清洗算法去除噪声。

### 2. 语义感知分块 (Semantic Chunking)
传统的固定字符数切分往往会切断上下文。我们采用 **语义分块** 策略：
- **动态阈值切分**：基于 `langchain_experimental.text_splitter.SemanticChunker`，利用 `Nomic Embeddings` 模型计算相邻句子的语义相似度。当相似度低于阈值时（意味着话题转换），自动进行切分。
- **递归优化**：系统具备自适应修正能力 (`_refine`)，对于语义切分后依然过长的片段（>900字符），使用递归字符切分器 (`RecursiveCharacterTextSplitter`) 进行二次细化，确保每个 Chunk 既包含完整语义，又适配 Embedding 模型窗口。

### 3. 双重检索架构 (Hybrid Search & Rerank)
为了平衡检索的**召回率 (Recall)** 和 **准确率 (Precision)**，系统采用两阶段检索：
- **第一阶段：高召回 (Recall)**
    - 使用 **FAISS** 构建内存级向量索引，配合 **ChromaDB** 持久化存储。
    - 利用 `nomic-embed-text-v2-moe` 模型（768维，8k上下文）快速召回 Top-20 相关片段。
- **第二阶段：高准确 (Precision)**
    - 引入 **FlagReranker** (`bge-reranker-v2-m3`) 交叉编码模型。
    - 对 User Query 与召回的 Candidate Passages 进行逐一精细打分 (`compute_score`) 和重排序，筛选出 Top-3 最强相关片段。
    - **效果**：彻底解决 "Lost in the Middle" 现象，让 LLM 聚焦于真正的核心信息。

### 4. 增强型知识图谱 (Enhanced Knowledge Graph)
不仅仅是文本检索，我们还致力于结构化知识：
- **实体与关系抽取**：结合 Spacy (NER) 和 LLM，从非结构化文本中提取实体（Person, Concept, Event...）及其语义关系，并保存边的描述信息。
- **社区检测 (Community Detection)**：引入 `NetworkX` 的 **Greedy Modularity** 算法，自动发现图谱中的紧密知识簇（Community）。这为未来的“全局摘要”和跨文档推理奠定了基础。
- **实体对齐**：内置基础实体对齐逻辑（如单复数处理），减少图谱中的冗余节点。

---

## 🏗️ 系统架构与数据流

### 架构设计
```mermaid
graph TD
    User([用户 User]) <--> Frontend[前端 Frontend (Next.js)]
    Frontend <--> Backend[后端 Backend (FastAPI)]
    
    subgraph "Data Processing Pipeline (数据处理流水线)"
        direction TB
        DocSvc[Document Service] --> |1. Parse| Parser{解析器 Router}
        Parser --> |Complex PDF| MinerU[MinerU API]
        Parser --> |Simple/Local| LocalParser[Local Parser]
        MinerU --> Markdown
        LocalParser --> Markdown
        Markdown --> |2. Clean & Chunk| Chunker[Semantic Chunker]
        
        Chunker --> |3. Embed| EmbedModel[Nomic Embeddings]
        EmbedModel --> VectorDB[(Vector DB: Chroma + FAISS)]
        
        Chunker --> |Async Extract| KGSvc[KG Service]
        KGSvc --> |NER & Community| GraphDB[NetworkX Graph]
    end
    
    subgraph "Inference Pipeline (推理流水线)"
        direction TB
        SearchSvc[Vector Service] --> |1. Recall (Top-20)| FAISS
        FAISS --> |Candidates| Reranker[BGE Reranker]
        Reranker --> |2. Rerank (Top-3)| Context
        Context --> LLM[LLM Service]
        LLM --> |Stream Response| StreamOut[SSE Stream]
    end

    Backend --> DocSvc
    Backend --> SearchSvc
    
    style User fill:#f9f,stroke:#333,stroke-width:2px
    style Frontend fill:#e1f5fe,stroke:#333
    style Backend fill:#e8f5e9,stroke:#333
    style VectorDB fill:#fff3e0,stroke:#333
    style GraphDB fill:#fff3e0,stroke:#333
```

### 核心模块
| 模块 | 职责 | 关键技术 |
| :--- | :--- | :--- |
| **DocumentService** | 文档解析与分块 | MinerU API, SemanticChunker, RecursiveSplitter |
| **VectorService** | 向量存储与检索 | ChromaDB, FAISS, Nomic Embeddings, BGE Reranker |
| **KGService** | 知识图谱构建 | Spacy, NetworkX, Greedy Modularity Community |
| **LLMService** | 大模型交互 | OpenAI Compatible SDK, Prompt Engineering |
| **ConfigService** | 配置安全管理 | Fernet (Symmetric Encryption) |
| **FlashcardService** | 闪卡记忆算法 | SM-2 (SuperMemo-2) Spaced Repetition |

---

## 📦 功能概览

- **📚 文档库管理**：支持上传、列表、删除。上传即自动触发解析、向量化与图谱构建流水线。
- **💬 深度 RAG 问答**：
    - **混合检索**：结合语义向量与重排序。
    - **引用溯源**：回答中自动标注 `[1]` 引用来源，支持点击高亮原文。
    - **深度思考**：支持开启/关闭 AI 的深度推理模式。
- **🕸️ 交互式知识图谱**：力导向图展示实体关系，支持缩放、拖拽、社区着色。
- **📝 智能摘要**：自动为每个文档生成结构化摘要，快速把握核心。
- **🗂️ 闪卡与测验**：
    - **一键制卡**：从对话中一键生成 Anki 风格闪卡。
    - **间隔复习**：严格实现 **SM-2 算法**，根据用户自评（忘/难/中/易）动态调整复习间隔 (`Ease Factor` 自适应调整)，确保记忆效率最大化。
    - **自动测验**：AI 出题并自动判分，巩固薄弱点。
- **📊 学习仪表盘**：可视化统计学习时长、提问数、记忆曲线。
- **🎨 沉浸式 UI**：
    - **无感刷新**：前端静默轮询，状态更新不闪烁。
    - **现代设计**：悬浮输入框、毛玻璃效果、品牌色渐变气泡、数学公式渲染 (KaTeX)。

---

## 🛠️ 部署与使用

### 环境要求
- **Python**: 3.10+ (推荐 3.11)
- **Node.js**: 18+ (推荐 20+)
- **RAM**: >= 8GB (运行本地 Embedding/Reranker 模型需要)
- **LLM**: 任意 OpenAI 兼容接口 (推荐本地 LM Studio 或在线 API)

### 🚀 一键启动
直接运行根目录下的启动脚本：
```bash
python run.py
```
> 脚本会自动检测环境、安装依赖，并同时启动后端 API (Port 8000) 和前端页面 (Port 5173)。

### 🔧 手动部署
**1. 后端**
```bash
cd backend
pip install -r requirements.txt
# Windows PowerShell 启动 (防止依赖冲突)
$env:PYTHONNOUSERSITE=1; python -m uvicorn app.main:app --reload --port 8000
```

**2. 前端**
```bash
cd frontend
npm install
npm run dev
```

### 🔑 配置 MinerU (可选)
为了获得最佳 PDF 解析体验：
1. 在前端文档列表页，点击上方的 **🔑 (Key)** 按钮。
2. 输入您的 MinerU API Token。
3. 系统会将 Token 加密存储在本地 `user_data` 中。
4. 上传 PDF 时，解析模式选择 "MinerU" 或 "Auto"。

---

## 📂 项目结构

```text
agent/
├── backend/
│   ├── app/
│   │   ├── api/            # 路由层 (chat, documents, config...)
│   │   ├── core/           # 核心配置
│   │   ├── services/       # 业务逻辑 (Document, Vector, KG, LLM)
│   │   └── models/         # 本地模型权重 (Nomic, BGE)
│   ├── user_data/          # 用户数据 (加密配置, 索引, 图谱, SQLite)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/     # UI 组件 (Chat, DocumentList, Graph)
│   │   ├── store/          # 状态管理 (Zustand)
│   │   └── app/            # 页面路由
│   └── package.json
└── run.py                  # 聚合启动脚本
```

## 🗺️ Roadmap (规划中)
- [ ] **多模态问答**：支持图片内容的理解与检索。
- [ ] **全局思维导图**：基于知识图谱自动生成全库思维导图。
- [ ] **移动端适配**：推出 PWA 版本，方便随时随地复习。
