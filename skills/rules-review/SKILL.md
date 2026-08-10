---
name: rules-review
description: 项目规则驱动的 commit 代码审查流程。代码 TARGET 固定为 commit；规则默认读取当前工作区中的 `.agents/rules/index.md` 与适用 active 规则，也可显式固定到另一个 rules commit。把固定代码 range 与封印规则快照消费为 `ruleSet -> targets -> applicabilityMatrix -> reviewItems -> reviewBatches -> results -> finalReview`，并用 validator 校验协议闭合。仅审查已提交代码；默认只读，不维护规则仓，不替代全量功能 QA。
disable-model-invocation: true
---

# 规范审查

`rules-review` 使用 `schemaVersion = 8`。代码 TARGET 只能是 Git commit；规则输入与代码 TARGET 独立。每个新的 TARGET 都创建全新 run，完整审查该 TARGET 的全部当前 `reviewItems`，不继承旧结果，也不把修复轮当作增量审查。

`protocolGate = "passed"` 只表示本轮结构协议闭合，不表示代码无问题。代码结论同时看 `semanticVerdict`、`issueSummary` 和 `recommendation`。

## 1. 解析用户入口

controller 只把用户语法解析为固定的 BASE commit 与 TARGET commit，不把入口写法保存进工件：

| 用户请求 | BASE | TARGET |
| --- | --- | --- |
| `commit <rev>` | 唯一可解析的 base | commit tree |
| `commit <rev> --base <base-rev>` | 指定 commit | commit tree |

BASE、TARGET 或目标解释不唯一时立即 blocked，不任选一种解释。用户要求审查 current、staged、worktree、branch 或裸 tree 时，停止并要求先形成目标 commit；不要把这些入口静默降级为 commit 审查。

创建 construction input 前，controller 必须为本轮生成新的 `runId`：

```text
<YYYYMMDDTHHmmssZ>-rr-<8 位小写十六进制随机串>
```

时间使用生成时的 UTC，例：`20260810T073012Z-rr-a1b2c3d4`。每个 fresh run 都重新生成，目录已存在时重新生成，不复用旧值。日期用于排序和辨认，随机后缀用于降低碰撞；不得在 `runId` 中编码 TARGET、branch、schemaVersion 或审查结论，这些事实只读取正式字段。

controller 完成规则分区、targets、适用性决定和 batch 分组后，只写
`kind = "rules-review-dispatch-construction-input"`、`schemaVersion = 2`
的紧凑 dispatch 语义输入，再使用官方构造入口：

```text
node scripts/validate.js --mode construct-dispatch \
  --input .rules-review-tmp/<run-id>-construction.json \
  --output .rules-review-tmp/<run-id>/dispatch.json
```

该 v2 输入使用固定字段集合和固定投影描述；v1 直接拒绝。`repository` 必须包含完整
`baseCommit`、`targetCommit` 和 `excludedFiles = []`；默认省略 `rulesCommit`
以读取当前 workspace 规则，显式固定规则来源时才填写完整 `rulesCommit`。
`catalogSource` 必填，并逐字段复制 `rule-steward --catalog` 输出的 `source`：

```json
{
  "kind": "rules-review-dispatch-construction-input",
  "schemaVersion": 2,
  "catalogSource": {
    "kind": "workspace",
    "indexHash": "sha256:...",
    "files": [
      {
        "path": ".agents/rules/concerns/testing.md",
        "contentHash": "sha256:..."
      }
    ]
  }
}
```

commit 来源的 `catalogSource` 还必须携带与 `repository.rulesCommit` 相同的完整
规范 OID。v2 不携带 catalog 条目、`indexFile` 或 `ruleSourceFiles`。其它 kind、
未知字段、非规范 commit OID 或不符合 `rule-steward` Namespaces 表协议的规则索引
一律 fail closed。

