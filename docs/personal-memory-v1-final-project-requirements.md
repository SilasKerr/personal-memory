# Personal Memory v1 — Final Project Requirements

**Status: Draft for final confirmation**

本文件定义 Personal Memory v1 的最终交付范围与验收标准。

它不是具体代码设计，也不替代 Project / Commit / Experience 等领域契约。

后续实现必须同时遵守：

1. 本文件定义的 v1 scope
2. 已确认的领域契约
3. 后续确认的 SaveProposal / ChangeSet / Storage Mapping 契约

若实验性代码与契约冲突，以契约为准。

---

# 1. 产品定位

Personal Memory v1 是：

**供外部 Host Agent 调用的、本地优先的个人项目知识库工具。**

典型 Host Agent：

- Codex
- Claude Code
- Cursor
- 其他支持 MCP / tool calling 的 Agent

Personal Memory 本身：

- 没有聊天界面
- 不是独立客户端
- 不是第二个 Agent
- 不自主观察用户
- 不主动产生任务
- 不主动决定什么时候保存
- 不在 v1 内部调用第二个 LLM 重新理解当前项目

核心原则：

```text
LLM reasoning
属于 Host Agent

Memory management
属于 Personal Memory
```

Host Agent 负责语义理解。

Personal Memory 负责可靠、确定性的知识管理。

---

# 2. 核心用户体验

用户平时在 Host Agent 中完成项目。

Personal Memory 不主动打断工作流。

当一个问题解决、一个认知阶段结束、项目暂停或项目完成时，用户主动要求：

> 帮我整理一下项目，然后保存到我的记忆中。

流程必须是：

```text
用户主动触发
↓
Host Agent 根据已有上下文完成总结和知识判断
↓
Host Agent 生成结构化 SaveProposal
↓
Personal Memory 验证并准备 ChangeSet
↓
返回 Memory Commit Preview
↓
用户明确确认
↓
Personal Memory Apply 同一个 ChangeSet
↓
写入 Obsidian Vault
```

正式知识在用户确认前不得改变。

---

# 3. Project First

Personal Memory 对人首先应该表现为：

**个人项目档案馆。**

用户打开 Obsidian 后，应优先看到：

```text
Projects
├── Project A
├── Project B
├── Project C
└── ...
```

Project 是人的主要入口。

Experience 是跨项目知识层，而不是知识库首页。

---

# 4. 三个核心领域对象

v1 只有三个核心知识对象：

```text
Project
Commit
Experience
```

不要新增 People、Topics、Resources、Task、Agent State 等一级领域对象。

---

# 5. Project

Project 表示：

**当前已被接受的项目可信状态。**

核心语义：

```text
Project = 当前真相
```

Project 是 mutable。

它必须保持简短，让用户或 Host Agent 能够快速恢复：

- 项目名称
- 当前目标
- 当前状态
- 当前有效决定
- 当前未决问题
- 当前下一步
- lifecycle
- revision / machine metadata

Project 不保存完整历史。

已失效决定、已解决问题、已完成步骤应退出当前 Project。

历史由 Commit 保留。

Project Domain Contract v1 是其行为的权威定义。

---

# 6. Commit

Commit 表示：

**一个认知阶段结束时的项目历史记录。**

核心语义：

```text
Commit = 当时的真相
```

Commit：

- 不是操作日志
- 不是命令日志
- 不是每日记录
- 不是 Project field diff

它记录：

- 阶段从什么理解出发
- 发现了什么
- 哪些认知发生改变
- 做出了什么决定
- 为什么决定
- 放弃了什么
- 为什么放弃
- 阶段结束时如何看待项目
- 当时仍有哪些问题与下一步

Commit 原则上 immutable。

后续发现旧认知错误时，通过新的 Commit 修正，不改写旧历史。

Commit Domain Contract v1 是其行为的权威定义。

---

# 7. Experience

Experience 表示：

**从实际项目中提炼出的、未来遇到类似问题时可复用的知识。**

Experience 不是：

- 项目日志
- 聊天摘要
- 一次性过程信息
- 每次操作产生的 memory 卡片

