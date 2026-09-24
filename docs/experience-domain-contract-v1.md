# Experience Domain Contract v1 — Confirmed

**状态：Confirmed。** 本契约按《Personal Memory v1 — Final Project Requirements》收缩 v1 范围。现有代码是实验性参考，本轮不修改代码，也不定义 SaveProposal、ChangeSet、Search 或 MCP 接口。

## 1. Definition and responsibility

Experience 是从项目实践提炼、以后可在类似情境复用的**当前已接纳知识**。Project 保存项目当前真相；Commit 保存当时的认知阶段；Experience 保存可复用结论、适用条件及依据。Experience 不是项目复盘、操作日志、聊天摘录或无限追加的记忆卡片。

v1 可执行的 Experience mutation **只有 `create` 和 `enrich`**。一次保存可以没有 Experience 变化。Host Agent 理解语义、提出内容及 create/enrich 判断；用户确认；Personal Memory 负责确定性验证、系统 ID、revision、引用、冲突、ChangeSet、Preview 与持久化。Memory 不用额外 LLM 自行判断一条知识是否值得创建、是否真的属于 enrich、应否升为 principle。

## 2. Identity rules

`id` 由系统生成，opaque、不可变，不依赖标题、正文、Markdown 文件名或路径；具体编码交给 storage mapping。Experience 的身份对应一条持续成立的核心知识，而不是某次措辞。

标题优化、`core_statement` 精炼、证据增加、适用条件或限制补充、recommended action 改善、maturity 变化，均可保持同一 ID。Enrich 必须保持目标 ID。若核心主张已经不成立，Host Agent 不应把实质替代伪装成 enrich；v1 不因此自动执行未来的 supersede 操作。

## 3. Field contract

| 字段 | v1 规则 |
| --- | --- |
| `id` | 必需；系统生成、opaque、不可变。 |
| `title` | 必需；结论型表述是内容质量目标。规范化首尾与连续空白后须非空，且不能是“暂无”“N/A”“无”等占位文本；Memory 不评价标题质量。 |
| `core_statement` | 必需；可独立阅读的可复用核心结论，非空且非占位。v1 不另存同义的 `summary`。 |
| `context` | 可选；结论适用的背景，不复写完整 Project 状态。 |
| `evidence` | 可选；支持结论的简要实践证据或案例，不写成阶段过程日志。 |
| `applies_when` | 可选；适用条件。 |
| `limitations` | 可选；已知边界、反例或限制。 |
| `recommended_action` | 可选；以后遇到类似情境可采取的做法。 |
| `maturity` | 必需；`candidate / validated / principle`。 |
| `source_commits` | 必需的 Commit ID 集合，可为空；唯一持久化的来源关系字段。来源 Project 从各 Commit 的 `project_id` 派生。 |
| `revision` | 必需；系统管理的已接纳当前状态版本，初始 1。 |
| `created_at` | 必需；系统正式接纳创建时设置，不可变。 |
| `updated_at` | 必需；系统正式接纳最近一次有效变化时设置；创建时等于 `created_at`。 |

语义字段**结构完整、内容允许稀疏**：可选字段没有内容就省略，不生成“暂无”“N/A”“无”等占位。`problem`、`attempts`、`outcome`、turning point 等阶段过程主要属于 Commit；`why_it_works` 可融入 evidence，`failure_mode` 可融入 limitations，原 `recommended_future_action` 统一为 `recommended_action`。本契约定义语义，不决定 Markdown 渲染格式。

v1 不持久化 `source_projects`，也不含 lifecycle、merge/supersede 关系、`abstracted_from` 或 tags/topics。若 `source_commits` 为空，v1 无法从该字段推导来源 Project；不得猜测或另存一份独立权威关系。

## 4. Maturity rules

- `candidate`：主张已有明确可复用内容，但仍待更多实践验证。
- `validated`：有可说明的实践结果支持，适用条件与关键限制足以供后续使用。
- `principle`：在更广泛或不同情境下表现稳定，形成较通用的做法与边界；不保证永远正确。

