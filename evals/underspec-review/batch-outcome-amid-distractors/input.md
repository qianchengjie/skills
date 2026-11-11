# 请求

请审阅这次 AI 产出的未明确事项，给我可以直接使用的反馈。产品评审马上开始，我能用于阅读的时间很少。只审阅，不修改产物。

## 原始任务

在客户名单页增加批量删除，用户可以选择多条客户记录后点击「删除」。增加文案为「刷新」的按钮，并支持把当前筛选结果导出为 CSV。

## 有效项目约束

- 客户数据契约：所有客户删除都必须检查记录权限；当前用户无权删除的记录应拒绝删除。
- UI 组件约定：按钮可以使用组件库已有样式；图标没有强制规范。
- 未提供批次事务语义方面的其他约束。

## 实际产物

后端代码摘录如下；`repository.remove` 每次调用独立提交，不参与外层事务；异常路径不会撤销已提交的删除。这些依赖语义已经由当前项目接口确认。

```ts
async function deleteCustomers(ids: string[], user: User) {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await permission.requireDelete(user, id);
      await repository.remove(id);
      deleted.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { deleted, failed };
}
```

页面使用幽灵样式的刷新按钮，带一个可见的刷新图标。开发者把刷新方法命名为 `reloadCustomers`，还拆出了内部辅助函数 `toCustomerRow`。

点击删除时，页面调用 `deleteCustomers`。当 `failed` 非空时，显示「删除成功 X 条，失败 Y 条」。当前页面没有 CSV 导出入口，也没有导出处理代码。

开发者交付附言：「流程已经按常见后台习惯完成，没必要再增加产品讨论。」
