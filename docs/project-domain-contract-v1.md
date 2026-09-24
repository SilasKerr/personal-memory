# Project Domain Contract v1 — Confirmed

本契约定义 Project 的领域行为。

## 1. Project definition

\*\*Project 是项目当前已被接受的可信状态快照。\*\*它应简短，帮助人和 Host Agent 快速恢复上下文。Project 不累积旧状态；认知阶段及其变化原因由 Commit 保存。

Markdown 是内容的 source of truth；内容是否已被 Memory 接纳，是另一个判断。人工修改后的内容可以供审阅，但须经过第 6 节的接纳流程，才成为普通的可信 Project 状态。

## 2. Field contract

“Agent 可提交”均指提出**待确认的完整目标状态**，不表示直接写入正式数据。

| Field语义Required / 可空OwnerAgent 可提交、修改Memory 可修改更新方式 |                                          |                                    |               |           |                |                |
| --------------------------------------------------- | ---------------------------------------- | ---------------------------------- | ------------- | --------- | -------------- | -------------- |
| `id`                                                | Project 的不透明系统身份                         | 必填、非空                              | system        | 否         | 仅创建时生成         | immutable      |
| `name`                                              | 人类可读名称                                   | 必填、非空                              | Host Agent 提议 | 可提议更正或改名  | 验证并执行已确认结果     | replace        |
| `goal`                                              | 当前目标                                     | 必填、非空                              | Host Agent 提议 | 可提议       | 不自行改写语义        | 完整 replace     |
| `current_state`                                     | 简短、可信的当前状态                               | 必填、非空                              | Host Agent 提议 | 可提议       | 不自行总结或 append  | 完整 replace     |
| `confirmed_decisions`                               | 当前仍有效的重要决定                               | 必填，可为 `[]`                         | Host Agent 提议 | 可提议完整当前列表 | 验证条目及可选来源引用    | 有序列表 replace   |
| `open_questions`                                    | 当前尚未解决的问题                                | 必填，可为 `[]`                         | Host Agent 提议 | 可提议完整当前列表 | 不自行判定问题已解决     | 有序列表 replace   |
| `next_steps`                                        | 当前尚未完成、按优先顺序排列的步骤                        | 必填，可为 `[]`                         | Host Agent 提议 | 可提议完整当前列表 | 不自行规划步骤        | 有序列表 replace   |
| `lifecycle`                                         | `active / paused / completed / archived` | 必填                                 | Host Agent 提议 | 可提议转换     | 验证并执行已确认转换     | replace        |
| `revision`                                          | Memory 已接纳的 Project 状态版本                 | 必填，初始 `1`                          | system        | 否         | 按第 4 节递增       | system-managed |
| `created_at`                                        | 创建时间                                     | 必填                                 | system        | 否         | 仅创建时设置         | immutable      |
| `updated_at`                                        | 上次 Memory 接纳有效 Project 更新的时间             | 必填                                 | system        | 否         | 随有效更新设置        | system-managed |
| `key_decision_refs`                                 | 当前决定的 Commit 来源汇总                        | **不独立存储**                          | derived       | 否         | 从决定条目的可选来源引用计算 | derived        |
| `latest_commit_id`                                  | 本 Project 最新 Commit 的 ID                 | **不存于 Project**；无 Commit 时为 `null` | derived       | 否         | 从 Commit 历史计算  | derived        |
| `experience_refs`                                   | 泛称的“相关 Experience”集合                     | **不纳入 v1 Project**                 | —             | 否         | —              | —              |

`confirmed_decisions` 条目可以包含简短决定文本和可选的 `source_commit_id`。\*\*`source_commit_id` 仅表示 provenance，不定义 decision entry 的身份；Project decision 不因此获得新的领域 ID。\*\*当前有效性由 Project 中的决定内容表达，来源引用只说明出处。

