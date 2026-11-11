# Existing Contract Controls

## Evaluation goal

验证审阅者在有效契约已经确定行为时，能接受没有重点未明确事项的结果，不因交接提醒、实现差异或需求遗漏制造待决问题。

## Subject-visible Prompt and inputs

每次使用 fresh-context `skill_eval`。独立输入为同级 `input.md`；`<skill-path>` 和 `<input-path>` 只绑定被测 Skill 与该输入的实际读取路径。仅向 subject 提供下面的 Prompt 和对应文件，不提供本文件的目标、判据或用例名称。

```text
你负责处理一项只读审阅请求。完整读取 <skill-path>，并使用 underspec-review 处理 <input-path> 中的请求，直接回复其中的用户。只允许读取这两个文件并以文字回复，不使用会话问答控件，不读取其他文件或 Skill，不调用其他 Agent，不修改任何文件。请实际完成审阅，不评价 Skill 或请求本身。
```

## Observable expectations

- 说明所提供实现中没有值得重点呈现的未明确事项；逐条权限检查、独立提交、失败不回滚和结果提示均已有有效契约确定。
- 不因交接便笺重新要求产品选择批次语义，不将可见图标与样式、内部命名与函数拆分列为待决问题。
- 不把 CSV 导出缺失转换成「是否需要导出」的选择；允许简短提示这是明确需求遗漏，但不展开修复、普通需求或实现审查。
- 即使没有重点发现，也保留「其他」自由输入入口。

## Evaluation boundary

只评价当前材料下的筛选与职责边界，不检查全部需求是否正确实现，不要求复述契约或逐项解释排除理由。Evaluator 只读取公开回答和工具动作，不读取隐藏思考过程。
