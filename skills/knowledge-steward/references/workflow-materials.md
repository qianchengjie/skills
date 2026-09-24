# 工作流材料职责

按项目 `AGENTS.md`、`CLAUDE.md` 的指向读取实际配置。采用 Matt skills 时，`docs/agents/domain.md` 通常约定领域文档布局，`docs/agents/issue-tracker.md` 约定 Spec、任务和探索记录的位置。配置文件自身也是项目协作知识。

下面的路径是常见约定，具体位置以项目配置为准。资料可以位于仓库、任务系统或研究分支；按其实际职责、授权和访问需要开展维护。

| 材料及来源 | 原有职责 | 知识库管理时如何处理 |
| --- | --- | --- |
| `domain-modeling`、`grill-with-docs` 使用的 `CONTEXT.md`、`CONTEXT-MAP.md` | 领域词汇表，以及多个领域上下文的位置与关系。 | 沿用统一术语和领域边界；领域模型的调整交给领域维护入口。 |
| ADR，通常位于 `docs/adr/` | 记录有实际取舍、难以逆转且缺少背景会令人困惑的决定及理由。 | 沿用有效决定及适用范围；变化按项目的决定维护协议处理，保留替代关系。 |
| `to-spec` 的 Spec | 将讨论和决定整理为目标、用户故事、实现与测试决定、范围等，保存于配置的 tracker。 | 按已有授权维护已确认内容和引用；新的需求取舍交给调用方，实际交付范围另看验收依据。 |
| `to-tickets`、`task-steward` 的任务材料 | 承接可执行范围、拆分、依赖和验收条件。 | 识别知识与证据依赖，保留仍被消费的内容；任务拆分、范围和状态变化交给任务维护流程。 |
| `wayfinder` 地图和决定票据 | 地图维护决定索引，具体答案及依据留在对应子票据或评论。 | 沿索引读取具体答案，按授权维护引用和已有结论，保留限制与未决部分；新的探索决定由探索流程承接。 |
| `research` 研究笔记 | 保存有来源的发现、实验或调查结论，可在文档目录或研究分支中。 | 原笔记可以继续承载知识；维护来源、适用条件与结论的关系，需要新调查时交给研究环节。 |
| `prototype` 原型及其记录 | 用可丢弃的实现回答设计问题，通常通过票据链接原型分支。 | 保留验证结论、条件与原型来源，区分验证结果和已采纳方案；按证据和引用需求评估原型的保留。 |
| `execute-task` 的实现与验证交接 | 返回单任务实现、验证、审查结果和剩余风险。 | 按实际覆盖范围使用事实与证据；整体交付结论由相应整体验收依据支持。 |
| `task-review`、`rules-review` 的审查结果 | 给出范围内的问题、依据和未能确认的事项。 | 保留发现及其处理状态，约定变更以相应决定为依据；修复与复核由执行和审查环节承接。 |
| `checkpoint` 的讨论快照 | 保存未结束讨论的已确认内容、候选、推断和待确认点，支持跨会话接续。 | 维持内容的确认状态和上下文；需要核实外部事实时沿原始依据检查。 |

本地 tracker 模板可能使用 `.scratch/<feature>/spec.md`、`issues/` 和 `.scratch/<effort>/map.md`。它们是配置示例，材料去留取决于内容职责、在用引用和可访问的历史。

项目采用 `architecture-steward` 时，`ARCHITECTURE.md` 的修改交给该入口处理并按其协议确认，ADR 和 Spec 中的架构决定作为相关来源。项目规则的维护交给 `rule-steward`；知识整理中发现的候选做法保留其当前状态，由相应维护入口判断是否成为约定。

上游职责定义见 Matt 的 [domain-modeling](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md)、[to-spec](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md)、[to-tickets](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md)、[wayfinder](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md)、[research](https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md) 和 [prototype](https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/SKILL.md)。
