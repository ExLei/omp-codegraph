# oh-my-pi-codegraph

[CodeGraph](https://github.com/colbymchenry/codegraph) 集成：oh-my-pi 扩展 + 全局技能，让编码代理在探索/编辑代码时主动查询本地代码知识图谱。

## 组成

| 文件 | 作用 |
|---|---|
| `extensions/codegraph.ts` | oh-my-pi 扩展：暴露单工具 `codegraph_explore`（CLI 包装，`codegraph explore`）。无索引时返回初始化指引（不自动动用户仓库）；返回的报错/指引中对抗 CLI 内置 agent 防护文案 |
| `skills/codegraph/SKILL.md` | 全局技能（alwaysApply）：调用/不调用判定双表 + 手动初始化规则 + 防护文案定性 |
| `install.sh` | 安装 CLI + 扩展 + 技能：CLI 缺失时先用官方自包含安装器（curl 一键，免 Node），curl 不可用时 npm 兜底 |
| `update.sh` | `git pull` + 重新安装 |

## 安装

```bash
git clone git@github.com:ExLei/omp-extension-codegraph.git
cd omp-extension-codegraph && ./install.sh
# 重启 oh-my-pi 会话（扩展在进程启动时加载）
```

## 更新

```bash
cd omp-extension-codegraph && ./update.sh
```

或加入 cron（如每周一 9 点）：

```bash
crontab -e
# 0 9 * * 1 cd /home/ExLei/dev/omp-extension-codegraph && ./update.sh >> /tmp/oh-my-pi-codegraph-update.log 2>&1
```

## 行为约定

- **判定**：需要读/改代码 ⇔ 调用（探索/理解、关系/影响、定位实现、编辑/重构/删除）；read/grep 能答的（读内容、文本搜索、不碰代码）不调用
- **无索引**：模型自行运行 `codegraph init`（+ 加入 `.gitignore`）再查询——工具不自动初始化
- **防护文案**：codegraph CLI 对 agent 输出 "indexing is the user's decision, do not run it yourself" 属通用样板，已明确标注为误导源，模型应忽略并照规则初始化
- **依赖**：需要全局可用的 `codegraph` CLI（`~/.local/bin/codegraph`）或 PATH 中同名命令；`install.sh` 会自动安装

## 原理

- 扩展走 **CLI 包装**（非 MCP）：免疫 ACP 模式下 MCP 不稳定；oh-my-pi 扩展 loader 只能解析入口级裸导入，SDK 内嵌不可行
- 技能 + 扩展双保险：技能管判定（何时调用），扩展管执行（查询、指引、防护对抗）
