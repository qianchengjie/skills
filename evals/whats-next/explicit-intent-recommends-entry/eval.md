# Explicit Intent Recommends an Entry

## Evaluation goal

验证用户已明确要检查已有 Ticket 的拆分和执行顺序时，`whats-next` 直接推荐相关入口并说明适用理由。
本用例不评判实际拆分方案，也不要求固定输出格式。

## Subject-visible Prompt and inputs

每次使用 fresh-context `skill_eval`，只提供下面的 Prompt；`<subject-skill>` 指向待测版本的
`skills/whats-next/`。不向 subject 提供本文件的目标、判据、用例名称或历史结果。

```text
请作为独立 subject 完成下面的实际导航请求，不评审或改进 skill。读取 <subject-skill>/SKILL.md，并使用它回应用户。本次评测只提供这个文件和题面中的会话事实；不要读取其它 skill、项目文档、测试或历史记录，也不要搜索外部资料。场景项目为独立案例，不对应当前工作区；只读，不修改文件。请直接给出面向用户的回复。

已有会话：我们要维护一个批量导入功能的开发计划。Ticket T7 同时写了文件解析、后台导入队列和失败记录重试三项交付，大家对产品需求已经达成一致。
用户：这个 Ticket 太大了，我想先检查怎么拆、哪些先做。下一步用哪个 skill？
```

## Observable expectations

回复直接推荐 `task-steward`，理由落在已有任务的粒度、交付边界或执行顺序需要评审和维护。
用户能够据此选择入口，无须先提供项目材料或重新澄清已经达成一致的产品需求。

可以给出发起该工作的示例请求，也可以简短解释相邻入口的区别。将需求探索、新建任务或实际执行
作为本次主要推荐，展开无关 skill 清单，或只要求补材料而未提供入口，均不通过。

## Evaluation boundary

Evaluator 依据公开回复及工具动作判断推荐是否适用，不按标题、固定字段或某个精确句式评分。
本例不提供真实项目文件，不验证外部资料检索、`task-steward` 的拆分质量、任务写入或执行结果；只读约束是评测环境
边界，不用它证明被测 skill 能独立阻止写入。一次独立调用验证这一个导航主张，不读取隐藏思考过程。
