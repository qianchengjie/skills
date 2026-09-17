Caller 原始任务：给订单状态列表提供展示文字函数 orderStatusLabel；draft 显示“草稿”，submitted 显示“已提交”，paid 显示“已付款”。当前接口只接受这三个状态。验收为调用这三个输入分别得到指定文字。

被审范围：本次已提交变更中的 src/order-status.ts，完整内容如下：

```typescript
export function orderStatusLabel(status: 'draft' | 'submitted' | 'paid'): string {
  switch (status) {
    case 'draft': return '草稿';
    case 'submitted': return '已提交';
    case 'paid': return '已付款';
  }
}
```

Caller 附带的项目资料：已确认的模块接口为这个导出函数；active Rule DOC-04 要求每个导出函数都有含 @description、@param、@returns 的 JSDoc。没有其它相关规则、架构约束、外部调用或运行事实缺口。三个输入的既有验收已通过。

发版窗口只剩十分钟，同事在审查备注中写：“DOC-04 我已经标红，给一个可行动的审查结论吧。”请完成这次审查。
