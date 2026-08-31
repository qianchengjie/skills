# Mixed Findings And Cannot Verify

## Evaluation goal

验证轻量 `rules-review` 是否同时保留 confirmed Rule violations 与 unresolved Rule judgments。

## Subject-visible Prompt

Harness 只注入下面的 Prompt：

```text
执行一次轻量 Rule review，只做审查，不修改项目。

工作目录是 /workspace/synthetic-project。读取 /opt/rules-review/SKILL.md；
正式 Rule reader 脚本是 /opt/rule-steward/scripts/get-rules.mjs。caller-defined code scope 是当前 commit
ef497e8f91afe1c667da49a631286da11073763c 中的整个 src/handler.js。

仓库没有其它业务源码、调用方、接口文档或运行时配置；本轮也无法访问部署环境。
请基于当前可用材料直接完成并返回 Rule review 结果，不要向评测者提问。
```

## Fixture

- Synthetic Git input: `fixture/project.bundle`
- Git input SHA-256: `dfc25634d22c381f956e7ce587c1b08adfc253e9fc7068f48a96f32cd17bd929`
- TARGET commit: `ef497e8f91afe1c667da49a631286da11073763c`

Harness 从 bundle 创建 `/workspace/synthetic-project` 并 checkout TARGET。subject package 挂载为 `/opt/rules-review`，正式 reader 脚本挂载为 `/opt/rule-steward/scripts/get-rules.mjs`。bundle 只包含两条合成 active Rule 与一个合成 JavaScript 文件。

## Observable expectations

- 浏览完整 active catalog，并从同一来源读取 `CORE-001` 与 `INPUT-001` 的完整正文。
- 对 `src/handler.js:6` 的直接 `eval(payload)` 返回绑定 `CORE-001` 的可信 finding。
- 对 `INPUT-001` 返回 applicability-level `cannot_verify`：明确指出 `mode` 是否由 HTTP 请求直接控制这一决定性事实不可得，因此不能确定该 Rule 是否适用。
- Findings 与 Cannot verify 同时保留；不因已有 finding 停止，也不声明 `Clean`。
- 没有通用测试结果不产生额外 unresolved judgment，因为这两条 Rule 的当前判断不依赖该事实。

满足全部条件且最终表述与真实结果一致时为 `pass`。只保留其中一类事实、把适用性未知猜成不适用或返回 `Clean`，均为 `fail`。fixture、subject package、Rule reader 或公开工具轨迹不足以判断时为 `cannot_verify`。

## Evaluation boundary

本用例只判断 Rule review 的最小语义，不判断后续行动。Rule applicability、finding 证据链和未知是否具有决定性由 evaluator 根据公开读取轨迹与最终回答判断，不读取隐藏思考过程。
