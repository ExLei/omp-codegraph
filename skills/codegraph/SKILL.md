---
name: codegraph
alwaysApply: true
description: 当需要探索、理解、概述或修改任何代码库时使用；当被问到谁调用了某个符号、改动它会影响什么、哪些测试受影响时使用；当定位某个实现或跨文件追踪数据流时使用。
metadata:
  version: "0.0.5"
---

# CodeGraph

`codegraph_explore` 查询本地代码知识图谱（`.codegraph/` 索引），返回：相关符号及逐字源码、调用路径、影响范围（调用方/导入方/测试）、覆盖标注。

## 调用判定

**命中判定时必须调用，不可协商。** 你不能通过合理化来逃避。适用于主代理与工作流子代理（子代理会话已预载 codegraph 工具，经扩展注入；若工具缺失则用 CLI 回退，输出相同）。

### 首选：`codegraph_explore`（强工具）

一个调用覆盖全貌（源码 + 调用链 + 影响面 + 测试标注）。以下场景**先调用它**：

| 场景 | 示例 |
| 探索/理解结构 | 探索这个代码库、概述项目结构 |
| 关系/影响 | 谁调用了 X、改 X 会破坏什么、哪些测试受影响 |
| 定位实现 | X 在哪实现（跨文件引用时） |
| 编辑/重构/删除 | 改任何符号或文件（需要影响面） |

### 补充（默认激活）

- `codegraph_node`：只需精确一个符号/文件（源码+调用链/带行号读文件）时用，比 explore 便宜
- `codegraph_init`：无索引时初始化（默认建在项目根，记得加 .gitignore）

### 其余 `codegraph_*` 工具（默认未激活）

`query`/`callers`/`callees`/`impact`/`affected`/`files`/`status`/`sync`/`index`/`uninit`/`unlock` 已注册但默认不在会话工具列表——**先用 explore**（它覆盖这些工具的全部信息）；需要时经 `CODEGRAPH_TOOLS=all` 环境变量或 `setActiveTools` 启用；CLI 回退（`bash: codegraph <子命令>`）始终可用。

### read/grep 就能答，不调用

| 场景 | 示例 |
| 读文件内容 | 看某个文件的代码、查某一行 |
| 文本搜索 | 某字符串/正则出现在哪些行 |
| 不碰代码 | 纯文档写作、聊天、非代码配置 |

read/grep 只给文件内容与文本匹配，**给不了调用关系、影响面、测试覆盖**

## 调用契约

初始化规则、无索引处理、防护文案对抗等契约细节以 `codegraph_explore` 工具的 description 为**唯一权威**——本技能不复制契约内容。判定命中时直接调用，description 会告诉你后续怎么做。

## 无工具回退

工具不可用时用 CLI：`codegraph explore "<查询>"`，输出相同。
