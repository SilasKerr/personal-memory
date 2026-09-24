# Commit Domain Contract v1 — Confirmed

**状态：Confirmed。** 本文只定义领域行为，不修改代码，也不改变已确认的 Project Contract。

## 1. Commit definition

Commit 是一个项目在**认知阶段结束时**形成的历史记录，说明当时从什么理解出发、发现了什么、为何作出决定，以及阶段结束时如何看待项目。

```
Project = 当前真相
Commit  = 当时的真相
```

Commit 不是命令、文件修改、尝试过程或日期的日志。它以人可读的阶段叙述为主；ChangeSet 负责保存可执行的变更及机器差异。Commit 不重复保存完整的 Project 字段差异。

## 2. Field contract

所有 Commit ID 都由系统生成，保持 opaque、不可变；不从标题、目录名或 sequence 推导。下表中的正文语义存于 Markdown 正文，机器关系存于 metadata。

| 字段要求与来源空值规则位置及创建后规则   |                                        |                     |                                          |
| --------------------- | -------------------------------------- | ------------------- | ---------------------------------------- |
| `id`                  | 必需；系统生成                                | 不可空                 | metadata；不可变                             |
| `project_id`          | 必需；由目标 Project 确定                      | 不可空                 | metadata；不可变                             |
| `sequence`            | 必需；系统按项目历史分配                           | 正整数                 | metadata；不可变                             |
| `created_at`          | 必需；系统在用户确认后正式写入时生成                     | 有效时间戳               | metadata；不可变                             |
| `title`               | 必需；Host Agent 提议、用户确认                  | 不可空白                | 正文一级标题；不可变的历史语义，不在 metadata 另存一份         |
| `stage_goal`          | 可选；Host Agent 提议                       | 无内容则省略              | 正文；不可变                                   |
| `starting_point`      | 必需；Host Agent 提议                       | 不可空白                | 正文；不可变                                   |
| `key_findings`        | 可选；Host Agent 提议                       | 无内容则省略              | 正文；不可变                                   |
| `turning_points`      | 可选；Host Agent 提议                       | 无内容则省略              | 正文；不可变                                   |
| `decisions`           | 可选；Host Agent 提议                       | 无内容则省略；写入时应说明理由     | 正文；不可变                                   |
| `rejected_approaches` | 可选；Host Agent 提议                       | 无内容则省略；写入时应说明理由     | 正文；不可变                                   |
| `ending_state`        | 必需；Host Agent 提议                       | 不可空白                | 正文；不可变                                   |
| `open_questions`      | 可选；Host Agent 提议                       | 无内容则省略              | 正文；记录当时的问题，不是 Project 当前集合的第二份权威副本       |
| `next_steps`          | 可选；Host Agent 提议                       | 无内容则省略              | 正文；记录当时的方向                               |
| `experience_changes`  | 可选；由同一 ChangeSet 中经确认的 Experience 操作确定 | 无操作时为空集合或省略         | metadata 中的结构化历史引用；不可变，不复制 Experience 全文 |
| `previous_commit_id`  | **不持久化**                               | 从 `sequence - 1` 派生 | 不构成第二个排序依据                               |
| `revises_commit_ids`  | 可选；提议者明确指出本阶段修正或更新其认知的旧 Commit         | 无引用时为空集合或省略         | metadata；仅允许引用同项目、序号更早的 Commit；不可变       |

正文**结构完整、内容允许稀疏**：只呈现本阶段确有内容的可选 section，不生成“暂无”“N/A”“无”等占位文字。除 `starting_point` 与 `ending_state` 外，至少须有 `key_findings`、`turning_points`、`decisions` 或 `rejected_approaches` 中的一项非空，用来交代认知变化的依据。确定性校验只检查存在性与非空；内容质量由提议者和确认者判断。

`created_at` 是**正式接纳并写入 Memory 的时间**，不是认知阶段实际发生的时间。Commit 的所有用户确认语义内容必须在 Prepare 阶段冻结，用户确认的是同一个稳定的 Commit semantic payload。`created_at` 属于 Apply / Commit 时由系统补入的 operational metadata；Prepare 阶段不能把准备时间冒充最终的 `created_at`。Apply 时填写该字段不属于重新生成、重新总结或改变用户已确认的 Commit 内容。后续 ChangeSet Contract 应区分 `confirmed semantic payload` 与 `commit-time machine metadata`；本契约不规定具体 ChangeSet schema。v1 不另设阶段起止时间字段。

