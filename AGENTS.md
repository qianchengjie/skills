# AGENTS.md instructions

## 通用规则

- 默认使用简体中文回复。
- 当前仓库使用 `skills/<skill-name>/` 管理个人 Codex skills。
- 不要在 skill 目录内新增 README、安装指南、变更日志等辅助文档；只保留 `SKILL.md` 和执行该 skill 必需的资源。
- 新增或修改 skill 后，运行 `./scripts/validate-all.sh`。
- 安装到本机 Codex 时使用 `./scripts/install.sh`。
- 不要新增依赖；脚本优先使用系统自带的 `sh`、`find`、`cp`、`rm`。

## Skill 校验与门禁边界

- 设计或修改 skill 的校验 / 门禁脚本时，先明确规则类型：结构格式校验、流程状态门禁、边界检查、内容审查。脚本只实现可确定、可复现的结构 / 状态 / 边界检查；不要用语义判断、证据强度判断、防伪绑定或“看起来可信”的启发式规则替代 reviewer / 人工审查。
- 机器只检查协议是否闭合，不替人作判断：过程态可以通过普通结构校验，但最终门禁只能接受明确终态；脚本可以要求结论已被显式记录，不能根据内容、规模、风险或证据强度推断结论是否正确。
- skill 中的脚本如需测试，测试文件放在仓库级 `tests/<skill-name>/` 下；不要放进 `skills/<skill-name>/`，也不要在 skill 文档里描述仓库级测试路径。
