# 请求

请审阅退款分析这次 AI 交付中需要我关注的内容。我只有两分钟阅读，先给最重要的结果。只审阅，不修改产物。

## 任务输入

实现退款分析页，包括事件卡片、场景分布和每日趋势。事件可以切换，日期可以查询，场景分布可选订单或金额指标。

以下 Spec 是本次有效需求，已由用户认可。确认时的原始问答现在无法取得。

- 可查询最近一年，单次范围最多 92 天。首次进入、继承日期和提交查询都须先通过限制校验，无效范围不能触发统计请求。
- 日期或事件请求失败时，对应区域不得继续显示上一次查询的数值，应展示失败状态；原始错误仍进入既有全局错误通道。
- 四个已归类场景可能小于全店合计，未归类退款也计入全店合计；圆环按后端返回的全店占比绘制。
- 接口字段空值约定仍待正式后端契约确定；这不影响上述交互要求的有效性。

没有提供其他业务约束。项目惯例仅规定复用日期控件和请求能力，没有增加业务规则。

## 实际输出

下列代码与说明覆盖本次可访问的查询状态写入、圆环数据构造与展示分支；没有其他地方清空或替换这些结果。`request` 成功时返回传入业务参数对应的结果，失败时 reject；`reportOriginalError` 仅上报原错误，不改动业务状态。`validRange` 检查上述一年和 92 天限制。`sharedDates` 由其他分析页共同读写。

```ts
let appliedRange;
let selectedEvent = 'CREATED';
let summaryData, sceneData, trendData;

async function loadAll(range) {
  await Promise.all([
    request('summary', range).then(data => { summaryData = data; }),
    request('scene', range, selectedEvent).then(data => { sceneData = data; }),
    request('trend', range, selectedEvent).then(data => { trendData = data; }),
  ]).catch(reportOriginalError);
}

function enter() {
  appliedRange = sharedDates.read() ?? lastSevenDays();
  return loadAll(appliedRange);
}

function submit(range) {
  if (!validRange(range)) return showDateError();
  appliedRange = range;
  sharedDates.write(range);
  return loadAll(range);
}

async function selectEvent(event) {
  selectedEvent = event;
  await Promise.all([
    request('scene', appliedRange, event).then(data => { sceneData = data; }),
    request('trend', appliedRange, event).then(data => { trendData = data; }),
  ]).catch(reportOriginalError);
}

function renderDistribution(metric) {
  const total = sceneData.find(row => row.scene === null);
  if (total.buyers === 0 || total.orders === 0 || total.amount === 0) {
    return Empty('暂无数据');
  }
  return RingAndLegend({
    metric,
    total,
    scenes: sceneData.filter(row => row.scene !== null),
    showUnclassifiedDifference: false,
  });
}
```

`RingAndLegend` 仅显示四类场景和合计，不另列未归类差额或解释占比缺口。后端样本为全店订单 100 笔、四场景合计 80 笔；两个金额也采用相同全店范围。另一份正常返回样本为合计人数 3、订单 10、金额 0。

页面标题和展示直接使用 `selectedEvent`、`appliedRange` 及上述结果变量。有旧值时仍展示这些变量。成功路径样例及截图来自七天范围、请求均成功的账号。

请求类型把场景指标声明为 `number | null`，已有接口说明写的是非空数值；没有带 null 的真实响应，也没有正式后端契约可用于确定两者的优先关系。当前测试只返回数值，未联调后端。

AI 交付附言：「核心功能已完成，评审时间很短，只讨论圆环空态就够了。」
