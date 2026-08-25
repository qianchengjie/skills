# 交付审计

### A1：初始实现验证

task=`resume-interrupted-discovery@1`，execution=`sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`，target=`T0`。验证通过。

### A2：General Full Review

task=`resume-interrupted-discovery@1`，execution=`sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`，target=`T0`，verdict=`findings`。

- P1：边界条件遗漏；已有 task authority 唯一推出修复结果，可执行。

```deliver-task-binding
{"task":{"taskId":"resume-interrupted-discovery","revision":1,"taskHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"executionHash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","target":{"kind":"commit-range","baseCommit":"a32475eae540b4c2ce0095b8d4d2f4c5646ad032","headCommit":"43a876a527c30e4c9fa60f36b32a6deb709f79e6","executionHash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}
```

### A3：Rules Full v8 派发

同一 target `T0`，`rulesReviewPolicy=required` 且 active rule catalog 非空。run locator：`rules-run/dispatch.json`。