入口从当前 Git worktree 读取固定的 BASE、TARGET 和所选规则来源，按
`selectedRuleRefs × targetOrder` 顺序展开适用性矩阵，并按 `A = 适用`、
`N = 不适用` 连续分配 reviewItem ID。batch key 直接成为 `reviewBatchId`。
规则投影只读取 `rule-steward` 定义的 active 规则固定字段；规则分区、targets、
适用性决定和顶层 `batchRuleRefs` 全部来自输入。入口校验 `expectedCounts`，
生成快照和 hash，验证完整 v8 dispatch 后再以“同一 run 仅允许一次成功”的
方式原子写入最终文件。

controller 不得直接写完整 v8 draft，不得新建或内联执行 JS、Shell、Python、
`jq` 等生成逻辑，也不得手工展开 applicabilityMatrix、reviewItems 或
reviewBatches。把生成器放到 run 目录外、在最终校验前删除，或解释为“一次性
辅助脚本”都不改变该边界。`seal-dispatch` 只保留为内部兼容接口，不是
controller 入口；官方 `construct-dispatch` 无法闭合时，本轮必须 blocked。

`construct-dispatch` 内部固定 `targetTree = targetCommit^{tree}`、
`boundCommit = targetCommit`、`excludedFiles = []`。省略 `rulesCommit` 时规则
来源为当前工作区；填写时只从该 commit tree 读取规则。写出前从该来源重新发现
index 与全部 active 文件，校验 `catalogSource` 的来源身份、index hash、active
文件路径全集及逐文件 hash，并重新检查可选 `retired.md` 与 active IDs 无交集。
`retired.md` 不进入 catalog hash、dispatch snapshot 或 reviewer task。构造与封印
复用同一次规则快照，避免 workspace 内容在两阶段之间漂移。该过程不创建 Git
object，不修改真实 index、工作文件、staged/unstaged 状态或 worktree 列表。
新 TARGET 必须创建新 run。

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

# 显式 rulesCommit
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
    - path: .agents/rules/concerns/testing.md
      content: <封印文本，包括空文本>
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

项目规则入口是 `.agents/rules/index.md`。controller 必须按以下顺序从同一规则来源完成分类：

```text
确定 ruleInputSource
→ 生成并浏览全部 catalog 条目
→ trigger / appliesTo 足以明确排除的规则归入 globallyNotApplicableRuleRefs
→ 对可能适用或仅凭 catalog 无法判断的规则，按 ID 批量获取完整规则块
→ 根据完整规则完成 selected / excluded / globallyNotApplicable 三分区
→ 提交 construction input v2
```

命令分别为：

```text
# workspace
node skills/rule-steward/scripts/get-rules.mjs --catalog
node skills/rule-steward/scripts/get-rules.mjs <RULE-ID>...

# commit
node skills/rule-steward/scripts/get-rules.mjs --catalog --commit <FULL-OID>
node skills/rule-steward/scripts/get-rules.mjs --commit <FULL-OID> <RULE-ID>...
```

catalog 只保证完整发现并投影标题、级别、namespace trigger、生效条件和来源文件，
不替代完整规则内容。完整规则仍不足以判断适用性时，本轮 blocked；不得默认归为
不适用。

- `workspace`：读取当前文件系统，包含未提交规则内容。
- `commit`：只读取 `ruleInputSource.commit` 对应 tree；内容不足时 blocked，不从工作区或代码 TARGET 补充。

controller 据此形成稳定 `ruleRef`、来源文件和规则分区；`construct-dispatch` 从同一次规则快照生成 `ruleSet` 与 `ruleSnapshot`，并用 `sourceFile / sourceHash` 绑定 `ruleSet.ruleSources`。`summary / ruleText` 等 reviewer 投影不得反向覆盖 snapshot。active rule 缺少非空、两空格缩进的 `通过条件` 列表时构造入口 fail closed，不兼容旧格式规则来源；需要继续审查时创建 fresh run。

规则集合必须是完整互斥分区：

```text
candidateRuleRefs
= selectedRuleRefs
∪ excludedRuleRefs
∪ globallyNotApplicableRuleRefs
```

`candidateRuleRefs` 必须等于 catalog 的全部 active rule IDs，三分区必须覆盖全集。

