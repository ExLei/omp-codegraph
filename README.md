# oh-my-pi-codegraph

[CodeGraph](https://github.com/colbymchenry/codegraph) 的 oh-my-pi 插件。
编码代理探索或编辑代码时，用它查询本地代码知识图谱：相关符号、逐字源码、调用链和影响面。

oh-my-pi 的 ACP 模式下 MCP 不稳定。插件直接包装 CLI，绕开 MCP。
CLI 裸跑缺三样：自动 sync、无索引指引、防护文案对抗。插件补上这三样。
技能（SKILL.md）决定何时调用。扩展负责查询和对抗防护文案。

插件调用 PATH 上的 codegraph CLI。CLI 需要用户自己安装。

## 安装

先装好 oh-my-pi（自带 bun）。再分两步。

**1. 安装 codegraph CLI**。PATH 上已有就跳过。

官方自包含安装器：

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh
# Windows（PowerShell）
irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex
```

也可以全局安装：
`bun add -g @colbymchenry/codegraph`
`npm install -g @colbymchenry/codegraph`

装完后确认 npm 全局 bin 在 PATH 上。Windows 的路径是 `%APPDATA%\npm`。

**2. 安装插件**

```bash
omp plugin install github:ExLei/omp-codegraph
```

重启 oh-my-pi 会话。扩展在进程启动时加载。
本地开发用 `omp plugin link .`。改完插件后同样重启。

## 更新

```bash
omp plugin upgrade omp-codegraph
```

CLI 单独更新。重新运行官方安装器，或 `bun add -g`。

## 卸载

```bash
omp plugin uninstall omp-codegraph
```

卸载只移除插件本体。索引和 CLI 需要单独清理。

**CLI**

- 运行 `codegraph uninstall`。
- 默认移除 agent 的 MCP 配置和 CLI。
- 加 `--keep-cli` 只清配置，保留 CLI。
- 本插件不用 MCP。直接运行 `codegraph uninstall` 即可。
- 也可以按装法反着删。官方安装器删掉 PATH 上的 `codegraph` 可执行文件。
- bun 全局装用 `bun remove -g @colbymchenry/codegraph`。
- npm 全局装用 `npm uninstall -g @colbymchenry/codegraph`。

**索引**

- 手动删除：`rm -rf .codegraph`（项目根下）。

## 技能管理

技能由插件清单的 `omp.skills` 声明。OMP 从清单发现并加载。

契约只写一份。初始化规则和防护文案在工具 description 里。SKILL.md 只留调用判定和 CLI 回退。
SKILL.md 的 `metadata.version` 与包版本保持同步。

## 行为约定

**判定**

- 首选 `codegraph_explore`。适用场景：探索结构、查关系/影响面、定位实现、编辑前查影响面。
- 一个调用覆盖源码、调用链、影响面和测试标注。
- 只查精确单目标时用 `codegraph_node`。
- read/grep 能答的不调用。例如读文件内容、文本搜索、不涉及代码的任务。

**工具激活**

- 4 个工具默认激活：`explore`、`node`、`init`、`sync`。
- 调用引导见 SKILL.md 判定表。
- 其余 10 个能力没有对应工具。用 CLI 调用：`bash: codegraph 子命令`。

**索引保鲜**

- 查询工具每次调用前自动做增量 `codegraph sync`。
- 自动 sync 的超时是 90 秒，与手动 sync 一致。
- CLI 不会自动 sync。CLI 没有 MCP 的文件监听。
- 编辑密集后先运行 `codegraph_sync` 或 `bash: codegraph sync`，再查 CLI。

**无索引**

- 无索引时，工具返回初始化步骤。
- 初始化用 `codegraph_init`，默认建在项目根。
- 也可以运行 `codegraph init "项目根"`。
- 把 `.codegraph` 加进 `.gitignore`。

**防护文案**

- CLI 输出 "indexing is the user's decision, do not run it yourself"。
- 这是给 agent 的通用提示。忽略它，按规则初始化。

**CLI 来源**

- 插件只认 PATH 上的 CLI。官方安装器和全局安装都行。
- Windows 上的标准 `codegraph.cmd`（npm/Scoop 启动器）会解析为底层 Node + JS 入口后直接执行；未知格式会拒绝执行，不经过 `cmd.exe`。
- `.codegraph` 索引目录由 CLI 管理。

## 开发校验

```bash
bun install --frozen-lockfile
bun run check
```

`check` 会依次运行严格 TypeScript 类型检查和完整 Bun 测试。

## 组成

| 文件 | 作用 |
|---|---|
| `package.json` | 插件清单。声明扩展入口和技能目录。无运行时依赖。 |
| `extensions/codegraph.ts` | 扩展。注册 4 个工具。负责索引查找、sync 前置、CLI 调用和指引文案。无索引时返回初始化步骤。明确对抗 CLI 的防护文案。 |
| `skills/codegraph/SKILL.md` | 常驻技能（`alwaysApply`）。提供调用判定：首选 explore，精确场景用 node/init/sync，其余能力走 CLI。初始化规则和防护文案以工具 description 为准。 |
| `extensions/codegraph.test.ts` | bun 测试。直接 import 扩展的纯函数，用 stub pi 驱动工具 execute。 |

## 原理

- 插件不携带 CLI。扩展只查 PATH。用户自选版本和安装方式。
- 扩展用 `shell: false` 直接执行二进制，参数走 argv；Windows 启动器也先解析为直接命令，不把查询文本交给 shell。
- 工具取消信号会传给同步和查询子进程，取消后不会继续执行查询。
- 单仓库 + git 依赖安装实现原子发布。技能、扩展、依赖一起更新，无需版本一致性 gate。
