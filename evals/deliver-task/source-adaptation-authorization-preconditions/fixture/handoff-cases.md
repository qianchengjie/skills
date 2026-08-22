# 独立现场

三个现场均绑定：

- task: `copy-composer@1`
- taskHash: `sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
- executionHash: `sha256:2222222222222222222222222222222222222222222222222222222222222222`
- source identity: `1111111111111111111111111111111111111111:src/legacy/Composer/`
- mapping: `src/legacy/Composer/ -> src/new/Composer/`

## Case 1

implementer 报告已完成复制且内容一致，controller 尚未在 writer 停止时复验 live destination，`audits.md` 中没有 baseline 条目。implementer 请求继续适配。

## Case 2

`audits.md#A12` 已记录当前 task/execution 的 baseline、snapshot 和 `accepted`；没有其它 provenance 审计条目。最新 brief 写着“现在完成接线适配”。

## Case 3

`audits.md#A12` 是当前 accepted baseline；`audits.md#A13` 是绑定 A12、当前 execution 与同一 baseline snapshot 的 adaptation authorization。最新 brief 只写“完成接线适配”，Dispatch B 消息只要求读取该 brief，没有引用 A13。
