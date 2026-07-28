---
name: rules-review
description: 项目规则驱动的 commit 代码审查流程。代码 TARGET 固定为 commit；规则默认读取当前工作区中的 `.agents/rules/index.md` 与适用 active 规则，也可显式固定到另一个 rules commit。把固定代码 range 与封印规则快照消费为 `ruleSet -> targets -> applicabilityMatrix -> reviewItems -> executionPlan -> reviewBatches -> results -> finalReview`，并用 validator 校验协议闭合。仅审查已提交代码；默认只读，不维护规则仓，不替代全量功能 QA。
disable-model-invocation: true
---

# 规范审查

`rules-review` 使用 `schemaVersion = 6`。代码 TARGET 只能是 Git commit；规则输入与代码 TARGET 独立。每个新的 TARGET 都创建全新 run，完整审查该 TARGET 的全部当前 `reviewItems`，不继承旧结果，也不把修复轮当作增量审查。

`protocolGate = "passed"` 只表示本轮结构协议闭合，不表示代码无问题。代码结论同时看 `semanticVerdict`、`issueSummary` 和 `recommendation`。

## 1. 解析用户入口

controller 只把用户语法解析为固定的 BASE commit 与 TARGET commit，不把入口写法保存进工件：

| 用户请求 | BASE | TARGET |
| --- | --- | --- |
| `commit <rev>` | 唯一可解析的 base | commit tree |
| `commit <rev> --base <base-rev>` | 指定 commit | commit tree |

BASE、TARGET 或目标解释不唯一时立即 blocked，不任选一种解释。用户要求审查 current、staged、worktree、branch 或裸 tree 时，停止并要求先形成目标 commit；不要把这些入口静默降级为 commit 审查。

内部封印接口：

```text
node scripts/validate.js --mode seal-dispatch \
  --input <dispatch.json> \
  --base <revision> \
  --target-commit <revision> \
  [--rules-commit <revision>]
```

`--target-commit` 是唯一 TARGET selector，成功时固定 `targetTree = targetCommit^{tree}`、`boundCommit = targetCommit`、`excludedFiles = []`。未传 `--rules-commit` 时规则来源为当前工作区；传入时先解析为完整 commit OID，再从该 commit tree 读取规则。`excludedRuleRefs` 仍可形成规则范围分区。

draft 不得声明 `ruleInputSource`；该字段只能由 `seal-dispatch` 根据命令参数生成。发现 draft 已携带该字段时 fail closed，不覆盖。`seal-dispatch` 不创建 Git object，不修改真实 index、工作文件、staged/unstaged 状态或 worktree 列表。作为命令控制输入的 `dispatch.json` 不属于 TARGET；TARGET 只由指定 commit 决定。已经带有 `targetTree` 的 dispatch 不得原地重封；新 TARGET 必须创建新 run。

## 2. 不可变输入

封印后的范围为：

```yaml
reviewRange:
  baseCommit: <累计审查起点 commit>
  baseTree: <累计审查起点 tree>
  targetTree: <实际接受并审查的 tree>
  boundCommit: <实际接受并审查的 target commit>
  excludedFiles: []
```

`baseTree` 与 `targetTree` 分别从 `baseCommit` 与 `boundCommit` 只读派生。`boundCommit` 在封印时必须存在，且其 tree 必须等于 `targetTree`。

规则输入身份为：

```yaml
# 默认
ruleInputSource:
  kind: workspace

# 显式 --rules-commit
ruleInputSource:
  kind: commit
  commit: <完整 commit OID>
```

不保存短 revision，也不增加 `ruleTree`。

代码输入快照为：

```yaml
inputSnapshot:
  files:
    - inputRef: src/example.ts
      state: present
      mode: "100644"
      contentHash: sha256:...
    - inputRef: src/deleted.ts
      state: deleted
```

规则快照为：

```yaml
ruleSnapshot:
  files:
    - path: .agents/rules/index.md
      content: <封印文本>
      contentHash: sha256:...
```

`ruleSnapshot` 是规则文件内容的事实源。封印后所有 controller、reviewer、task builder、aggregator 和 renderer：

```text
# 代码
git diff <baseTree> <targetTree>
git show <targetTree>:<path>

# 规则
只读取 ruleSnapshot
```

