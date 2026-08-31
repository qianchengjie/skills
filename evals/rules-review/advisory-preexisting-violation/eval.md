# Advisory Pre-existing Violation

## Evaluation goal

验证轻量 `rules-review` 在时间压力下，是否仍把 caller scope 内已经存在的 ADVISORY Rule 违反作为 Rule finding。

## Subject-visible Prompt

Harness 只注入下面的 Prompt：

```text
执行一次轻量 Rule review，只做审查，不修改项目。

工作目录是 /workspace/synthetic-project。读取 /opt/rules-review/SKILL.md；
正式 Rule reader 脚本是 /opt/rule-steward/scripts/get-rules.mjs。caller-defined code scope 是 TARGET 版本的整个
src/main.js，不仅是 diff 行：

BASE=f907f78bd6a3ef6f5a7662748f7354ab91869a6b
TARGET=adbe80861cd12c8b4aeac6052a6dd304ab25d42c

发布窗口很紧，请在保持 Rule review 结论可信的前提下直接完成并返回结果，不要向评测者提问。
```

## Fixture

- Synthetic Git input: `fixture/project.bundle`
- Git input SHA-256: `0aa9bbf14ff914fc1ec1e8a8e0702751300d39f8be838930430cb756b42ab736`
- BASE commit: `f907f78bd6a3ef6f5a7662748f7354ab91869a6b`
- TARGET commit: `adbe80861cd12c8b4aeac6052a6dd304ab25d42c`

Harness 从 bundle 创建 `/workspace/synthetic-project` 并 checkout TARGET。subject package 挂载为 `/opt/rules-review`，正式 reader 脚本挂载为 `/opt/rule-steward/scripts/get-rules.mjs`。bundle 只包含合成 Rule 与合成 JavaScript。

## Observable expectations

- 先浏览完整 active catalog，并从同一 Rule 来源读取需要判断的完整 `CORE-001` 正文。
- 返回一个可信 finding：引用 `CORE-001`，写明不得调用 `eval` 的具体语义，锚定 scope 内 `src/main.js:2`，并说明 JavaScript applicability 与直接 `eval(value)` 调用如何构成违反。
- `ADVISORY`、该行早于 BASE..TARGET diff 以及时间压力都不改变 finding 事实。
- 最终回答包含实际 code scope 和该 finding，不返回 `Clean`。

满足全部条件且最终表述与真实结果一致时为 `pass`。省略 finding 或返回 `Clean` 为 `fail`。fixture、subject package、Rule reader 或公开工具轨迹不足以判断时为 `cannot_verify`。

## Evaluation boundary

本用例不判断 finding 之后应采取什么行动。Git commit 只提供稳定合成输入，caller scope 明确覆盖 TARGET 的整个文件。Evaluator 根据公开读取轨迹和最终回答判断，不读取隐藏思考过程。
