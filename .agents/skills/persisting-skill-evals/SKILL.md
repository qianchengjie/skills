---
name: persisting-skill-evals
description: 当 writing-skills 产生的 Skill 行为测试需要保存在仓库中，以便后续复跑、保留回归证据或比较不同版本时使用。
---

# Persisting Skill Evals

把 `writing-skills` 产生的可丢弃行为测试，保存为可复跑、可审计的仓库工件。
本 Skill 不设计 RED-GREEN-REFACTOR，也不决定如何修改被测 Skill；它只规定
哪些评测材料进入仓库，以及如何隔离和记录。

**REQUIRED SUB-SKILL:** 使用 `writing-skills` 设计测试场景、建立 RED、选择
对照、确定 repetitions，并验证 Skill 修改后的行为。

## 职责边界

| `writing-skills` | `persisting-skill-evals` |
| --- | --- |
| 设计压力场景和行为测试 | 决定是否值得长期保存 |
| 执行 RED-GREEN-REFACTOR | 固定正式评测合同与输入身份 |
| 调整 Skill 文案并复测 | 保存 attempts、结果和耐久证据 |

以下情况值得持久化：

- 该行为促成或阻止了一次 Skill 修改，需要保留回归证据；
- 后续需要按相同输入重跑、比较版本或归因 Skill 文案贡献；
- fixture、仓库状态或隔离条件复杂，重新构造容易漂移；
- 一次失败暴露了可重复的绕过、伪完成或不稳定路径。

一次性探索可以留在临时目录。schema、字段、引用闭合、确定性转换和退出码应写
普通仓库测试，而不是 Agent eval。

## 目录合同

```text
evals/
└── <subject-skill>/
    └── <scenario>/
        ├── eval.md
        ├── fixture/   # 仅在 subject 需要读取文件时创建
        └── results/   # 首次正式运行后才创建
```

父目录已经表达 subject Skill，`<scenario>` 不重复 Skill 名。`eval.md` 和
`results/` 是 evaluator-only；`fixture/` 只放 subject-visible 输入。

本 Skill 位于 `.agents/skills/`，只供仓库维护者使用。不得把它、`eval.md`、
历史结果或 oracle 随被测 Skill 安装或挂载。

## 从探索转为正式评测

探索运行可以说明“值得建立评测”，但不能回填成正式结果。正式运行前：

1. 从探索证据中提取稳定输入和一个可证伪主张；
2. 提交或固定 `eval.md` 与 fixture 身份；
3. 按 `writing-skills` 选定的测试方案预注册 variants、repetitions 和预算；
4. 从空运行目录和 fresh context 重新执行。

持久化可复现行为所需的输入，不保存一次性实现细节。临时生成器只有成为稳定
Harness 组成部分时才进入仓库；否则保留输入、命令和结果证据即可。

## `eval.md`

每份合同必须覆盖：

1. `Evaluation goal`：单一主张、成功终态和 non-goals；
2. `Fixture identity`：输入、仓库、commit、hash 和确定性规模；
3. `Variants`：每组 subject package 及唯一差异；
4. `Physical isolation`：subject 白名单和 evaluator-only 排除项；
5. `Subject-visible Prompt`：Harness 实际注入的完整文本；
6. `Execution protocol`：fresh context、预算、repetitions 和补跑规则；
7. `Observed behavior`：可见路径、优先级和证据来源；
8. `Acceptance criteria` 与 `Cannot verify`；
9. `Variant interpretation`：结果组合允许支持的结论；
10. `Result files` 与 `Evaluation boundary`。

职责不适用时写明原因；不得为满足合同虚构 variant、fixture、validator 或对照。

Harness 必须直接注入 Prompt，并通过挂载白名单或等价机制物理隔离 oracle。
只写“不得读取”不算隔离。无法证明隔离时，正式结果为 `cannot_verify`。

## 结果合同

一次固定 variant 运行组写一份：

```text
results/YYYY-MM-DD-<variant>-NN.md
```

不为尚未运行的结果创建占位文件。每份 result 至少记录：

- Evaluation、fixture、Prompt、bundle 和挂载清单身份；
- subject、Skill、模型和 Harness 版本；
- 计划 repetitions、全部已启动 attempts 和排除原因；
- 每次 observed behavior、公开证据、用户可见原文和 verdict；
- 产物 hash、validator 终态、variance、聚合 verdict 与 interpretation。

subject failure 不得被重跑替换。只有能由 subject 之外的 Harness 证据独立证明
的 Harness failure 可以排除；被排除 attempt 仍须保留。

原始长日志可以位于临时存储，但 result 必须保留足以复核路径、verdict 和排除
决定的最小耐久证据。不得要求、推断或保存隐藏思考过程。

机器只检查可确定、可复现的身份、结构和闭合状态。Observed behavior、证据
强度、诚实终态、bypass 和因果解释由 evaluator 判断；validator 通过不等于
语义 verdict 正确。

## 常见错误

- 把 `/private/tmp` 中可运行一次的脚本当成已持久化评测；
- 将 acceptance criteria 放进 subject-visible fixture；
- 只有日期的结果文件被后续运行覆盖或混写；
- 把探索样本追认为正式 RED，或只保存挑选后的 passing attempts；
- 对照只能证明当前组合，却写成 Skill 文案产生了因果贡献。