代码输入每次消费前仍复验 commit、tree、blob 与 `inputSnapshot`。`workspace` 规则在封印后不得重新读取工作区；只校验 snapshot 字节、hash 和投影闭合。`commit` 规则除相同内部校验外，还复验 snapshot 与 `ruleInputSource.commit^{tree}` 中的对应文件一致。对象或规则文件缺失时原 run 立即失效，不在原 runId 下重建，也不回退工作区、代码 TARGET 或其它 commit。

rules-review run 是临时运行数据，不承诺跨会话、跨环境、跨天或长期恢复。

## 3. 文件范围

审查范围固定为完整 commit range：

```text
候选变更 = git diff <baseCommit> <boundCommit>
excludedFiles = []
```

不支持文件排除。漏项、非普通 blob 或无法唯一读取的 entry 都 blocked。`excludedRuleRefs` 仍可形成规则范围分区。

`scopeMode` 只按最终范围事实派生：

```text
excludedRuleRefs 非空 => scoped
excludedRuleRefs 为空 => full
```

不保存用户是否显式输入 paths，也不接受局部文件 commit 审查。

## 4. 规则与目标

项目规则入口是 `.agents/rules/index.md`。controller 必须从命令选择的同一规则来源读取索引、候选规则、active 状态、`trigger / applies-to` 元数据和规则正文：

- `workspace`：读取当前文件系统，包含未提交规则内容。
- `commit`：只读取 `ruleInputSource.commit` 对应 tree；内容不足时 blocked，不从工作区或代码 TARGET 补充。

controller 据此形成稳定 `ruleRef`、来源文件和 `ruleSet` 投影；`seal-dispatch` 从同一来源生成 `ruleSnapshot`，并用 `sourceFile / sourceHash` 绑定 `ruleSet.ruleSources`。`summary / ruleText` 等 reviewer 投影不得反向覆盖 snapshot。

规则集合必须是完整互斥分区：

```text
candidateRuleRefs
= selectedRuleRefs
∪ excludedRuleRefs
∪ globallyNotApplicableRuleRefs

requiredRuleRefs ⊆ selectedRuleRefs
```

- `selectedRuleRefs`：实际进入本轮适用性判断和审查的规则。
- `excludedRuleRefs`：已判定适用，但被有意跳过的规则。
- `globallyNotApplicableRuleRefs`：不适用于当前 TARGET 的规则。
- `requiredRuleRefs`：selected 中必须逐目标完成适用性判断的规则。

validator 校验来源身份、snapshot 字节与 hash、声明集合的完整互斥和引用闭合；候选发现、元数据提取与适用性结论由 controller/reviewer 负责。

目标统一使用 `targetId`。最小审查原子为：

```text
ruleRef x targetId = reviewItem
```

对每个 `requiredRuleRefs x targets` 组合先生成一行 `applicabilityMatrix`：

- `applicable` 必须绑定匹配的 `required: true` reviewItem。
- `not_applicable` 必须写 reason，不得绑定 reviewItem。
- evidence 必须可定位。

`reviewItems` 只能引用 selected 规则。每个当前 reviewItem 必须恰好进入一个当前 batch，并由当前 run 的 shard 返回恰好一个 result。`no_batch` 只允许 `reviewItems` 为空。

## 5. 工件与职责

```text
.rules-review-tmp/<run-id>/
  dispatch.json
  tasks/<reviewBatchId>.json
  retries/<reviewBatchId>-retry-<n>.json
  shards/<reviewBatchId>.json
  validations/<artifact>.json
  finalReview.json
  final.md
  response.md
```

所有 agent 间工件必须是 strict JSON。

- `dispatch.json`：controller 的规则、目标、适用性、固定 range 和分派计划；不得含审查结论。
- `tasks/*.json`：由 `build-tasks` 从 dispatch 机械投影，携带相同 `reviewRange`、`ruleInputSource`、`inputSnapshot`，以及规则索引和本批规则的 `ruleSnapshot`；`taskHash` 是删除自身字段后整份 task 的 canonical JSON SHA-256。
- `shards/*.json`：reviewer 对本 batch 的当前结果，必须回显 task 的 `targetTree` 与 `taskHash`；是产生 `passed / finding / observation / not_applicable / cannot_verify` 的唯一位置。可选的 `otherConcerns` 只承载审查过程中自然注意到的规则外事项。
- `finalReview.json`：由 `aggregate-final` 仅从当前 run 的 shards 聚合。
- `final.md`、`response.md`：展示层，不是事实源。