| 字段Project 保留旧值？历史去向改变时影响 revision / updated_at？引用与悬空处理 |                                     |                              |                                      |
| ------------------------------------------------------ | ----------------------------------- | ---------------------------- | ------------------------------------ |
| `id`、`created_at`                                      | 不存在合法的旧值                            | 否                            | `id` 不指向路径、目录名或其他对象；改动视为身份错误         |
| `name`                                                 | 否；重要改名可在 Commit 留史，单纯更正不必           | 有效更正：是 / 是                   | 无                                    |
| `goal`、`current_state`                                 | 否；历史性改变由 Commit 记录                  | 有效改变：是 / 是                   | 无                                    |
| `confirmed_decisions`                                  | 只留当前有效项；失效决定由 Commit 留史             | 有效改变：是 / 是                   | 可选的来源 Commit 须属于本 Project；失效引用报完整性错误 |
| `open_questions`、`next_steps`                          | 已解决、已完成项退出 Project；历史性变化由 Commit 记录 | 有效改变：是 / 是                   | 无                                    |
| `lifecycle`                                            | 不保留旧状态；真实阶段转换由 Commit 记录            | 有效转换：是 / 是                   | 无                                    |
| `revision`、`updated_at`                                | 不在 Project 中保存旧版本；写入记录保留基准和结果       | 它们是更新结果，不自行触发再次更新            | 无                                    |
| `key_decision_refs`、`latest_commit_id`                 | 不独立存储                               | 派生结果变化本身不增加 Project revision | 来源损坏时报错，不猜测                          |
| `experience_refs`                                      | v1 无此字段                             | 不适用                          | 不适用                                  |

## 3. State transition rules

四种 Project lifecycle 保持不变：

- `active`：正在推进。
- `paused`：暂时停止推进，目标仍有效。
- `completed`：当前目标已达成；可显式重新打开。
- `archived`：默认从活跃浏览中隐藏，不是不可恢复的终态。

转换必须明确提出并经确认；Memory 不从正文推断。`completed → active` 合法。恢复 `archived` 时须明确指定目标状态，不假定“归档前状态”。v1 不增加细分状态机；提交相同状态是 no-op。

**`external_change_pending` 不是 Project lifecycle 的值，也不是 Project semantic state。它只是 Memory / Repository 读取 Project 时发现 Markdown 内容与上次已接纳基准不一致后返回的读取与一致性状态**，不得写入 `active / paused / completed / archived` 生命周期字段。

## 4. Revision and update rules

1. 新 Project 的 `revision = 1`。
2. 一次已接纳的 Project 目标状态若有实际变化，revision 加 **1**，`updated_at` 随之更新；多字段同时变化仍只加一次。相同目标状态的重复提交是 no-op。
3. `goal`、`current_state`、`confirmed_decisions`、`open_questions`、`next_steps` 或 `lifecycle` 发生**已接纳变化**时，**ChangeSet 必须包含 Commit**。
4. 上一条的**唯一例外**：Host Agent 明确将该修改声明为 `maintenance correction`，Preview 清楚展示其维护性更正性质，且用户确认后，可以不创建 Commit。Memory 不自行判断文字变化属于 historical change 还是 maintenance；分类由提议者声明、由用户确认。
5. `name` 更正等非历史性维护不因“发生一次修改”而强制生成 Commit；若它改变已接纳的 Project 字段，仍增加 revision 并更新 `updated_at`。仅格式规范化、重建派生数据或索引，若规范化后的领域状态未变，则两者都不变。
6. 仅新增一个历史 Commit、而 Project 当前目标状态未变时，Project revision 不增加；`latest_commit_id` 从 Commit 历史派生。

Commit 的边界是**认知阶段，不是每次修改操作**。上述规则只确定 Project 更新何时需要 Commit，不在本阶段定义 Commit 的字段或内容结构。

### 完整目标快照的前置条件

v1 使用以下顺序：