Maturity 表示**知识成熟度**，不是 confidence、importance、search ranking 或 trust ladder 分数。Host Agent 提议 maturity 及理由，用户确认，Memory 执行；Memory 不自动升级或降级。允许经确认的升级、降级或跳级，不用固定项目数假装语义判断。

Maturity 改变是 Experience semantic state change：revision 恰好加 1，`updated_at` 更新。v1 通过 enrich 的完整目标状态表达 maturity 修订；若同次 enrich 还修改其他字段，仍只形成一个新 revision。maturity 本身不强制创建 Commit；Project 契约规定的同步 Project 更新仍须遵守其 Commit 要求。

## 5. Create rules

Host Agent 提出必需语义字段、可选内容、maturity 与可用的来源 Commit，用户审阅 Preview 并确认。Memory 验证结构与引用，不判断是否“值得记住”。maturity 未明确提出时默认为 `candidate`；明确提出其他合法值须在 Preview 中可见。

Apply 创建新的 opaque ID，`revision = 1`，`created_at` 为系统正式接纳时间，`updated_at = created_at`。Prepare 冻结用户确认的语义内容；Apply 补入 ID、时间等机器元数据不应重新总结或改变它。提议者不得自行指定这些机器控制字段。

## 6. Enrich rules

Enrich 表示已有 Experience 的核心知识仍成立，而新项目实践使它更完整、更准确或更成熟。可改变标题与表述，增加证据、适用条件、限制、recommended action，或修订 maturity。Host Agent 提交**enrich 后完整的目标 Experience semantic state**，而非 append/remove patch；Memory 不设计 v1 patch DSL，也不裁定新旧内容是否“真的 enrich”。

目标必须存在；提议须绑定读取时的 `base_revision` 与已接纳内容基准。Prepare 与 Apply 均检查基准；stale revision 或内容冲突时拒绝并要求重新读取、重新准备。结果保持同一 ID 与 `created_at`，有效接纳时 revision 恰好加 1、`updated_at` 更新。目标状态规范化后与当前状态相同时是 no-op，不写入新的 revision，也不更新时间。

Enrich 保留原有 `source_commits`，再并入经验证的新来源并去重；不能因为提交完整目标状态就无声丢失早期来源。若原引用事实上有误，v1 不把删除它伪装成普通 enrich；应报告并留待明确的后续纠错规则。

## 7. Provenance rules

`source_commits` 是 Experience 当前知识来源的**唯一持久化权威关系**；Project 来源由有效 source Commit 的 `project_id` 派生，不持久化 `source_projects`。每个所列 Commit 必须存在、合法、处于可信已接纳历史；重复 ID 规范化去重。既有悬空引用或历史完整性问题不能静默忽略。

在 project-scoped 保存中，如果本次 create/enrich 与本次 Commit 同处一个 ChangeSet，Memory 应把**本次 Commit**加入该 Experience 的 `source_commits`；Host Agent 不需要生成尚不存在的 Commit ID。如何在 Prepare / Apply 中解析此引用，留给 SaveProposal / ChangeSet Contract，不在此规定 schema。若没有同次 Commit，也没有其他 source Commit，集合可以为空；这种 Experience 的项目来源无法从 provenance 推导，应在读取时如实呈现。

`Commit.experience_changes` 仍是“该认知阶段当时执行了哪些 Experience 操作”的权威历史记录；`Experience.source_commits` 是当前知识的来源。两者不是镜像。不得从 Experience provenance 反写旧 Commit 的操作记录，也不得从旧 Commit 自动重建 Experience 当前内容。已确认 Commit 契约的历史不可变规则保持不变。

**跨契约范围说明：** 已确认的 Commit Contract v1 在 `experience_changes` 的操作类型中列过 `merge` / `supersede`。按照最终项目需求，本版 Experience 执行器只会产生 `create` / `enrich`；前两种名称不构成当前实现要求。Commit 文档仍保留较宽的词汇，后续跨契约整理时可统一措辞，本任务不修改该文档。