- `selectedRuleRefs`：实际进入本轮逐目标适用性判断和审查的规则。
- `excludedRuleRefs`：已判定适用，但被有意跳过的规则。
- `globallyNotApplicableRuleRefs`：不适用于当前 TARGET 的规则。

validator 从 dispatch snapshot 独立复算 active 文件和 rule IDs，校验来源身份、
snapshot 字节与 hash、声明集合的完整互斥和引用闭合；候选浏览、元数据的业务含义
与适用性结论由 controller/reviewer 负责。

目标统一使用 `targetId`。最小审查原子为：

```text
ruleRef x targetId = reviewItem
```

对每个 `selectedRuleRefs x targets` 组合先生成一行 `applicabilityMatrix`：

- `applicable` 必须绑定匹配的 reviewItem。
- `not_applicable` 必须写 reason，不得绑定 reviewItem。
- evidence 必须可定位。

`reviewItems` 只能引用 `selectedRuleRefs`，不含可选或 `required` 状态。非空 TARGET 中，每条 selected 规则必须至少生成一个 reviewItem；空 TARGET 可保留 selected 规则但不生成矩阵、reviewItem 或 batch。每个当前 reviewItem 必须恰好进入一个当前 batch，并由当前 run 的 shard 返回恰好一个 result。`reviewBatches` 只保存 `reviewBatchId` 与 `reviewItemIds`；任务路径、shard 路径和完成态均由当前 run 的文件派生。

## 5. 工件与职责

```text
.rules-review-tmp/<run-id>/
  dispatch.json
  tasks/<reviewBatchId>.json
  shards/<reviewBatchId>.json
  validations/<artifact>.json
  finalReview.json
  final.md
  response.md
  handoff.md
```

所有 agent 间工件必须是 strict JSON。

- `dispatch.json`：controller 的规则、目标、适用性、固定 range 和静态 batch 分组；不得含审查结论或 batch 运行状态。
- `tasks/*.json`：由 `build-tasks` 从 dispatch 机械投影，携带相同 `reviewRange`、`ruleInputSource`、`inputSnapshot`，以及规则索引和本批实际使用规则文件的 `ruleSnapshot`；不携带其它 active 文件或 `retired.md`。`taskHash` 是删除自身字段后整份 task 的 canonical JSON SHA-256。
- `shards/*.json`：reviewer 对本 batch 的当前结果，必须回显 task 的 `targetTree` 与 `taskHash`；是产生 `passed / finding / observation / cannot_verify` 的唯一位置。可选的 `otherConcerns` 只承载审查过程中自然注意到的规则外事项。
- `finalReview.json`：由 `aggregate-final` 仅从当前 run 的 shards 聚合；同一 batch 内相同显式 `rootCause` 的 finding results 合并为一个 finding，并逐项保留 `evidenceGroups`。
- `final.md`、`response.md`、`handoff.md`：展示层，不是事实源。`handoff.md` 由 `finalReview.json` 与 `dispatch.json` 机械渲染，用于把目标 commit、审查结论、全部 finding 和 `cannot_verify` 转交给其他同事；代码位置只保留仓库相对路径，不生成本机绝对路径链接。

不允许从旧 run 复制 result，不允许扫描目录猜测前序 run，不允许在 dispatch 中引用旧 review 工件。

合法 task 与 shard 到达后保持封印 dispatch 不变：`aggregate-final` 和 `run` 按
`tasks/<reviewBatchId>.json`、`shards/<reviewBatchId>.json` 的存在性与校验结果
派生完成态。不得手工添加或修改 `shardRef`、`returnStatus`、
`aggregateStatus`、`unaggregatedReason` 等状态字段。协议没有 `retry-task` 或
`retries/` 工件；shard 不合规时由原 reviewer 重新提交同一路径的完整 shard。

## 6. reviewer 执行

reviewer 必须按 task 中的全部 reviewItems 分别完成审查并返回结果，不能在发现首个问题后停止，也不能依赖主线程历史补齐规则或目标。语义相连的 targets 仍是独立 reviewItems；审查代码只能使用固定 tree diff/blob；规则正文只以 task 与 `ruleSnapshot` 的封印内容为准，不因 `ruleInputSource = workspace` 回读当前工作区。

