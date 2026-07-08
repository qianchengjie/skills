# Personal Codex Skills

个人 Codex skills 仓库。

## 目录

```text
skills/
  bounded-agency-review/
  rule-steward/
  rules-review/
  sliced-dev/
scripts/
  validate-all.sh
  install.sh
```

## 验证

```bash
./scripts/validate-all.sh
```

## 安装到本机 Codex

```bash
./scripts/install.sh
```

安装脚本会把 `skills/*` 同步到 `${CODEX_HOME:-$HOME/.codex}/skills`，并覆盖本机同名 skill。

未克隆仓库且 GitHub 仓库可访问时：

```bash
curl -fsSL https://raw.githubusercontent.com/qianchengjie/skills/master/scripts/install.sh | sh
```
