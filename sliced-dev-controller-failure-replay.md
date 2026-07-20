# sliced-dev controller 小型失败回放

> 日期：2026-07-20
>
> 对象：当前 `master` 上的 `sliced-dev` / `rules-review` controller 边界
>
> 状态：第一轮合成回放完成；最小 P2 已落地

## 结论

本轮通过错误注入回放 5 个 controller 高负担场景：

- R1、R2、R3 注入的错误状态都能通过当前结构校验；其中 R1 是自由文本被当成恢复提示，R2 是有意保留给 controller 的授权语义，R3 是当前 plan 无法证明字段写入时间。
- R4 的 lineage、明确终态和占位原因由机器门禁保护，但非占位原因是否真实仍由 controller / reviewer 判断。
- R5 中，若 controller 在 dispatch 前漏掉一条语义上适用的规则，该规则不会进入 validator 可见集合；机器只能证明已选集合内部闭合。
- 当前证据不支持新增完整 `next` controller、持久化 controller-step brief 或更多状态字段。

合成回放已经足以确认门禁覆盖边界，不需要等待真实任务复现。最小 P2 已只处理 R1：`show current` / `roster` 将自由文本显示为 `下一步记录（未校验）`，续跑契约明确合法动作仍由当前阶段、当前切片、门禁和 open D 决定；没有把 R2、R4、R5 的语义判断搬进脚本。

## 回放方法

- 用当前 `SKILL.md`、`EXECUTION-RULES.md`、`SCRIPTS.md`、`PLAN-FILE.md`、subagent 契约和 validator 实现还原预期行为。
- 用历史修正提交定位真实失败类型：`f79fdb4`、`f5382d3`、`57113b6`、`8492290`、`2630164`。
- 对 R1、R2 在临时目录内注入错误 plan 状态并调用当前 validator，不修改仓库 fixture。
- 对 R3、R4 复用现有定向测试，验证当前结构门禁实际行为。
- 对 R5 做 oracle-omission 回放：在 dispatch 形成前省略一条语义上适用的规则，再按当前协议分析 validator 的可见输入。

本轮 mock 能回答“错误能否被现有门禁拒绝”，不能回答“模型实际多频繁地产生该错误”。后者属于效果评测，不影响本轮门禁覆盖结论。

## 结果总表

| ID | 场景 | 当前保护 | 回放结果 | 责任分类 | P2 处理 |
| --- | --- | --- | --- | --- | --- |
| R1 | 跨 context 恢复后选择下一动作 | `roster` / `show current` 收窄读取范围 | `下一步` 可写成“直接提交代码”且 `validate` 无错误 | 结构与语义混合 | 已处理：输出降级为 `下一步记录（未校验）`，不新增状态机 |
| R2 | 把“继续 / 确认”误当跨阶段授权 | 文档固定确认语义和硬顺序 | 未保留用户口令证据也可把拷问状态写成 `no-grill`，`validate` 无错误 | 语义 / 授权 | 保留 controller 责任，不写关键词 validator |
| R3 | 越界后回填 `允许修改` / `基线脏文件` | `diff-check` 校验当前路径边界 | 修改当前 plan 后可重新通过，无法证明字段是在派发前记录 | 时间归属 / provenance | 保留已知残余风险；重复发生后再评估不可变派发快照 |
| R4 | 错选 full / incremental general review | package hash、A*、直接基线和 G* lineage fail-closed | 结构保护有效；非占位 full reason 的业务真实性不检查 | 语义 / 审查可信度 | 不改脚本 |
| R5 | 漏选适用规则或错判适用性 | selectedRuleIds、dispatch、matrix、run 与 package 结构绑定 | 被漏掉的规则不进入 validator 可见集合；已选集合内部仍可结构闭合 | 语义 / scope | 保留 controller + reviewer 责任 |

## R1：恢复后走错机械阶段

### 输入

从 `init` 生成的合法 draft 开始，只把：

```text
下一步：完成任务级分叉门禁并产出切片
```

改为：

```text
下一步：直接提交代码
```

### 期望

- 不能把这段自由文本当成合法动作证明。
- 恢复时应结合 `阶段`、当前切片和结构门禁重新判断，而不是直接执行该文本。

### 实际

临时回放输出：

```json
{
  "injectedNext": "直接提交代码",
  "validationErrors": []
}
```

P1 回放时，validator 校验 `阶段` 枚举和 `当前切片`，但不校验 `下一步`，`show current` / `roster` 仍原样渲染它。P2 已把公共输出降级为 `下一步记录（未校验）`，但没有伪装成能校验内容语义。当前证据见 `skills/sliced-dev/scripts/dev-plan.mjs:4469-4485`、`5048-5113`。

### 判断

合成回放已经证明当前门禁看不见该错误；它不需要再靠真实任务复现才能成立。R1 是本轮唯一低成本机械化候选，但仍不支持新增完整 controller 命令。最小 P2 已调整现有展示契约：公共 `renderPlanHead` 将 `下一步` 明示为未校验记录，`SKILL.md` 要求根据现有状态与门禁决定动作。

## R2：确认词跨阶段污染

### 输入

从 `init` 生成的合法 draft 开始，在没有保留任何用户口令证据的情况下，把：

```text
计划一致性检查：pending
拆分拷问状态：pending-grill
```

改为：

```text
计划一致性检查：passed
拆分拷问状态：no-grill
```

该注入模拟 controller 把普通“继续 / 确认 / 好的”错误解释成拷问选择或跨阶段授权。相关历史修正在 `f79fdb4`。

### 期望

