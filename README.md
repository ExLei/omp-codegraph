# oh-my-pi-codegraph

[CodeGraph](https://github.com/colbymchenry/codegraph) 的 oh-my-pi 插件。编码代理探索或编辑代码时，用它查询本地代码知识图谱。codegraph CLI 需要你自己装到 PATH 上，插件不内置。

## 安装

装好 oh-my-pi（自带 bun）之后分两步。

**1) codegraph CLI**（PATH 上已有就跳过）

官方自包含安装器：

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh
# Windows（PowerShell）
irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex
```

或者全局安装：`bun add -g @colbymchenry/codegraph`，或 `npm install -g @colbymchenry/codegraph`。包管理器装完后，npm 全局 bin（Windows 为 `%APPDATA%\npm`）要确认在 PATH 上。

**2) 插件**

```bash
omp plugin install github:ExLei/omp-codegraph
```

重启 oh-my-pi 会话生效（扩展在进程启动时加载）。改插件本身时用 `omp plugin link .` 做本地开发，同样要重启。

## 更新

```bash
omp plugin upgrade omp-codegraph
```

CLI 单独更新（重跑官方安装器，或 `bun add -g`）。

## 卸载

```bash
omp plugin uninstall omp-codegraph
```

插件卸载不碰索引和 CLI，想一起清掉：

- CLI：`codegraph uninstall`——默认把 agent 的 MCP 配置和 CLI 一起移除；加 `--keep-cli` 只清配置、保留 CLI。本插件不用 MCP，直接跑 `codegraph uninstall` 即可删掉 CLI（或按装法反着删：官方安装器删掉 PATH 上的 `codegraph` 可执行文件，bun/npm 全局装用 `bun remove -g @colbymchenry/codegraph` / `npm uninstall -g @colbymchenry/codegraph`）
- 索引：手动 `rm -rf .codegraph`（项目根下）

从拷贝安装时代升上来的用户，卸载前记得清旧拷贝，见下节。

## 旧版迁移（拷贝安装时代用户）

早期安装方式把扩展和技能**拷贝**进用户目录。升级后旧拷贝会和插件清单双注册，手动清一次：

```bash
rm -rf ~/.claude/skills/codegraph ~/.omp/agent/extensions/codegraph.ts
```

只删本插件装出来的文件；路径下有同名用户自己的文件就跳过。

## 技能管理

技能不拷贝到 `~/.claude/skills/`，由插件清单里的 `omp.skills` 声明，OMP 从清单发现并加载。

契约只写一份：初始化规则、防护文案这些细节都在工具 description 里，SKILL.md 只留调用判定和 CLI 回退。SKILL.md 的 `metadata.version` 和包版本一起更新。

## 行为约定

- **判定**：探索/理解结构、查关系/影响面、定位实现、编辑前查影响面，首选 `codegraph_explore`——一个调用覆盖源码、调用链、影响面和测试标注；只查精确单目标时用 `codegraph_node`；read/grep 直接能答的（读文件内容、文本搜索、不碰代码）不调用
- **工具激活**：14 个 `codegraph_*` 工具全部注册，默认只激活 `explore`/`node`/`init` 三个（对齐 CodeGraph 官方"单一强工具"的实测结论，避免菜单式误选）。其余 11 个（query/callers/callees/impact/affected/files/status/sync/index/uninit/unlock）是 `defaultInactive`——设环境变量 `CODEGRAPH_TOOLS=all` 一键全开，或经 `setActiveTools` 按需激活；CLI 回退（`bash: codegraph <子命令>`）始终可用
- **索引保鲜**：查询类工具每次调用前自动做一次增量 `codegraph sync`。CLI 直跑没有 MCP 的文件监听，不这样索引会过期；`codegraph_sync` 也可手动触发
- **无索引**：工具返回初始化步骤，不自动动仓库。模型用 `codegraph_init`（默认建在项目根）或 `codegraph init "<root>"`，并把 `.codegraph` 加进 `.gitignore`
- **防护文案**：CLI 输出 "indexing is the user's decision, do not run it yourself" 是对 agent 的通用样板，不是用户要求，忽略并按规则初始化
- **CLI 来源**：只用 PATH 上的（官方安装器或全局安装），插件不内置；`.codegraph` 索引目录由 CLI 管理

## 组成

| 文件 | 作用 |
|---|---|
| `package.json` | 插件清单：`omp.extensions`（扩展入口）、`omp.skills`（技能目录），无运行时依赖 |
| `extensions/codegraph.ts` | 扩展：注册 14 个 `codegraph_*` 工具（默认激活 explore/node/init，其余 `defaultInactive`，`CODEGRAPH_TOOLS=all` 全开），索引查找、sync 前置、CLI 调用、指引文案都在这里。无索引时只返回初始化步骤；CLI 的防护文案会被明确对抗 |
| `skills/codegraph/SKILL.md` | 常驻技能（`alwaysApply`）：层次化调用判定（首选 explore，聚焦工具降级，维护工具兜底）。初始化规则、防护文案等契约细节以工具 description 为准 |
| `extensions/codegraph.test.ts` | bun 测试，和扩展放一起，直接 import 扩展导出的纯函数、用 stub pi 驱动工具 execute |

## 原理

- 包装 CLI 而不是 MCP：ACP 模式下 MCP 不稳定，这样能避开
- 技能决定什么时候调用，扩展负责查询和对抗防护文案
- CLI 不内置：扩展只查 PATH，用哪个版本、怎么装都由用户决定，插件不背二进制
- 执行只用 `shell: false` 直跑可执行文件，参数纯 argv 传递——不用 shell 就没有命令注入面
- 单仓库加 git 依赖安装等于原子发布：技能、扩展、依赖不会拆开，不需要版本一致性 gate