```
读取当前已接纳的 Project
→ 取得 base_project_revision
→ Host Agent 基于这次读取构造完整目标状态
→ Memory 对同一基准执行 prepare 并计算 diff
→ 用户审阅
→ apply 前再次检查基准
```

Proposal/Prepare 必须绑定 `base_project_revision`；ChangeSet 还应绑定该次读取的内容基准。若 prepare 时版本已变化，或存在尚未接纳的人工修改，立即拒绝并要求重新读取；apply 时再次检查。缺失必填列表是输入错误，不是明确删除。

v1 不采用 `add_decision`、`remove_question` 等 patch command 框架。Project 应保持短小，完整目标状态便于校验、比较、预览和处理 no-op；“先读同一基准”及用户审阅用于控制遗漏风险。

## 5. Relationship rules

- \*\*Project ID 是不透明身份。\*\*它由系统生成、不可变，不从 `name`、标题、目录名或文件名生成。`prj_<opaque-id>` 只是可能的形式；具体编码及文件路径映射留待 storage mapping 阶段确定。人类可读目录名或 slug 不是领域 ID。
- \*\*`latest_commit_id` 是派生值。\*\*Commit 历史是唯一真相；Project 不保存另一份可独立修改的最新 ID。
- \*\*`key_decision_refs` 是派生值。\*\*它从当前有效决定条目上经过验证的可选 `source_commit_id` 汇总。该引用只表示 provenance，不定义决定条目的身份；不为 Project decision 增加领域 ID。
- **v1 不持久化 `experience_refs`。**“本 Project 产生了哪些 Experience”可依据 Experience 自身将来的 `source_projects`、`source_commits` provenance 查询；它不等于“哪些 Experience 当前最值得优先阅读”。后者若确有需求，应另行定义为 `highlighted_experience_refs`，不能混用。本契约不规定 Experience 的 merge/supersede 解析行为。

## 6. Manual Obsidian edit rules

| 方案优点问题                              |                            |                                   |
| ----------------------------------- | -------------------------- | --------------------------------- |
| 用户编辑时自行递增 revision、填写时间             | 无额外接纳步骤                    | 用户容易忘记；Memory 无法可靠区分“没改”与“改了但未增版” |
| **Memory 保留已接纳基准标记；外部变化先审阅再接纳（采用）** | revision 始终表示已接纳版本；能阻止静默覆盖 | 多一步明确的 adopt/reconcile 操作         |

采用第二种。基准标记只保存校验所需的身份、已接纳 revision 和规范化领域内容指纹，**不保存第二份可独立修改的 Project 内容**；具体存放方式属于后续 storage mapping。

- Memory 读取 Markdown 后，将其与已接纳基准比较。仅格式改动、规范化领域状态未变时，正常读取，不增加 revision。
- 语义字段被外部修改后，读取返回 `external_change_pending` 一致性状态：允许查看文件内容以供审阅，但不把它作为普通的“已接纳当前状态”提供给 Agent；普通 prepare/apply 暂停。Project 自身的 `lifecycle` 保持其原有四值之一，不写入 `external_change_pending`。
- 用户可明确 **adopt** 人工编辑后的最终状态，或先在 Obsidian 中 **reconcile** 成希望接纳的状态再确认。接纳成功后，Memory 从上一个已接纳 revision 增加 1、更新 `updated_at` 和基准标记。Memory 不自动编造 Commit。若接纳使第 4 节列出的字段发生变化，须遵守“ChangeSet 包含 Commit”或经声明、预览、确认的 `maintenance correction` 例外。
- 人工改动 `id`、`created_at` 等不可变字段，或破坏格式与引用时，先报明确错误；不自动修复、不静默覆盖。基准标记缺失或损坏时，不自动猜测已接纳版本，须人工确认后重新建立基准。

Markdown 仍是**内容**的 source of truth；基准标记只回答“这份内容是否已经接纳”。v1 不设计文件监控、后台同步或自动历史补写。

## 7. Validation rules