标题应尽量直接表达结论。

Experience 内容：

**结构完整，但允许稀疏。**

没有真实内容的栏目不得填充“暂无 / N/A / 无”。

长期方向支持：

```text
create
enrich
merge
supersede
abstract
```

但 v1 实现必须收缩。

---

# 8. Experience v1 实现范围

v1 第一版只实现：

```text
create
enrich
```

## create

创建新的可复用 Experience。

## enrich

已有 Experience 的核心知识仍成立，在同一 identity 上补充：

- 新证据
- 新案例
- 新限制
- 新适用条件
- 更准确表达
- 更成熟做法

Enrich 保持 Experience ID，不创建近似重复条目。

---

# 9. Experience 暂缓能力

以下能力属于长期领域方向，但不进入第一版可执行范围：

```text
merge
supersede
archive
abstract
```

v1 的数据模型与存储设计不得故意阻止未来加入这些能力。

但当前：

- 不实现 mutation API
- 不实现自动判断
- 不实现自动 lifecycle transition
- 不为它们增加额外工作流复杂度

Experience Contract 在最终确认时应明确区分：

```text
domain future capability
vs
v1 executable capability
```

---

# 10. Experience 成熟度

Experience 保留：

```text
candidate
validated
principle
```

它表示知识成熟度，不是：

- confidence score
- search ranking
- low / medium / high 权重

maturity 的语义判断由 Host Agent 提议、用户确认。

Personal Memory 不自行升级或降级。

---

# 11. Host Agent 的责任

Host Agent 负责：

- 理解当前项目上下文
- 总结本阶段变化
- 判断什么值得长期保存
- 构造 Project 目标状态
- 撰写 Commit 的阶段叙述
- 判断是否产生 Experience
- 判断 Experience 应 create 还是 enrich
- 提供 Experience 的语义内容
- 向用户解释 Preview
- 用户确认后调用 Apply

Personal Memory 不重复执行上述语义判断。

---

# 12. Personal Memory 的责任

Personal Memory v1 负责：

- 读取 Project / Commit / Experience
- 搜索已有知识
- schema validation
- ID 管理
- revision 管理
- provenance / reference validation
- Commit sequence 管理
- SaveProposal validation
- ChangeSet preparation
- Preview generation
- 用户确认后的 Apply
- conflict detection
- basic concurrency protection
- Markdown rendering
- Obsidian Vault persistence
- derived index rebuild

Personal Memory 的行为应尽可能：

**笨，但可靠。**

---

# 13. SaveProposal

SaveProposal 是：

**Host Agent 已经完成语义判断后，提交给 Personal Memory 的结构化输入。**

它不是：

- 原始聊天
- Prompt
- Agent reasoning request
- 最终 Markdown
- 长期知识对象

v1 SaveProposal 保持 project-scoped。

最小表达：

```text
project_id
base project state

project target

commit proposal

experience proposals:
  create
  enrich

ignored information
```

SaveProposal 不持久化为新的一级知识对象。

具体最终字段由 SaveProposal Domain Contract v1 确认。

---

# 14. ChangeSet

ChangeSet 是：

**Personal Memory 根据合法 SaveProposal 准备出的、无歧义的确定性待执行变更。**

ChangeSet 必须满足：

```text
Preview
=
用户确认的内容
=
Apply 最终执行的内容
```

用户确认后不得重新调用 Host Agent 或 LLM 再总结一次。

ChangeSet 至少需要支持：

- pending
- applied
- rejected
- conflict handling

具体状态、幂等性、失败与重试规则由 ChangeSet Domain Contract v1 确认。

---

# 15. 人工确认是硬边界

所有长期知识修改必须经过：

```text
Prepare
↓
Preview
↓
Explicit User Confirmation
↓
Apply
```

不得提供正常 Agent 可调用的绕过入口，例如：

- direct project update
- direct commit create
- direct experience write
- prepare_and_apply
- save_without_confirmation

底层维护工具若未来存在，也不能成为 Host Agent 的普通写接口。

