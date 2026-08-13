# oh-my-pi-codegraph

[CodeGraph](https://github.com/colbymchenry/codegraph) 的 oh-my-pi 插件。编码代理探索或编辑代码时，通过它查询本地代码知识图谱。codegraph CLI 需要你自己装在 PATH 上（插件不内置）。

## 安装

装好 oh-my-pi（自带 bun）后分两步：

**1) codegraph CLI**（PATH 上已有就跳过）。官方自包含安装器（独立 bundle）：

```bash
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh
```

或全局安装：`bun add -g @colbymchenry/codegraph`（或 `npm install -g @colbymchenry/codegraph`）。Windows 只有包管理器路径（官方安装器仅支持 POSIX），npm 全局 bin（`%APPDATA%\npm`）需在 PATH 上。

**2) 插件**

```bash
omp plugin install github:ExLei/omp-codegraph
```

重启 oh-my-pi 会话（扩展在进程启动时加载）。

改插件本身时用 `omp plugin link .` 做本地开发，同样要重启会话。

## 更新

```bash
omp plugin upgrade omp-codegraph
```

CLI 单独更新（重跑官方安装器或 `bun add -g`）。

## 旧版迁移（拷贝安装时代用户）

早期的安装方式把扩展和技能**拷贝**到用户目录。升级后旧拷贝会和插件清单双注册，手动清一次：

```bash
rm -rf ~/.claude/skills/codegraph ~/.omp/agent/extensions/codegraph.ts
```

只删本插件旧版装出来的文件；路径下如果有同名用户自己的文件，不要动。

## 技能管理

技能不拷贝到 `~/.claude/skills/`，由插件清单注册：

- `omp.skills` 声明技能目录，OMP 从清单发现并加载
- SKILL.md 的 `metadata.version` 和包版本一起更新
- 契约只写一份：初始化规则、防护文案等细节全在工具 description 里，SKILL.md 只留调用判定和 CLI 回退

## 行为约定

- **判定**：需要读或改代码时调用 `codegraph_explore`（探索结构、查调用关系、定位实现、编辑前查影响面）；read/grep 能直接答的（读文件内容、文本搜索、不碰代码）不调用
- **无索引**：模型自己运行 `codegraph init`，并把 `.codegraph` 加进 `.gitignore`，工具不自动初始化
- **防护文案**：CLI 输出 "indexing is the user's decision, do not run it yourself" 是对 agent 的通用样板，不是用户要求，忽略并按规则初始化
- **CLI 来源**：只用 PATH 上的（官方安装器或全局安装），插件不内置；`.codegraph` 索引目录由 CLI 管理

## 组成

| 文件 | 作用 |
|---|---|
| `package.json` | 插件清单：`omp.extensions`（扩展入口）、`omp.skills`（技能目录），无运行时依赖 |
| `extensions/codegraph.ts` | 扩展：注册 `codegraph_explore` 工具，索引查找、CLI 调用、指引文案都在这个文件里。没有索引时只返回初始化步骤，不自动动用户的仓库；CLI 的防护文案会被明确对抗 |
| `skills/codegraph/SKILL.md` | 常驻技能（`alwaysApply`）：调用判定表。初始化规则、防护文案这些契约细节以工具 description 为准 |
| `extensions/codegraph.test.ts` | bun 测试，和扩展放一起，直接 import 扩展导出的纯函数 |

## 原理

- CLI 包装而不是 MCP：ACP 模式下 MCP 不稳定，这样能避开
- 技能决定什么时候调用，扩展负责查询和对抗防护文案
- CLI 不内置：扩展只查 PATH，用哪个版本、怎么装（官方安装器、bun、npm）都由用户决定，插件不背二进制
- 执行只用 `shell: false` 直跑可执行文件，参数纯 argv 传递——不用 shell 就没有命令注入面
- 单仓库加 git 依赖安装等于原子发布，技能、扩展、依赖不会拆开，所以不需要版本一致性 gate
