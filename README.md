# Personal Codex Skills

个人 Codex skills 仓库。

## Skills

| Skill | 用途 |
| --- | --- |
| [`bounded-agency-review`](skills/bounded-agency-review/SKILL.md) | 审查 skill、规则、workflow 或 prompt 的 agent contract，并判断是否需要剪枝。 |
| [`checkpoint`](skills/checkpoint/SKILL.md) | 显式保存当前讨论状态，供跨会话、工具或智能体继续讨论。 |
| [`rule-steward`](skills/rule-steward/SKILL.md) | 初始化和维护 `.agents/rules/` 项目规则协议。 |
| [`rules-review`](skills/rules-review/SKILL.md) | 使用项目规则审查已提交的 Git commit。 |
| [`sliced-dev`](skills/sliced-dev/SKILL.md) | 通过垂直薄片分步完成中大型编码任务。 |
| [`tell-me-first`](skills/tell-me-first/SKILL.md) | 在产生实际变更前简要说明目标并等待确认。 |

## 验证

```bash
./scripts/validate-all.sh
```

## 安装

```bash
npx skills@1.5.20 add qianchengjie/skills --global
```

可在 [skills.sh](https://skills.sh/qianchengjie/skills) 查看本仓库 skills。
