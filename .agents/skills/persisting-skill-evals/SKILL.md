---
name: persisting-skill-evals
description: 当 writing-skills 已产生稳定的 Skill 行为用例，并明确需要在仓库中长期复跑、保留回归边界或比较版本时使用。
---

# Persisting Skill Evals

把 `writing-skills` 已产生的一个行为用例保存为类似单元测试的回归用例。本
Skill 不设计用例、不选择输入载体，也不运行评测 campaign。

**REQUIRED SUB-SKILL:** 使用 `writing-skills` 设计并验证行为用例。

## 使用边界

只有同一行为边界以后还会复跑，并且复跑结果会影响 Skill 修改或版本比较时，
才把用例放进仓库。一次性探索和没有后续决策价值的 RED/GREEN 留在临时会话中。

schema、字段、引用闭合、确定性转换和退出码应写普通仓库测试，而不是 Agent
eval。

## 单个用例合同

一个 eval 对应 `writing-skills` 的一个既有行为用例：一次独立 AI 调用验证一个
可观察行为主张。

```text
evals/
└── <subject-skill>/
    └── <scenario>/
        ├── eval.md
        ├── <用例原有的独立输入，如有>
        └── results/   # 仅在明确要求保留运行结果时存在
```

`eval.md` 只记录：

1. `Evaluation goal`：单一行为主张和 non-goals；
2. `Subject-visible Prompt and inputs`：既有 Prompt、输入形式及已有身份；
3. `Observable expectations`：一次调用应出现和不应出现的公开可观察行为；
4. `Evaluation boundary`：本用例不判断的内容。

## 保留既有用例

Prompt、输入载体和可观察断言都属于用例。持久化只增加耐久记录，不改变用例
语义：保留原有文本、文件、仓库状态或不可变 artifact 引用，并记录用例已经
具有的身份。

不得为了自包含、最小化或目录整齐，把外部 artifact 改造成 fixture、把真实
输入重建为合成输入，或因输入载体不符合偏好而拒绝持久化。用例缺少稳定输入
时，回到 `writing-skills` 重新设计；本 Skill 不补齐或虚构输入。

Acceptance criteria 和 non-goals 是 evaluator-only，不得放进 subject-visible
Prompt 或输入。不得要求、推断或保存隐藏思考过程。

## 运行结果

历史运行结果不属于用例定义。只有用户明确要求保留版本比较或特定回归证据时，
才保存公开可观察的 result；原始长日志、完整会话和隐藏思考过程不进入仓库。

## 常见错误

- 因为已经跑过 RED/GREEN，就默认把一次性用例放进仓库；
- 持久化时重新设计 Prompt、输入或断言；
- 为统一目录结构而制造 fixture、Harness 或合成项目；
- 把每次运行结果、完整日志或会话流水都当成回归用例的一部分。