## 3. Creation rules

当一个认知阶段形成值得长期回看的结论时，应提议 Commit。例如：目标实质改变、问题理解明显变化、作出关键决定、放弃重要方案、解决核心问题、进入新阶段，或下一步方向明显改变。

已确认的 Project Contract 同时给出可验证的硬规则：`goal`、`current_state`、`confirmed_decisions`、`open_questions`、`next_steps`、`lifecycle` 中任何字段发生已接纳变化，ChangeSet **必须包含 Commit**。唯一例外是提议者明确声明为 `maintenance correction`，Preview 清楚展示、用户确认后可不创建 Commit。Memory 不自行判断文字变化属于哪一类。

Commit 可以单独创建，用来记录已结束的认知阶段，而 Project 当前快照没有变化；这时 Project revision 不增加。日常编辑、日期变化、无长期意义的调试经过本身都不构成创建条件。**Commit 的边界是认知阶段，不是编辑边界。**

## 4. Ordering rules

v1 每个 Project 只有一条严格线性的 Commit 历史，不支持 branch、merge commit 或 DAG。

`sequence` 是项目内的权威顺序：首条为 1，此后连续递增，不允许重复或缺口。前一条由 `sequence - 1` 派生，后一条由 `sequence + 1` 派生，最新 Commit 是该项目最大 sequence 对应的 Commit。`previous_commit_id` 和 `next_commit_id` 均不持久化，避免重复的权威事实。Project 的 `latest_commit_id` 同样从历史派生。

Commit ID 与 sequence 各有职责：前者是稳定身份，后者是项目内顺序；两者不能互相推导。Project revision 只表示当前 Project 快照的修订，不充当 Commit sequence。

## 5. Immutable rules

创建后不得修改 Commit 的身份、归属、顺序、创建时间、阶段叙述、Experience 操作记录或认知修订关系。后来发现结论错误，也不能直接改写旧 Commit。

允许单独处理的维护仅限于**不改变历史语义**的格式或 metadata 迁移、修复可由可信基准确认的损坏引用，以及明显存储损坏的恢复。这些处理必须有明确的维护记录与一致性校验；不得借维护通道改变旧结论。对已接纳 Commit 的非语义 maintenance 不创建新的 Commit sequence，不改变该 Commit 的 sequence、Project revision 或 Commit history ordering，也不构成新的认知阶段。系统必须能够留下该历史记录曾经过维护的审计痕迹；本契约只规定可审计性，不增设一级 `Audit` 领域对象，也不决定具体 audit 文件格式，存储方式留给后续 implementation / storage contract。若无法证明恢复内容与原先接纳的内容一致，不能将其当作普通维护自动接纳。

## 6. Project consistency rules

同一 ChangeSet 同时更新 Project 并创建 Commit 时，两者必须指向同一 Project、同一次经确认的认知变化。Commit 的 `ending_state` 不应与最终 Project 快照明显矛盾，但 v1 不用 LLM 判断自然语言是否一致；这一点由 Preview 和用户确认把关。

Memory 可确定性验证：

- ChangeSet、Commit 与 Project 的 `project_id` 一致；
- ChangeSet 针对已读取的 `base_project_revision` 准备，准备及应用时基准仍有效；
- Commit 的 sequence 接在当前历史头之后，且历史头未发生并发变化；
- Project Contract 要求 Commit 的变更确实与 Commit 同处一个 ChangeSet，除已确认的 `maintenance correction`；
- Commit 中记录为本阶段 Experience 操作的条目，与同一 ChangeSet 的相应操作一致。

仅新增 Commit 而 Project 不变时，也必须校验 **Commit 历史头**；只校验 Project revision 不足以发现并发新增 Commit。冲突时拒绝准备或应用，要求重新读取，不自动改号或静默覆盖。

## 7. Experience relationship rules

