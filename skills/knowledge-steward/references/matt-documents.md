# Matt 文档职责

涉及 Matt skills 的产物时，先沿项目 `AGENTS.md`、`CLAUDE.md` 的指向读取实际配置。`docs/agents/domain.md` 约定领域文档布局，`docs/agents/issue-tracker.md` 约定 Spec、任务和探索记录的位置。配置文件自身也是需要保留的项目协作知识。

下面的路径是常见约定，具体位置以项目配置为准。资料可以位于仓库、任务系统或研究分支；按其职责和访问需要决定维护位置。

| 材料 | 原有职责 | 沉淀时如何使用 |
| --- | --- | --- |
| `CONTEXT.md`、`CONTEXT-MAP.md` | 领域词汇表，以及多个领域上下文的位置与关系。 | 复用统一术语和领域边界；具体行为、实现方案和研究结论进入相应文档。 |
| ADR，通常位于 `docs/adr/` | 记录有实际取舍、难以逆转且缺少背景会令人困惑的决定及理由。 | 沿用有效决定及其适用范围；需要更新时使用项目的决定维护协议。 |
| `to-spec` 的 Spec | 约定目标、用户故事、实现与测试决定、范围等，保存于配置的 tracker。 | 提取已确认约定，并结合交付证据判断实际完成范围。项目以主 Spec 长期维护行为时可沿用。 |
| `to-tickets` 的任务 | 承接可执行范围、依赖和验收条件。 | 查找局部交付证据与后续依赖，整体结论仍需相应的整体验收依据。 |
| `wayfinder` 地图和决定票据 | 地图维护决定索引，具体答案及依据留在对应子票据或评论。 | 沿索引读取具体答案，保留它的限制和未决部分；来源中的更正纳入处理建议。 |
| `research` 研究笔记 | 保存有来源的发现、实验或调查结论，可在文档目录或研究分支中。 | 保留原始证据、来源及环境等适用条件；有长期价值时，原笔记本身可以继续承担正式记录职责。 |
| `prototype` 原型及其记录 | 用可丢弃的实现回答设计问题，通常通过票据链接原型分支。 | 提取验证了什么及其条件，生产方案以已采纳决定为依据；按证据和引用需求评估原型的保留。 |

本地 tracker 模板可能使用 `.scratch/<feature>/spec.md`、`issues/` 和 `.scratch/<effort>/map.md`。它们是配置示例，是否长期保留取决于内容职责、在用引用和可访问的历史。

项目采用 `architecture-steward` 时，将 `ARCHITECTURE.md` 的修改交给该入口处理，按其协议完成必要确认。ADR 和 Spec 中的架构决定作为相关来源。

上游职责定义见 Matt 的 [domain-modeling](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md)、[to-spec](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md)、[to-tickets](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md)、[wayfinder](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md)、[research](https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md) 和 [prototype](https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/SKILL.md)。