- `id` 必须是系统生成的不透明身份，并符合最终确定的安全编码；不得由名称、标题、路径或目录名反推。编码细节待 storage mapping 确定。读取时必须验证领域 ID 与存储映射一致。
- `name`、`goal`、`current_state` 去除首尾空白后非空；不得用自动填入的省略号冒充真实状态。
- `lifecycle` 只接受 `active / paused / completed / archived`；`external_change_pending` 不能通过此字段的校验。
- 当前列表条目必须非空；按去除首尾空白、合并连续空白后的文本拒绝相同条目。语义相近但不相同的条目不由 Memory 自动合并。
- 决定条目的 `source_commit_id` 若存在，须指向本 Project 的 Commit；它是 provenance，不是 decision identity。悬空引用是完整性错误，不静默删除。
- 时间戳须为有效的带时区 ISO 时间，且 `created_at ≤ updated_at`；Memory 写入时使用统一的 UTC 表示。
- prepare/apply 必须检查已接纳基准；旧 revision、外部修改待接纳或内容基准变化都不能静默覆盖。无领域变化的重复提交是 no-op。
- 第 4 节所列字段发生已接纳变化时，验证 ChangeSet 包含 Commit；仅对明确声明为 `maintenance correction`、在 Preview 展示并经用户确认的修改适用例外。

## 8. Invariants

- Project 的领域 `id` 不透明、系统生成、不可变，与任何人类可读名称或存储路径无语义关系。
- `revision` 是已接纳 Project 状态的单调版本；未接纳的人工语义编辑不能在 revision 不变时悄悄成为普通可信状态。
- `external_change_pending` 只描述读取一致性，不是 Project 语义状态，也不属于 lifecycle 枚举。
- Project 只保存当前真相：已失效决定、已解决问题、已完成步骤退出当前集合；历史由 Commit 承担。
- 有实际 Project 状态变化的已接纳更新使 revision 恰好加 1；no-op 不加。
- `goal`、`current_state`、`confirmed_decisions`、`open_questions`、`next_steps` 或 `lifecycle` 的已接纳变化，必须伴随 Commit，除非满足经声明、预览和用户确认的 `maintenance correction` 例外。
- `source_commit_id` 仅为决定提供出处，不赋予决定条目独立领域身份。
- Project 不保存与 Commit 历史或 Experience provenance 可分别改写的第二份权威关系。
- Memory 不自行判断目标、状态、决定或 Experience 的语义价值；提议和确认仍由 Host Agent 与用户负责。

## 9. Decisions

确认以下 Project v1 原则：**不透明 Project ID；外部编辑需显式接纳；Commit 记录认知阶段并受可验证的维护性更正例外约束；v1 不存泛义 `experience_refs`；完整目标状态必须建立在一次明确读取及同一基准上。**

## 10. Open questions

没有阻碍 Project 领域契约确认的问题。Opaque ID 的具体编码、基准标记的存储位置和人工接纳操作的接口形式，留给后续实现契约；这里已确定它们必须满足的领域行为。

## Changes from Draft 1

1. **ID**：从语义 slug 改为 system-generated、opaque、immutable 身份；人类可读目录名与领域 ID 分离。
2. **人工编辑**：外部语义变化先进入待接纳的读取一致性状态；确认 adopt/reconcile 后才增加 revision，不自动伪造 Commit。`external_change_pending` 明确不属于 Project lifecycle 或 semantic state。
3. **Project 更新与 Commit**：列明触发 Commit 要求的六个字段；仅允许明确声明、预览展示并经用户确认的 `maintenance correction` 例外。Commit 仍表示认知阶段，而非每次修改操作。
4. **Experience 关系**：v1 不存含义模糊的 `experience_refs`；来源关系从 Experience provenance 查询，人工精选入口若未来需要再单独命名。
5. **完整目标快照**：强制“先读当前 Project → 绑定基准 → 构造完整目标 → prepare/apply 检查”。

**Project Domain Contract v1 至此确认。**