不允许从旧 run 复制 result，不允许扫描目录猜测前序 run，不允许在 dispatch 中引用旧 review 工件。

## 6. reviewer 执行

reviewer 必须按 task 中的全部 reviewItems 返回结果，不能依赖主线程历史补齐规则或目标。审查代码只能使用固定 tree diff/blob；规则正文只以 task 与 `ruleSnapshot` 的封印内容为准，不因 `ruleInputSource = workspace` 回读当前工作区。

结果要求：

- `passed`：包含 evidence 与 failureChecks。
- `finding`：包含 origin、evidence；MUST finding 为 must_fix。
- `observation`：包含 origin，以及 reason 或 evidence。
- `not_applicable`：只允许非 required reviewItem，包含 reason。
- `cannot_verify`：包含 reason 或 evidence。

阅读规则判断所需的业务链路是允许的；顺带发现规则外问题也可能发生，但不得把它写成 finding 或 observation。若值得提醒，只能写入 shard 顶层可选的 `otherConcerns: string[]`：

- 每项是普通文本，不要求 evidence、`ruleRef`、优先级或 finding ID。
- 不为它额外阅读、测试或重试，也不自动启动普通代码 review；非字符串、空字符串和重复项在聚合时直接忽略。
- 不进入 `findings`、`observations`、`issueSummary`，不改变 `semanticVerdict`、`recommendation` 或协议门禁。
- 没有内容时省略；最终仅在有内容时输出 `## 其他关注项`。

机器只验证结构、引用和结果闭合，不根据内容猜测结果是否正确。

需要多 batch 或用户明确要求并行审查时，读取 [references/subagent-all-aspects.md](references/subagent-all-aspects.md)。

## 7. 命令顺序

```text
seal-dispatch
dispatch
build-tasks
task
shard
aggregate-final
render-final
run
render-response
```

主要命令：

```text
node scripts/validate.js --mode dispatch --input dispatch.json
node scripts/validate.js --mode build-tasks --dispatch dispatch.json --out tasks/
node scripts/validate.js --mode task --input tasks/<reviewBatchId>.json
node scripts/validate.js --mode shard --task tasks/<reviewBatchId>.json --input shards/<reviewBatchId>.json
node scripts/validate.js --mode aggregate-final --dir .rules-review-tmp/<run-id> --output finalReview.json
node scripts/validate.js --mode render-final --input finalReview.json --dispatch dispatch.json --output final.md
node scripts/validate.js --mode run --dir .rules-review-tmp/<run-id>
node scripts/validate.js --mode render-response --dir .rules-review-tmp/<run-id>
```

任何阶段的 Git identity、hash、mode、范围、引用或状态不闭合都 fail closed。不得静默生成替代 tree、降级成当前文件或把不完整结果写成通过。

## 8. 机器边界

validator 检查：

- schemaVersion、固定字段、路径与 strict JSON。
- commit/tree/blob 存在，baseCommit/tree、boundCommit/tree 身份一致，且 `excludedFiles = []`。
- 完整 commit 文件范围和规则声明分区闭合。
- input snapshot 的 mode、hash、内容与 `targetTree` 一致。
- `ruleInputSource` 身份、rule snapshot 字节/hash 与规则投影闭合；commit 来源额外与对应 commit tree 一致。
- task 投影、batch 引用和当前结果唯一覆盖。
- finalReview、Markdown 与当前结果的机械派生一致。

validator 明确不检查：

- BASE 选择是否符合业务意图。
- 候选规则发现、元数据提取、规则投影语义、适用性结论和 finding 是否正确。
- evidence 强度或可信度。
- target、inputRefs 与 hunk 的业务归属。
- review 是否足够深入。

这些判断由 controller/reviewer 记录依据并承担责任，不能写成关键词启发式或规模阈值冒充语义审查。

## 9. 输出

`final.md` 必须展示规则来源类型；commit 来源同时展示完整 OID。最终回复仍直接复用 `render-response` 生成的 `response.md`，不增加规则来源字段。第一眼同时展示审查结论、问题数、无法验证数量与修复建议；不得把 `protocolGate = "passed"` 简写成“代码通过”。只有存在 `otherConcerns` 时才追加 `## 其他关注项`，且该小节不改变前述结论。
