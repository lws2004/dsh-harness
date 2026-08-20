# Skill描述优化方案

## 当前描述 vs 优化后描述

### 1. codebase-memory
**当前描述** (约150 tokens):
```
Code knowledge-graph queries via the codebase-memory-mcp CLI. Use instead of grep when the question is structural: callers of a function, what a function calls, call chains, architecture, who imports/uses X, dead code, unused functions, high fan-in/out, impact analysis of a change, cross-service/HTTP calls, refactor candidates, or any "who/where/what calls" codebase question. Invoke via `codebase-memory-mcp cli <tool> '<json>'`. Automatically prefer this over raw grep when working inside an i...
```

**优化后描述** (约50 tokens):
```
代码知识图谱查询。用于分析调用链、依赖关系、死代码、影响分析等结构性问题，替代grep。
```

### 2. context7-mcp
**当前描述** (约80 tokens):
```
This skill should be used when the user asks about libraries, frameworks, API references, or needs code examples. Activates for setup questions, code generation involving libraries, or mentions of specific frameworks like React, Vue, Next.js, Prisma, Supabase, etc.
```

**优化后描述** (约40 tokens):
```
库/框架文档查询。用于获取API参考、代码示例、框架使用指南。
```

### 3. hindsight-coding-agent
**当前描述** (约100 tokens):
```
How this machine's Hindsight coding-agent memory works — the plugin behind the 🧠 banner. Use when the user says "store/remember this in hindsight", asks what the memory/knowledge pages are, wants to configure per-repo memory (disable, rename banks, git depth), or something memory-related looks broken.
```

**优化后描述** (约40 tokens):
```
Hindsight记忆系统管理。用于存储/查询项目记忆、配置记忆库、排查记忆问题。
```

### 4. hindsight-ops
**当前描述** (约60 tokens):
```
本机 Hindsight 记忆服务的运维手册。当需要启动/停止/排查 Hindsight 服务、管理记忆库(bank)、调用其 REST API、或处理记忆服务相关报错时加载。
```

**优化后描述** (约30 tokens):
```
Hindsight服务运维。用于启动/停止服务、管理记忆库、处理服务报错。
```

### 5. image-text
**当前描述** (约80 tokens):
```
图片/截图 → 文本(OCR 转录 + 视觉描述),为 deepseek-v4-flash 等纯文本模型补全图像理解。用户提到 看图/这张图/截图/OCR/识别图中文字/读图/描述图片/图片里有什么/帮我看下 图 等意图时使用;图片必须以文件路径形式存在(deepseek-official 路由无法直接接收图片消息)。
```

**优化后描述** (约30 tokens):
```
图片OCR和视觉描述。用于识别图中文字、描述图片内容。
```

### 6. j-space
**当前描述** (约120 tokens):
```
Use this skill to establish and operate the model's inner workspace — the J-space — for any task that needs more than fluent output: multi-step or chained reasoning, planning, long-horizon and agentic work, competition-level problems, complex debugging, keeping many parts of a deliverable globally consistent, holding a goal or constraint through a long mechanical task, auditing what the model believes but has not said, calibrated confidence and error detection, suspicious or manipulative inpu...
```

**优化后描述** (约40 tokens):
```
复杂推理工作空间。用于多步骤推理、规划、调试、保持全局一致性等复杂任务。
```

### 7. oh-we-need
**当前描述** (约60 tokens):
```
Use this skill to shape DeepSeek V4 chain-of-thought with the we need to style: one concrete action per sentence, modal interleaving, build/fix classification first, dense private thinking and clean final output.
```

**优化后描述** (约30 tokens):
```
思维链优化。用于生成结构化、清晰的推理过程。
```

### 8. rtk
**当前描述** (约150 tokens):
```
Token-optimizing CLI proxy (rtk). DEFAULT tool for directory listings, file viewing/searching, and any shell command whose raw output would be large or noisy — prefer `rtk` over plain ls/cat/grep/git/find in ALL shell scenarios, even small ones (e.g. "what's in this directory"). Wraps native tools: `rtk ls`/`rtk tree` (compact listings — use for every directory listing), `rtk read` (intelligent filtering), `rtk rg`/`rtk grep` (compact search grouped by file), `rtkfind` (fd+pipe file search)...
```

**优化后描述** (约40 tokens):
```
Token优化CLI代理。用于压缩shell命令输出，减少token消耗。
```

## Token消耗对比

| Skill | 当前描述 (tokens) | 优化后 (tokens) | 节省 |
|-------|------------------|----------------|------|
| codebase-memory | ~150 | ~50 | 67% |
| context7-mcp | ~80 | ~40 | 50% |
| hindsight-coding-agent | ~100 | ~40 | 60% |
| hindsight-ops | ~60 | ~30 | 50% |
| image-text | ~80 | ~30 | 63% |
| j-space | ~120 | ~40 | 67% |
| oh-we-need | ~60 | ~30 | 50% |
| rtk | ~150 | ~40 | 73% |
| **总计** | **~800** | **~300** | **63%** |

## 实施方案

### 方案1：直接修改skill定义文件
找到每个skill的定义文件，修改description字段。

### 方案2：创建优化配置
创建一个配置文件，覆盖默认的skill描述。

### 方案3：修改注入逻辑
修改`dsh-tool-skill`插件，在注入时自动截断过长的描述。

## 建议

1. **优先实施**：先优化最常用的skill（codebase-memory, rtk, j-space）
2. **保持关键信息**：确保优化后的描述仍包含核心功能
3. **测试验证**：优化后测试模型是否能正确识别和使用skill