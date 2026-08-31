# Personal Codex Skills

个人 Codex skills 仓库。

## Skills

| Skill | 用途 |
| --- | --- |
| [`architecture-steward`](skills/architecture-steward/SKILL.md) | 创建和维护经原子人工确认的 `ARCHITECTURE.md` 架构真源。 |
| [`bounded-agency-review`](skills/bounded-agency-review/SKILL.md) | 审查 skill、规则、workflow 或 prompt 的 agent contract，并判断是否需要剪枝。 |
| [`checkpoint`](skills/checkpoint/SKILL.md) | 显式保存当前讨论状态，供跨会话、工具或智能体继续讨论。 |
| [`deliver-task`](skills/deliver-task/SKILL.md) | 在隔离 workspace 中完成一个边界明确的开发任务并返回可审计交付结果。 |
| [`deep-rules-review`](skills/deep-rules-review/SKILL.md) | 对固定 commit 执行带快照、分片、聚合与机器校验的深度 Rule 审计。 |
| [`execute-task`](skills/execute-task/SKILL.md) | 组织一个目标、范围与验收已经明确的软件开发任务的实现、审查与必要返修。 |
| [`integrate-delivery`](skills/integrate-delivery/SKILL.md) | 将 `deliver-task` 的固定交付结果集成到本地目标分支，并完成经授权的 branch/worktree 收尾。 |
| [`whats-next`](skills/whats-next/SKILL.md) | 在开发中不知道下一步做什么或发现跨层问题时，判断唯一责任归属并停止。 |
| [`rule-steward`](skills/rule-steward/SKILL.md) | 初始化和维护 `.agents/rules/` 项目规则协议。 |
| [`rules-review`](skills/rules-review/SKILL.md) | 对 caller 指定的代码范围执行轻量 Rule applicability 与 violation 审查。 |
| [`tell-me-first`](skills/tell-me-first/SKILL.md) | 在产生实际变更前简要说明目标并等待确认。 |
| [`way-out`](skills/way-out/SKILL.md) | 当前方向可能错了、已经卡住、现有选项都不好或不知道下一步时，重新寻找可行方向。 |

## 验证

```bash
./scripts/validate-all.sh
```

## 安装

```bash
npx skills add qianchengjie/skills --global
```

可在 [skills.sh](https://skills.sh/qianchengjie/skills) 查看本仓库 skills。