Commit 可保存简短的结构化 `experience_changes`：操作类型（`create`、`enrich`、`merge`、`supersede`）以及涉及的 Experience ID、结果 ID。`Commit.experience_changes` 是**该阶段当时实际执行了哪些 Experience 操作**的 authoritative historical record，不复制 Experience 正文，也不在此定义其完整生命周期。后续 Experience 的 enrich、merge、supersede 或 provenance changes 都不得反向生成、删除或重写旧 Commit 的 `experience_changes`。

未来的 `Experience.source_commits` 表示当前 Experience 的知识来源，不是 Commit operation log；Commit 的 `experience_changes` 表示该阶段发生的操作。两者不得互相覆盖或视为镜像：一个 Experience 可以引用较早的 Commit 作为依据，而那个旧 Commit 当时并未操作该 Experience。若新 Commit 同时参与 Experience 操作，Memory 校验同一 ChangeSet 中的操作引用；不得从 `source_commits` 反推或改写旧 Commit 的操作记录。Experience 的证据来源细则留待 Experience Contract。

## 8. Cognition revision rules

旧认知后来被证明错误时，创建**新的 Commit**，说明原结论、修正依据及新的认识；旧 Commit 保留其当时内容。

可选的 `revises_commit_ids` 精确指向本 Commit 明确修正或更新了哪些更早 Commit 中的认知；它不表示文件维护或 metadata 修复意义上的 correction，也不要求每个新 Commit 都填写。只允许引用同项目且 sequence 更小的 Commit；由此排除自引用与环。反向关系从这些引用派生，不持久化。该关系在接纳后不可变。新 Commit 仍须满足正常创建及用户确认规则。

## 9. Manual edit rules

人工编辑旧 Commit 文件后，Memory 应将其识别为**外部修改或完整性待处理**，不能把变动静默接纳为正式历史，也不能继续把有争议的内容当作可信历史供后续写入使用。

纯格式调整、可证明不改变语义的 metadata 维护，可经明确的维护流程核对后接纳。改变旧结论的人工编辑不允许普通 adopt：应恢复已接纳的旧历史，并通过新的 correction Commit 表达新认知。若旧内容无法可信恢复，应明确报告完整性问题，不能以重新设定基准的方式伪装成从未改写过历史。外部修改状态是读取与一致性状态，不是 Commit 的领域字段。

## 10. Validation rules

| 情况规则                                              |                                                  |
| ------------------------------------------------- | ------------------------------------------------ |
| `project_id` 不存在，或与目标 Project / ChangeSet 不一致     | 拒绝                                               |
| Commit ID 已存在，或不符合 opaque system identity 约束      | 拒绝                                               |
| sequence 重复、有缺口、不是当前历史头的下一位                       | 拒绝；读取发现既有缺口时报告历史完整性问题                            |
| 持久化或提交不合法的 predecessor                            | v1 不接受 `previous_commit_id` 作为输入；前驱由 sequence 推导 |
| `created_at` 无效，或被当作阶段发生时间自行填写                    | 拒绝                                               |
| 标题、起点、终点为空，或缺少任何解释认知变化的核心内容                       | 拒绝                                               |
| Experience 操作引用与同一 ChangeSet 操作不符                 | 拒绝；所涉对象的存在性按该操作执行前后状态校验                          |
| `revises_commit_ids` 自引用、重复、跨项目、指向未来或不存在的 Commit  | 拒绝；“仅指向更早 sequence”同时防止环                         |
| 人工修改旧 Commit 的历史语义                                | 标记完整性待处理；拒绝普通接纳与依赖该内容的写入                         |
| Prepare 后 Project 基准或 Commit 历史头变化                | 返回冲突，要求重新读取与准备                                   |

标题是否准确、理由是否充分、`ending_state` 与 Project 自然语言是否相符，不交给确定性 schema 冒充判断。

## 11. Invariants

