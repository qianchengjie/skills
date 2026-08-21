# 切片开发 · 脚本

统一入口：

```bash
node <sliced-dev-skill-dir>/scripts/dev-plan.mjs <command> ...
```

退出码：`0` 成功，`1` 结构 / 状态 / binding 门禁失败，`2` 命令或参数错误。

## init

```bash
node <script> init <slug> --title "<title>" [--date YYYY-MM-DD] [--upstream <value>]
```

创建：

- `dev-plans/YYYY-MM-DD-<slug>/plan.md`
- `decisions.md`
- plan 根目录 `audits.md`
- 必要时给 `dev-plans/.gitignore` 追加 `*/review-packages/**`

不会创建 `claims/`、task brief/report、单片 review package 或空 `deliveries/`。task directory 只在真正委托时出现。

## validate

```bash
node <script> validate dev-plans/YYYY-MM-DD-<slug>
```

检查：

- plan、D/A 的标题、必填字段、exact slice schema 和枚举；
- 依赖存在与无环、open D 可见性、split/skipped 结构；
- 已存在 task 的 `deliver-task.task.v1` 合法且 immutable 投影与当前 plan 一致；
- `done / split` 与下游 `delivery.json` 的明确 result 映射；
- 启用整任务审查时的字段、hash 形状和明确 verdict。

它会调用 `deliver-task validate-task / validate-result` 复用下游 validator，不复制其 schema。它不判断拆分质量、代码语义、证据强度或 reviewer 结论。

## delegate-task

```bash
node <script> delegate-task <planDir> <S-id> [--refresh-base]
```

前置：

- 整份 plan 结构通过；
- 本片门禁闭合、风险 / 执行明确；
- 本片状态为 `not-started / in-progress / blocked`；
- 依赖均为 `done / skipped`。

输出位置：`<planDir>/deliveries/<taskId>/task.json`。

命令只写 task contract，不调用实现、不创建 `execution.json`。如果 immutable 投影与既有 task 相同，原文件及 revision/hash 保持不变；如果投影变化，revision 加一并以当前 HEAD 作为新 base。只有 caller 明确需要改变同一语义合同的 base 时才传 `--refresh-base`；该选项同样递增 revision，普通重跑不会因 HEAD 前进而改变 identity。写入后立即调用 `deliver-task validate-task`；失败会恢复原文件。

## delivery-status

```bash
node <script> delivery-status <planDir> <S-id>
```

先复用 `deliver-task validate-result`，再输出薄 JSON：

```json
{
  "sliceId": "S1",
  "taskDir": "dev-plans/example/deliveries/s1",
  "result": "delivered",
  "target": {},
  "evidenceRefs": {},
  "residualRiskRefs": [],
  "upstreamRequest": null
}
```

不复制 evidence 正文，不解释 upstream reason。controller 按 result 和引用证据推进 caller 生命周期。

## slice-close-check

```bash
node <script> slice-close-check <planDir> <S-id>
```

要求：

- 当前 slice 为 `done`；
- task projection 仍匹配 plan；
- `deliver-task validate-result` 通过；
- result 明确为 `delivered`。

该命令是 caller 收口检查，不重跑下游 `close-check`。下游在交付前已经固定并校验 target；caller 随后修改的 plan 文件不属于单任务执行 allowlist。

## plan-commit-check

```bash
node <script> plan-commit-check <planDir>
```

要求至少有一项 staged durable plan state，且 staged 集合只包含：

- `<planDir>/plan.md / decisions.md / audits.md`；
- `<planDir>/deliveries/<taskId>/task.json / execution.json / claims.json / audits.md / delivery.json / .gitignore`；
- `dev-plans/.gitignore`。

同时拒绝：

- 任意业务文件或其它计划目录；
- `deliveries/*/artifacts/**`；
- `review-packages/**`；
- 仍未 staged 的当前计划 durable change。

它检查 staged scope，不创建 commit，也不规定 commit message。

## whole-review-package

```bash
node <script> whole-review-package <planDir>
```

写入忽略的 `<planDir>/review-packages/whole-task.md`，并输出 `reviewPackageHash`。包内聚合：

- 当前 plan、D、plan 根目录 A；
- 每个 `done` slice 的 `task.json / delivery.json`；
- commit-range target 的固定 Git diff；
- 五项整任务 verdict 模板。

不生成单片 brief/report/review package，不读取或重写 deliver-task 内部审查状态。

## close-check

```bash
node <script> close-check <planDir>
```

要求完整 plan validation 通过且计划为 `done`。如果启用了整任务审查，还要求其明确为 `passed`，且 `reviewPackageHash` 与当前 `whole-task.md` 一致。它不从自然语言推断通过，也不创建 F commit；未启用整任务审查时仍应在最终 Kn 前运行。

## show / roster

```bash
node <script> show <planDir> current
node <script> show <planDir> S2.1
node <script> roster <planDir>
```

- `show` 展示当前或指定 slice 的 plan-owned 内容。
- `roster` 展示各片状态、门禁、风险、执行、依赖和薄 delivery result。

它们不会展开 `execution.json`、证据正文或单任务 review 内容。

## 已移出的命令

以下命令不再属于 sliced-dev CLI，调用时返回退出码 `2`：

- `diff-check`
- `claims-template`
- `task-brief`
- `task-report-template`
- `review-package`
- `rule-review-package`
- `rule-repair-check`
- `review-prompt`
- `pre-commit-check`
- `record-commit`

对应职责已经由 `deliver-task` 的执行协议和 task-owned artifacts 接管。不要提供兼容双读或把旧命令包装转发到下游。