reviewer 按 `ruleRef` 从 `ruleSnapshot` 中读取完整规则块。`规则` 是语义真源；全部 `通过条件` 必须忠实覆盖该正文，`失败条件` 只是非穷尽反证。若通过条件遗漏、扩大或改变规则正文，先停止当前 run 并报告规则定义缺陷；只有取得用户对规则维护的明确授权后，才能按 `rule-steward` 维护规则并针对同一 TARGET 创建 fresh run。授权前不得修改 `.agents/rules/`，也不得把规则定义缺陷归责于被审查对象。`生效条件` 仍独立决定适用范围，通过条件不得扩大适用性；规则级别只影响处置，不改变是否满足的事实。

结果要求：

- `passed`：包含 evidence 与 failureChecks；evidence 必须足以证明全部通过条件，failureChecks 仍只记录失败条件检查，不能替代正向证明。
- `finding`：包含 origin、evidence 和非空 `rootCause`，并明确指出未满足的通过条件；MUST finding 为 must_fix。
- `observation`：包含 origin，以及 reason 或 evidence。
- `cannot_verify`：包含 reason 或 evidence。

finding 必须明确指出哪项通过条件未满足。`rootCause` 仍描述导致该条件未满足的失效不变量，并保持现有根因分组语义；evidence 只记录可定位的当前事实，可以说明该事实如何反证对应通过条件，但不得承载未来实现步骤或把修复方案当作证据。

reviewer 若能确认某个 reviewItem 实际不适用，即判定上游适用性输入错误：不得用 `passed / finding / observation / cannot_verify` 中的任何状态代替 `not_applicable`，也不得写合法 shard。reviewer 必须停止当前 batch 并通知 controller；controller 作废当前 run，不聚合、不用于门禁，再针对同一 TARGET 以修正后的适用性输入创建 fresh run。

同一 batch 内多个 reviewItem 分别违反规则但属于同一根因时，每项仍返回 `finding`，并使用字节完全相同的 `rootCause` 描述共同失效的不变量。aggregator 只按 batch 身份与这个显式值机械分组，不根据措辞相似度、代码位置或证据内容猜测：

- final finding 的 priority 取组内最高级别，`must_fix` 优先于 `should_fix`。
- 每个原始 finding result 都保留为独立 `evidenceGroups` 项，不能因合并而丢失 target、ruleRef、origin、priority 或 evidence。
- 同一 batch 由 reviewer 完成根因对齐；不同 batch 即使 `rootCause` 字节完全相同也不合并。
- v8 不支持跨 batch 根因身份；后续如需支持，必须引入经显式确认的独立身份，不能依赖自由文本碰撞。
- 根因是否相同是 reviewer 的语义判断；validator 只校验 `rootCause` 已记录、精确分组和结果引用闭合。

阅读规则判断所需的业务链路是允许的；顺带发现规则外问题也可能发生，但不得把它写成 finding 或 observation。若值得提醒，只能写入 shard 顶层可选的 `otherConcerns: string[]`。已违反当前 task 规则的事项必须保留为对应 reviewItem 的正式 result，即使它与其它 result 同根因，也不得降级到 `otherConcerns`：

- 每项是普通文本，不要求 evidence、`ruleRef`、优先级或 finding ID。
- 不为它额外阅读、测试或重试，也不自动启动普通代码 review；非字符串、空字符串和重复项在聚合时直接忽略。
- 不进入 `findings`、`observations`、`issueSummary`，不改变 `semanticVerdict`、`recommendation` 或协议门禁。
- 没有内容时省略；最终仅在有内容时输出 `## 其他关注项`。

机器只验证结构、引用和结果闭合，不根据内容猜测结果是否正确。

需要多 batch 或用户明确要求并行审查时，读取 [references/subagent-all-aspects.md](references/subagent-all-aspects.md)。