- 普通确认词不能替代 `拷问 / 不拷问`。
- 只有 `结束拷问` 能结束拷问。
- 没有明确执行预告时，“继续 / 确认”不能授权实现。

### 实际

临时回放输出：

```json
{
  "injectedState": "未保留用户口令证据但写成 no-grill",
  "validationErrors": []
}
```

当前规则已经明确确认语义，见 `skills/sliced-dev/EXECUTION-RULES.md:5-16`、`254-256`。但现有工件没有、也不应伪造一个能证明会话解释正确的机器字段；controller 仍可能错误推进后再写出结构合法的状态。

### 判断

mock 已证明机器门禁不覆盖该错误，同时也证明不了用户真实意图。这里是有意保留的授权语义边界，不应通过关键词脚本判断；真实会话样本只能评估规则效果，不能改变该责任分类。

## R3：执行边界的时间归属

### 输入

历史失败类型：把执行清单调整误当成用户授权变化，或在实际 diff 越界后回填边界使门禁通过。相关修正在 `f5382d3`。

现有测试明确展示：一个当前被判为越界的脏文件，在写入 `基线脏文件` 后，`diff-check` 返回空错误，见 `tests/sliced-dev/dev-plan.test.mjs:2263-2285`。

### 期望

- 派发前漏记的脏文件不能事后补入基线。
- 实际 diff 越过旧 task brief 时，本轮接收门禁必须失败并确认归属。
- 合法扩执行边界必须先重跑预检，再生成新 brief、重新派发。

### 实际

文档已经明确禁止回填，见 `skills/sliced-dev/EXECUTION-RULES.md:262-269`；但 `diff-check` 只读取当前 plan，无法知道字段写入时间，也无法证明旧 brief 未被覆盖。

### 判断

这是已被 mock 证明的 provenance 残余风险。若要机器证明，需要不可变派发快照或等价绑定，会明显扩大状态和脚本；其成本明显高于 R1，因此本轮只记录，不实现。

## R4：full / incremental 可信度

### 输入

历史失败类型：局部返修后重新全量审查，或在原 full 基线已不可信时仍做 incremental。相关修正在 `57113b6`、`8492290`。

### 期望

- 基线结构缺失、多义、非 `done` 或 G* 静默消失时 fail-closed。
- 审查契约实质变化或无法证明连续 fix diff 时重新 full。
- 其它情况只审开放 finding 和本轮 fix diff。

### 实际

当前测试证明 lineage 和非占位原因门禁有效：

- incremental 绑定当前 `done` A*：`tests/sliced-dev/dev-plan.test.mjs:3900-3923`。
- 明示非占位原因即可 full：`3992-4011`。
- `TBD` 原因会被拒绝：`4014-4031`。

这同时证明边界：脚本能检查“写了原因”，不能判断“任务范围已重建”是否属实。该责任已在 `skills/sliced-dev/EXECUTION-RULES.md:341-346` 和 `SCRIPTS.md:172` 明确留给 controller / reviewer。

### 判断

当前分工合理。继续增加内容真实性启发式只会制造假控制。

## R5：规则范围和适用性

### 输入

在 dispatch 形成前，故意省略一条语义上适用于当前 target 的规则；其余已选规则继续生成完整 applicability matrix、tasks、results 和 finalReview。该注入模拟 controller 漏选规则。相关历史收紧见 `2630164`。

### 期望

- controller 固定当前 scope、selectedRuleIds 和可信直接上一轮 baseRunId。
- rule-reviewer 只消费规则包，不重建范围。
- validator 绑定 dispatch、matrix、结果、run 和 sliced-dev package。

### 实际

被省略的规则没有进入 `selectedRuleIds`，因此不会出现在 validator 的 rule × target 闭合域内；其余工件仍可结构闭合。当前 `rules-review` 明确声明机器不判断适用性语义，见 `skills/rules-review/SKILL.md:78-83`；validator 也明确不证明 current scope / inputRefs 的语义完整性和 baseRunId 的真实直接前驱关系，见 `509-518`。

### 判断

当前分工合理。漏选规则只能通过 controller 证据和 reviewer 复核降低风险，不能靠 schema 猜出未选择内容。

## 本轮验证

R1、R2 的临时错误注入均得到：

```text
validationErrors: []
```

定向重跑 4 个现有测试，覆盖 R3 的基线脏文件回填和 R4 的 general review full / incremental：

```text
tests 195
pass 4
fail 0
skipped 191
```

R5 是协议可见域的 oracle-omission 回放：结论来自当前契约明确声明的“不检查语义完整性”，不伪造一个无法证明语义正确性的通过测试。

最小 P2 定向回归覆盖 `roster` 和 `show current`，结果 `2/2` 通过。

仓库级 `./scripts/validate-all.sh` 退出码为 `0`，共 `198/198` 项通过。当前环境缺少 PyYAML，skill 结构校验使用脚本内置 fallback，其余 invocation policy 和测试均通过。

## 材料覆盖与剪枝判断

- 已覆盖：当前 `sliced-dev` 入口、执行规则、脚本说明、plan / subagent 关键契约、相关 validator 实现、相关测试和 5 个历史修正提交。
- 未覆盖：真实模型产生各类错误的频率、完整 `dev-plan.mjs` 逐函数审查、完整 `rules-review` 流程重演。
- 覆盖状态：`partial-coverage`。
- 剪枝判断：`已按建议局部剪枝`——没有新增完整 controller 工件；P2 只处理 R1 的展示权威性，其余场景继续维持“机器检查协议闭合，controller / reviewer 判断语义”的边界。