---

# 16. Markdown / Obsidian

Obsidian 是：

- 本地查看界面
- 人工浏览工具
- 人工审计工具
- 项目档案馆界面

Markdown 是：

**human-readable canonical content。**

原则：

```text
正文服务于人
metadata 服务于机器
```

Host Agent 不直接生成或自由编辑最终 Markdown 格式。

Host Agent 提供结构化语义。

Personal Memory 使用统一 Renderer 输出 Markdown / YAML。

---

# 17. 人工编辑

Project：

人工语义编辑不能在 revision 不变的情况下静默成为普通可信状态。

Memory 必须检测 external modification，并通过已确认的 adopt / reconcile 规则接纳。

Commit：

历史语义不能通过人工编辑静默改写。

Experience：

人工修改不能绕过 revision 和 provenance。

具体行为遵循相应 Domain Contract。

---

# 18. ID 原则

所有核心对象：

- Project
- Commit
- Experience

使用：

**system-generated opaque immutable ID。**

ID：

- 不依赖 title
- 不依赖 name
- 不依赖 filename
- 不依赖 directory
- 不依赖 sequence

人类可读路径与机器 ID 分离。

---

# 19. Revision 与并发

Project 与 Experience 是 mutable，因此需要 revision。

规则：

- 新对象 revision = 1
- 正式语义更新 revision +1
- no-op 不增加 revision
- created_at 不改变
- updated_at 随有效更新改变

Commit 是历史对象，不使用普通 mutable revision。

多个 Agent 使用同一个 Vault 时：

- Prepare 绑定基准 revision / history head
- Apply 前重新验证
- stale state 返回 conflict
- 不自动 merge
- 不静默覆盖

v1 使用简单本地 concurrency protection 即可。

不引入 distributed locking 或复杂事务系统。

---

# 20. Search v1

Search 的目标：

**高精度，而不是大量召回。**

v1 搜索优先：

- metadata
- 普通文本
- project scope
- lifecycle / maturity filter

实现可以先使用简单全文检索或 SQLite FTS5。

但搜索契约不得绑定某一种实现。

v1 不要求：

- vector database
- embedding pipeline
- semantic vector retrieval
- reranker
- cloud search

如果简单搜索已满足真实使用，不增加复杂度。

---

# 21. Retrieval 原则

默认读取应保持 token 克制。

优先：

```text
轻量摘要
↓
Agent 判断是否需要
↓
读取完整正文
```

不要一次把整个 Vault、所有 Commit 或所有 Experience 塞给 Host Agent。

Project 是恢复当前工作的第一入口。

Commit 历史按需读取。

Experience 按相关性按需读取。

---

# 22. 多 Agent

多个 Agent 应共用：

**同一个 Personal Memory / 同一个 Vault。**

例如：

```text
Codex
Claude
Cursor
其他 Agent
   ↓
Personal Memory
   ↓
同一份 Obsidian Vault
```

Agent 不应各自维护独立的长期 memory 副本。

所有正式写入应经过 Personal Memory 的统一写入规则。

---

# 23. MCP

v1 推荐使用 MCP 作为 Host Agent 接口。

MCP 只是 transport / tool layer。

业务规则不得写死在 MCP handler 中。

最终 Agent 可见的写入入口应保持极少。

至少需要支持：

- Project read
- Commit read
- Experience read
- Search
- prepare save
- get pending preview / changeset
- apply confirmed changeset
- reject changeset

不暴露通用：

- read_file
- write_file
- edit_markdown
- delete_file

---

# 24. v1 明确不做

Personal Memory v1 不实现：

- 独立聊天客户端
- 自主 Memory Agent
- 后台持续监听
- proactive capture
- 自动决定保存时机
- 自动无确认写入
- 全量聊天归档
- 自动知识整理
- 自动 merge
- 自动 supersede
- automatic abstract
- standalone knowledge maintenance workflow
- complex knowledge graph
- vector database
- cloud-first storage
- multi-user collaboration
- permissions system
- Web UI
- 必需的 Obsidian Plugin
- Git-based knowledge semantics
- confidence scoring system
- trust ladder
- automatic expiration