1. Commit 的 ID、项目归属、sequence、创建时间及历史语义在接纳后不可变。
2. 每个 Project 的 Commit 历史在 v1 中线性、连续，顺序只有 `sequence` 一个权威来源。
3. 历史认知不能通过直接编辑旧 Commit 静默重写。
4. Project 当前状态与 Commit 历史各有职责；仅追加 Commit 不增加 Project revision。
5. 已确认 Project Contract 指定的字段更新，必须伴随 Commit，除经声明、展示和确认的 `maintenance correction`。
6. `Commit.experience_changes` 是当时实际执行的 Experience 操作的权威历史记录；Experience 后续变化不能反向生成、删除或重写它，`Experience.source_commits` 不能覆盖它。
7. 任何与基准 Project 或 Commit 历史头冲突的提议都不能静默应用。
8. 已接纳 Commit 的非语义维护不改变 sequence、Project revision、历史顺序或历史语义，也不形成新认知阶段；维护必须留有可审计痕迹。

## 12. Decisions and GitHub reference

| 决定取舍       |                                                                |
| ---------- | -------------------------------------------------------------- |
| 阶段叙述优先     | 选择 **Stage narrative / semantic snapshot**；机器字段差异留给 ChangeSet。 |
| 一条线性历史     | 只持久化 sequence，不持久化前后指针。                                        |
| 有限的结构化关系   | 保留 Experience 操作引用及可选的认知修订引用，不扩展成通用事件图。                          |
| 不可变历史      | 错误由新 Commit 纠正；旧记录保留。                                          |
| 人工编辑需完整性处理 | 允许人维护 Markdown，但不自动接纳历史语义改写。                                   |

参考项目的取舍：借鉴 [vartiainen1/agent-memory](https://github.com/vartiainen1/agent-memory) 对历史、provenance 和人工控制的重视；借鉴 [kaaustubh/project-memory-mcp](https://github.com/kaaustubh/project-memory-mcp) 的项目范围内决策与经验记录。借鉴 [maxkuminov/obsidian-mcp](https://github.com/maxkuminov/obsidian-mcp) 以可读笔记供人编辑的方向，以及 [jayzuccarelli/memory-mcp](https://github.com/jayzuccarelli/memory-mcp) 的 Markdown source of truth 与多客户端共享思路。[EtienneBBeaulac/memory-mcp](https://github.com/EtienneBBeaulac/memory-mcp) 的持续演化知识也有参考价值。Personal Memory 不采用这些项目的通用笔记 CRUD、自动写入、额外分类或复杂基础设施作为 Commit 领域规则，因为这里需要的是经确认的项目认知历史，而非任意记忆更新。以上借鉴的是设计取向，未复制代码。

## 13. Implementation mismatch

现有实验性实现与本契约至少有以下差异；**本阶段不修改它们**：

- [schemas.ts]\(../src/domain/schemas.ts) 中 Commit 仍使用 `previous_commit` metadata，正文是未约束的整体字符串；没有本契约的必需叙述校验、Experience 操作记录或认知修订引用。
- [changeset-service.ts]\(../src/services/changeset-service.ts) 以 Project ID 与 sequence 构造 Commit ID，并在 prepare 时确定 `created_at`；本契约要求 opaque ID，正式接纳时间作为创建时间。
- 同一服务把 `latest_commit` 存在 Project 中，并可能因仅新增 Commit 而更新 Project；已确认的 Project Contract 要求从历史派生该值，且 Project 快照不变时 revision 不增加。
- [commit-repository.ts]\(../src/repositories/commit-repository.ts) 已有线性追加及不提供 update 的方向，但目前同时依赖 sequence 与持久化前驱。

## 14. Open questions

没有阻止本契约成立的领域问题。留给后续契约与实现设计确定的是：`experience_changes` 的具体 Markdown 编码、已应用 ChangeSet 的保存期限，以及完整性基准与维护记录的存储方式。这些选择不得改变上述不可变性、排序和冲突规则。

## Changes from Draft

- 明确 Prepare 冻结用户确认的 Commit 语义内容，Apply 补入 `created_at` 作为机器元数据。
- 将认知修订引用改为 `revises_commit_ids`，与 maintenance correction 区分。
- 明确 `Commit.experience_changes` 是不可被 Experience 后续演化反写的权威历史操作记录。
- 明确旧 Commit 的非语义维护不改变历史状态，并且必须可审计。
