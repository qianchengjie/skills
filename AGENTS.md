# AGENTS.md instructions

## 通用规则

- 默认使用简体中文回复。
- 当前仓库使用 `skills/<skill-name>/` 管理个人 Codex skills。
- 不要在 skill 目录内新增 README、安装指南、变更日志等辅助文档；只保留 `SKILL.md` 和执行该 skill 必需的资源。
- 新增或修改 skill 后，运行 `./scripts/validate-all.sh`。
- 安装到本机 Codex 时使用 `./scripts/install.sh`。
- 不要新增依赖；脚本优先使用系统自带的 `sh`、`find`、`cp`、`rm`。
