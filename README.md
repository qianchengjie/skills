# Codex Skills

用于 AI 辅助开发的可复用 Codex skills，涵盖任务执行、审查返修、架构与规则维护，以及跨会话协作。

它们帮助 AI 在明确的任务范围内推进工作，让实现、审查和项目决定各有分工；遇到需要补充需求或改变约定的问题时，把问题交回给你。

## 如何配合使用

这套开发方式组合了三个来源的 skills：

- **需求与任务准备**：使用 [Matt 的 skills](https://github.com/mattpocock/skills)，通过 `grill-with-docs` 或 `wayfinder` 澄清需求，用 `to-spec` 形成需求说明，按需用 `to-tickets` 拆分开发任务。
- **实现方法**：采用 [Superpowers](https://github.com/obra/superpowers) 的 `test-driven-development`，先运行失败测试，再完成最小实现，并在测试通过后重构。
- **执行与协作**：本仓库的 `execute-task` 组织实现、独立审查和返修；其他 skills 负责任务拆分维护、架构与规则管理，以及开发工作流导航。

目标、范围和验收已经明确时，可以直接交给 `execute-task`。例如：

```text
使用 execute-task 完成以下任务：<目标、范围和验收条件>。
实现阶段使用 Superpowers 的 test-driven-development。
```

各阶段的分工、交接与设计理由见 [项目总览](docs/overview.md)。

## 本仓库的 skills

各 skill 也可以按需单独使用。下表链接到面向读者的说明，每篇说明都提供对应 `SKILL.md` 的执行协议入口。

| Skill | 用来做什么 |
| --- | --- |
| [`task-steward`](docs/task-steward.md) | 判断已有需求是否需要拆分，按需落实平级任务、前置依赖与验收覆盖。 |
| [`execute-task`](docs/execute-task.md) | 组织一个明确任务的实现、审查和返修。 |
| [`task-review`](docs/task-review.md) | 检查实现是否满足任务要求，以及设计中的具体问题。 |
| [`rules-review`](docs/rules-review.md) | 逐条判断项目有效规则是否适用，并检查代码是否遵守。 |
| [`knowledge-steward`](docs/knowledge-steward.md) | 管理项目知识库，维护内容与引用关系，按实际需要处理材料去留。 |
| [`architecture-steward`](docs/architecture-steward.md) | 记录、确认和维护项目架构决定。 |
| [`rule-steward`](docs/rule-steward.md) | 建立和维护项目规则，提供规则查询。 |
| [`whats-next`](docs/whats-next.md) | 了解下一步有哪些选择、各入口的适用场景和常见工作流。 |
| [`checkpoint`](docs/checkpoint.md) | 保存讨论进展，方便在另一个会话中接着讨论。 |
| [`tell-me-first`](docs/tell-me-first.md) | 在动手前简要说明准备做什么，等待你的确认。 |
| [`way-out`](docs/way-out.md) | 当前路线受阻时，重新寻找和比较可行方向。 |
| [`bounded-agency-review`](docs/bounded-agency-review.md) | 检查给 AI 的规则和流程是否职责清楚、边界合理，是否有多余机制。 |

## 安装

安装本仓库提供的 skills：

```bash
npx skills add qianchengjie/skills --global
```

可在 [skills.sh](https://skills.sh/qianchengjie/skills) 查看本仓库 skills。

Matt 和 Superpowers 的 skills 需按各自项目说明另行安装。

## 验证

在本仓库运行：

```bash
./scripts/validate-all.sh
```

该命令检查 skill 格式、调用设置，并运行仓库现有的脚本测试。
