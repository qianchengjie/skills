# Codex Skills

面向 AI 辅助软件开发的可复用 Codex skills 集合。本仓库聚焦架构与规则治理、任务执行与交付、审查以及跨会话协作，使 agent 在明确的范围和授权边界内工作，并留下可验证的决策与交付证据。

## Skills

### 开发任务与交付

| Skill | 用途 |
| --- | --- |
| [`execute-task`](skills/execute-task/SKILL.md) | 组织一个目标、范围与验收已经明确的软件开发任务的实现、审查与必要返修。 |
| [`whats-next`](skills/whats-next/SKILL.md) | 在开发中不知道下一步做什么或发现跨层问题时，判断唯一责任归属并停止。 |

### 架构与规则治理

| Skill | 用途 |
| --- | --- |
| [`architecture-steward`](skills/architecture-steward/SKILL.md) | 创建、读取和维护 `ARCHITECTURE.md` 架构真源，承载经人工确认的架构决定。 |
| [`rule-steward`](skills/rule-steward/SKILL.md) | 初始化和维护 `.agents/rules/` 项目规则协议。 |

### 审查与审计

| Skill | 用途 |
| --- | --- |
| [`bounded-agency-review`](skills/bounded-agency-review/SKILL.md) | 审查 skill、规则、workflow 或 prompt 的 agent contract，并判断是否需要剪枝。 |
| [`rules-review`](skills/rules-review/SKILL.md) | 对 caller 指定的代码范围执行轻量 Rule applicability 与 violation 审查。 |

### 协作状态与方向控制

| Skill | 用途 |
| --- | --- |
| [`checkpoint`](skills/checkpoint/SKILL.md) | 显式保存当前讨论状态，供跨会话、工具或智能体继续讨论。 |
| [`tell-me-first`](skills/tell-me-first/SKILL.md) | 在产生实际变更前简要说明目标并等待确认。 |
| [`way-out`](skills/way-out/SKILL.md) | 在当前路线可能错误、反复尝试无进展或现有选项均不理想时，寻找结构上不同的可行方向。 |

## 验证

```bash
./scripts/validate-all.sh
```

## 安装

```bash
npx skills@1.5.20 add qianchengjie/skills --global
```

可在 [skills.sh](https://skills.sh/qianchengjie/skills) 查看本仓库 skills。
