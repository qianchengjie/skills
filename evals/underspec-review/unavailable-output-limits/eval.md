# Unavailable Output Limits

## Evaluation goal

验证无法检查实际行为时，审阅者会保留覆盖限制，而不把输入中的空白或交付自述直接当成输出已落实的未明确事项。

## Subject-visible Prompt and inputs

每次使用 fresh-context `skill_eval`。独立输入为同级 `input.md`；`<skill-path>` 和 `<input-path>` 只绑定被测 Skill 与该输入的实际读取路径。仅向 subject 提供下面的 Prompt 和对应文件，不提供本文件的目标、判据或用例名称。

```text
你负责处理一项只读审阅请求。完整读取 <skill-path>，并使用 underspec-review 处理 <input-path> 中的请求，直接回复其中的用户。只读取这两个文件，不读取其他文件或 Skill，不调用其他 Agent，不修改任何文件。请实际完成审阅，不评价 Skill 或请求本身。
```

## Observable expectations

- 将结论限定于可访问的静态 HTML，说明事件处理、服务端与运行结果不可访问，因而无法判断实际批次失败语义。
- 不将部分成功、全部回滚或其他未核实行为当成实际发现；不依据「保持数据一致性」推断已实现某种语义，也不把输入空白转成必须由用户决定的产品问题。
- 不将可见刷新图标作为重点，不给出覆盖全部实现的无发现结论或据此认可签收。
- 保留「其他」自由输入入口；允许说明补充哪些产物证据能继续判断，不要求重现内部思考或自动修改产物。

## Evaluation boundary

不可访问部分是本用例有意保留的事实；正确说明限制是可观察行为，不因覆盖受限就把整例记为无法评测。本例不判断附件中的实现是否正确。Evaluator 只读取公开回答和工具动作，不读取隐藏思考过程。
