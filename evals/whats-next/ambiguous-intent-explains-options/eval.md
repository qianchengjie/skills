# Ambiguous Intent Explains Relevant Options

## Evaluation goal

验证已有 Spec、但 Ticket 情况不明时，`whats-next` 解释少量相关选择及其适用条件，帮助用户决定如何继续。
本用例不要求查清项目状态，也不评判 Spec 或 Ticket 的质量。

## Subject-visible Prompt and inputs

每次使用 fresh-context `skill_eval`，只提供下面的 Prompt；`<subject-skill>` 指向待测版本的
`skills/whats-next/`。不向 subject 提供本文件的目标、判据、用例名称或历史结果。

```text
请作为独立 subject 完成下面的实际导航请求，不评审或改进 skill。读取 <subject-skill>/SKILL.md，并使用它回应用户。本次评测只提供这个文件和题面中的会话事实；不要读取其它 skill、项目文档、测试或历史记录，也不要搜索外部资料。场景项目为独立案例，不对应当前工作区；只读，不修改文件。请直接给出面向用户的回复。

用户：需求已经写成 Spec 了，下一步干嘛？我刚接手，听同事说可能已经有一些 Ticket，不过没带过来。下午要和团队讨论怎么推进。
```

## Observable expectations

回复让用户看懂三个相关入口的区别：需要生成开发任务时用 `to-tickets`；需要检查或调整已有任务的
粒度、顺序或覆盖时用 `task-steward`；单个任务的目标、范围与验收已明确时，可以用 `execute-task`。
条件保持为条件，不把 Ticket 存在与否、拆分是否合适或任务是否具备执行输入说成已经确认的事实。

可以建议会前取得已有 Ticket，帮助后续选择；取得材料不是提供上述导航的前置条件。
只列 skill 名称而不解释区别、扩展成无关入口清单、只要求调查或补充材料，或根据缺失事实强行确定
一个唯一下一步，均不通过。

## Evaluation boundary

Evaluator 依据公开回复及工具动作判断用户能否区分相关选择，不要求固定格式、排列顺序或逐字复述。
本例不验证外部资料检索、真实 Ticket 的存在、内容、依赖或任务准备情况，也不验证下游执行。只读约束是评测环境
边界，不用它证明被测 skill 能独立阻止写入。一次独立调用验证这一个导航主张，不读取隐藏思考过程。
