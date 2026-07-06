#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  let root = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      const value = argv[i + 1];
      if (!value) fail("Missing value for --root");
      root = path.resolve(value);
      i += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }
  return { root };
}

const AGENTS_ENTRY_SNIPPET = `建议加入 AGENTS.md 的入口片段：

\`\`\`md
## 项目规则入口

- 当任务需要项目规则时，先读取 \`.agents/rules/index.md\`。
- 总是读取 \`.agents/rules/index.md\` 中 \`CORE\` 指向的 active 文件。
- 只有触发条件匹配当前任务时，才读取其他 active namespace 文件。
- 涉及规则判断时，引用相关规则 ID。
\`\`\`

本脚本不会自动修改 AGENTS.md。`;

const { root } = parseArgs(process.argv.slice(2));
const rulesRoot = path.join(root, ".agents", "rules");

const files = [
  [
    "index.md",
    `# Rules Index

## Namespaces

| Namespace | 状态 | 文件 | 触发条件 |
| --- | --- | --- | --- |
| \`CORE\` | active | \`always/constraints.md\` | 每次任务必读 |
`,
  ],
  [
    "always/constraints.md",
    `# Constraints

本文件记录每次任务都无条件生效的项目底线规则。

初始化时不包含真实规则。新增规则时使用以下结构，并替换为真实 rule ID。

\`\`\`md
### <RULE-ID> <中文短标题>

- 级别：MUST | SHOULD | ADVISORY
- 生效条件：<什么时候适用>
- 规则：<一句话写清楚必须做什么 / 禁止做什么>
- 证据要求：
  - <handoff / review package 里必须留下的证据>
- 失败条件：
  - <什么情况算违反>
- 无法验证条件：
  - <什么情况下不能判 passed，只能判 cannot-verify>
\`\`\`
`,
  ],
  [
    "concerns/README.md",
    `# Concerns

\`concerns/\` 是受控扩展目录。

新增 concern 规则文件前，先由 rule-steward 判断它是否是稳定关注点，是否不能被已有 namespace 覆盖，是否不是技术栈大词、临时任务名或 misc 类文件。

有效 concern 规则文件必须在 \`.agents/rules/index.md\` 登记 namespace、状态、文件和触发条件。未登记文件无效。
`,
  ],
  [
    "domain/README.md",
    `# Domain

\`domain/\` 是受控扩展目录。

新增 domain 规则文件前，先由 rule-steward 判断它是否依赖明确业务语义，是否脱离该业务领域就不成立，是否会被多次维护或 review，是否不是一次性需求、页面名、活动名或临时功能名。

有效 domain 规则文件必须在 \`.agents/rules/index.md\` 登记 namespace、状态、文件和触发条件。未登记文件无效。
`,
  ],
];

for (const [relativePath] of files) {
  const filePath = path.join(rulesRoot, relativePath);
  if (existsSync(filePath)) {
    fail(`Refusing to overwrite existing file: ${filePath}`);
  }
}

for (const [relativePath, content] of files) {
  const filePath = path.join(rulesRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, { flag: "wx" });
}

console.log(`Initialized rule store at ${rulesRoot}`);
console.log("");
console.log(AGENTS_ENTRY_SNIPPET);