## 8. Revision and historical scope

`revision` 表示已接纳的 Experience 当前状态版本：创建为 1；一次有效 enrich，无论同时改变多少语义字段或 maturity，恰好加 1。no-op、仅格式规范化或派生索引重建不加 revision，不更新 `updated_at`。时间戳必须有效，`created_at` 不变；revision 比时间戳更适合判断并发先后。

v1 的最小追溯由**当前已接纳 Experience 状态 + revision + Commit 历史 + provenance**构成。Experience 文件只保留当前知识；本契约**不要求**为每次 revision 保存完整不可变快照，也不保证恢复每一版旧正文。若一次 enrich 没有伴随阶段 Commit，revision 与更新时间能表明它被更新过，但不能据此恢复旧全文或完整修订理由。这个限制是 v1 scope cut 的明确结果，不应被描述成完整历史审计。

## 9. Manual Obsidian edit rules

Markdown 是内容 source of truth，但人工编辑不自动成为已接纳状态。Memory 将规范化后的语义状态与已接纳基准比较：仅格式变化时 revision 不变；语义变化时返回 `external_change_pending` 读取一致性状态，不把文件当作普通 accepted Experience 提供，也不允许后续 enrich 静默覆盖。

用户须显式 adopt，或先在 Obsidian reconcile 到期望的目标状态再确认。接纳时校验 ID、时间、来源引用、基准与目标内容；有效语义变化使 revision 恰好加 1、`updated_at` 更新，并更新已接纳基准。`id`、`created_at` 等机器字段的外部改动不得作为普通内容接纳。基准的具体存储方式留给 Storage Contract；v1 不增设独立的 maintenance workflow。

## 10. Low-value memory and search boundary

一次保存可以产生零条 Experience；Host Agent 可以建议“不创建”。Memory 不自动做语义去重，也不以相似度分数决定 create/enrich。保存前搜索现有 Experience、优先考虑 enrich 属于 Host Agent Integration Guide 的工作流程提醒，**不是本领域 schema 或硬性校验**。本契约不定义搜索算法、排名、自动 consolidation 或条目配额。

v1 所有正式 Experience 都是当前可使用的知识；读取时须显示 maturity，使 candidate 不会被误当作已验证 principle。没有 lifecycle 筛选语义。

## 11. Validation rules

| 情况 | v1 处理 |
| --- | --- |
| 非系统生成或重复的 ID、ID 与存储映射冲突；create 提议擅自指定 ID/revision/时间 | 拒绝 |
| 标题或 `core_statement` 为空、全空白或占位文本 | 拒绝 |
| maturity 不在三值枚举中；revision 非正整数或时间戳无效、`updated_at < created_at` | 拒绝 |
| source Commit 悬空、不合法或历史完整性待处理；重复来源 ID | 拒绝悬空或不可信引用；重复项规范化去重 |
| Enrich 目标不存在、目标 ID 与读取对象不一致 | 拒绝 |
| Enrich 的 `base_revision` 过期、内容基准变化或有人工语义修改待接纳 | 冲突；重新读取与准备 |
| Enrich 目标状态与当前相同 | no-op；不增加 revision 或更新时间 |
| Enrich 目标删去了既有来源 | 拒绝普通 enrich，避免静默丢失 provenance |

标题是否足够好、经验是否值得保存、核心知识是否仍成立、maturity 依据是否充分，不由确定性 schema 或 Memory 自行作语义裁决。

## 12. Invariants

1. Experience ID 与 `created_at` 不可变；ID 不从内容或路径推导。
2. Experience 保存**当前已接纳的可复用知识**，不复制完整项目阶段复盘。
3. Revision 单调；每次已接纳的有效语义变化恰好加 1，no-op 不加。
4. Enrich 保持同一 Experience 身份，使用完整目标语义状态和有效基准。
5. Enrich 保留历史真实的 `source_commits` 并对新来源去重合并。
6. `source_commits` 是唯一持久化 provenance；source Projects 从 Commit 归属派生。
7. Host Agent 提议 create/enrich 及 maturity，用户确认；Memory 不自行裁定语义适合性。
8. 人工语义编辑必须显式接纳，不能绕过 revision 与基准检查。
9. Experience 后续变化不得重写旧 `Commit.experience_changes`。