## 7. 命令顺序

```text
construct-dispatch
dispatch
build-tasks
task
shard
aggregate-final
render-final
run
render-response
render-handoff
```

主要命令：

```text
node scripts/validate.js --mode construct-dispatch --input .rules-review-tmp/<run-id>-construction.json --output .rules-review-tmp/<run-id>/dispatch.json
node scripts/validate.js --mode dispatch --input dispatch.json
node scripts/validate.js --mode build-tasks --dispatch dispatch.json --out tasks/
node scripts/validate.js --mode task --input tasks/<reviewBatchId>.json
node scripts/validate.js --mode shard --task tasks/<reviewBatchId>.json --input shards/<reviewBatchId>.json
node scripts/validate.js --mode aggregate-final --dir .rules-review-tmp/<run-id> --output finalReview.json
node scripts/validate.js --mode render-final --input finalReview.json --dispatch dispatch.json --output final.md
node scripts/validate.js --mode run --dir .rules-review-tmp/<run-id>
node scripts/validate.js --mode render-response --dir .rules-review-tmp/<run-id>
node scripts/validate.js --mode render-handoff --dir .rules-review-tmp/<run-id>
```

任何阶段的 Git identity、hash、mode、范围、引用或状态不闭合都 fail closed。不得静默生成替代 tree、降级成当前文件或把不完整结果写成通过。

## 8. 机器边界

validator 检查：

- schemaVersion、固定字段、路径与 strict JSON。
- `runId` 符合 `YYYYMMDDTHHmmssZ-rr-xxxxxxxx`，并在当前工件链中保持一致。
- commit/tree/blob 存在，baseCommit/tree、boundCommit/tree 身份一致，且 `excludedFiles = []`。
- 完整 commit 文件范围和规则声明分区闭合。
- input snapshot 的 mode、hash、内容与 `targetTree` 一致。
- construction v2 的 `catalogSource` 与实际 index、全部 active 文件路径及逐文件 hash 一致，active/retired ID 无交集，`candidateRuleRefs` 等于全部 active IDs。
- active rule 的 `通过条件` 字段存在，且是非空、两空格缩进的列表。
- `ruleInputSource` 身份、dispatch rule snapshot 字节/hash、完整 active 文件与规则投影闭合；commit 来源额外与对应 commit tree 一致。
- task 投影、batch 引用和当前结果唯一覆盖。
- finalReview、Markdown 与当前结果的机械派生一致。

validator 明确不检查：

- `runId` 时间戳是否来自可信时钟、随机后缀是否具有声明的熵；也不从名称推断 TARGET、版本或结论。
- BASE 选择是否符合业务意图。
- catalog 字段、规则正文、通过条件和规则投影的语义是否正确，或通过条件是否完整、忠实且未扩大适用范围；适用性结论和 finding 是否正确。
- 多个 finding results 是否确属同一根因，以及 `rootCause` 表述是否准确。
- evidence 是否足以证明全部通过条件，以及 evidence 强度或可信度。
- target、inputRefs 与 hunk 的业务归属。
- review 是否足够深入。

这些判断由 controller/reviewer 记录依据并承担责任，不能写成关键词启发式或规模阈值冒充语义审查。

## 9. 输出

`final.md` 必须展示规则来源类型；commit 来源同时展示完整 OID。最终回复仍直接复用 `render-response` 生成的 `response.md`，不增加规则来源字段。第一眼同时展示审查结论、问题数、无法验证数量与修复建议；不得把 `protocolGate = "passed"` 简写成“代码通过”。只有存在 `otherConcerns` 时才追加 `## 其他关注项`，且该小节不改变前述结论。

用户明确要求把审查结果转交给其他同事修复时，额外运行 `render-handoff` 生成 `handoff.md`。该文件展示完整 TARGET commit、runId、审查结论、finding 证据组和无法验证项；证据中的合法 `loc` 以仓库相对路径纯文本展示，非仓库相对位置不输出。不要用 `handoff.md` 替代 `finalReview.json` 或 `dispatch.json` 的事实源职责。