---

# 25. v1 最小闭环

v1 必须证明下面这条真实路径可以工作：

```text
Host Agent A
↓
读取已有 Project
↓
继续项目工作
↓
用户主动要求保存
↓
Host Agent A 生成：
Project target
Commit
Experience create/enrich
↓
Personal Memory prepare
↓
Preview
↓
用户确认
↓
Apply
↓
Markdown / Obsidian
↓
新的 Host Agent B
↓
读取同一个 Project
↓
正确恢复当前状态
↓
按需查看历史 Commit / Experience
```

如果这条链稳定可用，v1 即成立。

---

# 26. 核心验收场景

## A. Project recovery

新的 Agent 能通过 Personal Memory：

- 找到 Project
- 读到当前目标
- 当前状态
- 当前决定
- 未决问题
- 下一步

并能在短上下文中恢复项目。

## B. Stage save

一次认知阶段结束后：

- Agent 提交结构化 SaveProposal
- Prepare 不修改正式知识
- Preview 准确展示拟保存内容
- 用户确认后 Apply
- Project 更新
- Commit 创建
- Experience create/enrich 正确执行

## C. Rejection

用户拒绝 Preview 后：

正式 Project / Commit / Experience 不发生改变。

## D. Conflict

Agent A Prepare 后，Agent B 先完成新写入。

Agent A 再 Apply：

必须返回 conflict。

不得覆盖 Agent B 的内容。

## E. Experience reuse

另一个项目中可以搜索已有 Experience。

Agent 能读取并利用已有经验，而不需要重新读取原项目全部历史。

## F. Human readability

用户直接打开 Obsidian：

无需理解数据库、JSON 或 Agent 内部状态，即可理解项目当前状态和历史。

---

# 27. 工程验收

v1 发布前至少必须满足：

```text
fresh checkout
↓
npm ci
↓
npm run typecheck
↓
npm test
```

全部成功。

仓库不得依赖：

- 本机绝对路径 symlink
- 已存在的外部 node_modules
- 未提交的关键契约文件

所有已确认 Domain Contract 必须进入 Git。

---

# 28. 契约优先级

后续实现时权威顺序：

```text
Final Project Requirements
↓
Confirmed Domain Contracts
↓
Confirmed SaveProposal / ChangeSet Contracts
↓
Storage / API / MCP Implementation Contracts
↓
Code
```

代码与契约冲突时：

**修改代码，不迁就旧实现。**

---

# 29. 当前契约状态

目前：

```text
Project Domain Contract      Confirmed
Commit Domain Contract       Confirmed
Experience Domain Contract   Draft / 需按 v1 scope 收缩后确认
SaveProposal Contract        Draft / 需按 v1 scope 收缩后确认
ChangeSet Contract           未开始
Storage Mapping              未开始
Implementation Gap Analysis  未开始
```

在重新进入代码开发前，应先完成这些契约。

---

# 30. 仓库当前必须修正的文档问题

最新项目压缩包中：

- `docs/commit-domain-contract-v1.md` 存在
- `docs/experience-domain-contract-v1.md` 存在
- 已确认的 Project Domain Contract 未出现在该压缩包的 `docs/` 目录
- `docs/` 当前仍未被 Git 跟踪

在进入实现阶段前必须：

1. 恢复 / 加入 Project Domain Contract
2. 将所有确认契约纳入 Git
3. 保证新的 Codex session 可以只读仓库文档恢复项目规则

---

# 31. v1 成功标准

成功不是：

```text
Memory 数量很多
功能很多
Agent 看起来很智能
```

成功是：

> 使用几个月以后，用户仍然可以快速知道自己做过哪些项目、这些项目如何演变、为什么做过关键决定，以及从实践中真正学到了什么。

v1 的工程目标更具体：

> 用最小、可靠、可维护的本地工具，证明 Project / Commit / Experience + 人工确认这一核心闭环真实可用。

任何不能直接帮助验证这个闭环的复杂功能，都应推迟。