## 13. Decisions

| 取舍 | v1 结论 |
| --- | --- |
| 可执行演化 | 只有 create、enrich；maturity 修订通过 enrich 的完整目标状态表达。 |
| 身份 | Enrich 保持 ID；标题与正文精炼不重建身份。 |
| 来源 | 只存 `source_commits`，项目来源派生；同次 Commit 由 Memory 加入。 |
| 历史 | 当前状态、revision、Commit 历史与 provenance 构成最小追溯；不要求旧版全文恢复。 |
| 内容 | 一个核心结论与少量可选的复用字段；阶段过程归 Commit。 |
| 人工编辑 | 外部语义变化先待接纳，确认后才加 revision。 |

## 14. GitHub references

- [vartiainen1/agent-memory](https://github.com/vartiainen1/agent-memory)：借鉴 provenance、不可变历史及人类控制的方向；v1 的历史不可变性落实在 Commit，不照搬其 supersede 操作或审计系统。
- [EtienneBBeaulac/memory-mcp](https://github.com/EtienneBBeaulac/memory-mcp)：借鉴短暂信息不宜盲目持久化、存储膨胀需克制的思路；不采用相似度阈值、评分或自动 consolidation。
- [jayzuccarelli/memory-mcp](https://github.com/jayzuccarelli/memory-mcp)：借鉴人可读 Markdown 作为内容来源、多个 Agent 共享记忆，以及优先更新近重复内容的工作习惯；其直接写删工具不作为本产品写入边界。
- [kaaustubh/project-memory-mcp](https://github.com/kaaustubh/project-memory-mcp)：借鉴精炼的长期事实与大量过程历史分开的思路；不采用自动工作日志或追加 bullet 作为 Experience 数据模型。
- [maxkuminov/obsidian-mcp](https://github.com/maxkuminov/obsidian-mcp)：借鉴 Obsidian 人可读知识与可检索性；不采用通用 note CRUD 或搜索索引技术作为领域规则。

上述是对各项目公开 README 的设计取舍；v1 不因参考项目有 supersede 或 consolidation 就实现这些能力，不复制代码。

## 15. Implementation mismatch

现有实验性 [schemas.ts](../src/domain/schemas.ts) 仍使用整体 Experience body，包含 lifecycle、双向演化关系、`source_projects` 和 tags；[changeset-service.ts](../src/services/changeset-service.ts) 仍准备 merge / supersede。本契约不以这些字段或操作定义 v1。现有流程也尚未实现完整目标语义状态的 enrich 基准检查及人工外部语义编辑待接纳。**本轮不修改代码。**

## 16. Future compatibility — not v1 executable scope

长期可能加入 **merge、supersede、archive、abstract、不可变 revision 快照**。非绑定设计倾向：merge 可选择既有存续身份；supersede 可创建新身份；abstract 应区别于“同一知识的合并”；失效的历史知识不宜物理删除。真实使用若证明需要逐版本恢复 Experience 正文，可再增加不可变快照。

**以上都不是 Experience v1 implementation requirements。** 本契约不为它们定义 v1 mutation、API 输入、lifecycle 转换、后继图或环检测；当前实现不得据此提前开发。

## Changes from Draft

- v1 可执行操作收缩为 create + enrich；merge / supersede / archive / abstract 延后。
- 移除 v1 lifecycle 与演化关系字段；完整 revision 快照延后。
- provenance 只持久化 `source_commits`，Project 来源从 Commit 派生。
- 精简 Experience 语义字段，阶段过程留给 Commit。
- 去重和保存前搜索工作流程移出 Domain Contract 的硬性要求。
