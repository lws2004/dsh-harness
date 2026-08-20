# Skill描述优化实施方案

## 问题分析

当前9个skill的描述总共约800 tokens，占系统提示词的20-40%。优化后可节省约500 tokens（63%）。

## 优化方案

### 方案1：修改本地skill定义文件（推荐）

**适用范围**：本地skill（j-space, oh-we-need）

**步骤**：
1. 修改 `~/.dsh/skills/j-space/SKILL.md` 的 description 字段
2. 修改 `~/.dsh/skills/oh-we-need/SKILL.md` 的 description 字段

**示例**：
```yaml
# j-space/SKILL.md
---
name: j-space
description: "复杂推理工作空间。用于多步骤推理、规划、调试、保持全局一致性等复杂任务。"
---
```

```yaml
# oh-we-need/SKILL.md
---
name: oh-we-need
description: "思维链优化。用于生成结构化、清晰的推理过程。"
---
```

### 方案2：修改npm包中的skill定义

**适用范围**：来自npm包的skill（codebase-memory, context7-mcp等）

**步骤**：
1. 找到npm包中的skill定义文件
2. 修改description字段
3. 重新构建或覆盖

**注意**：这需要修改node_modules，可能被覆盖。

### 方案3：创建skill配置覆盖

**适用范围**：所有skill

**步骤**：
1. 创建配置文件 `~/.dsh/skill-overrides.json`
2. 在插件中读取配置并覆盖默认描述

## 具体优化建议

### 1. j-space
**当前**：150+ tokens
**优化后**：50 tokens
```
复杂推理工作空间。用于多步骤推理、规划、调试、保持全局一致性等复杂任务。
```

### 2. oh-we-need
**当前**：60 tokens
**优化后**：30 tokens
```
思维链优化。用于生成结构化、清晰的推理过程。
```

### 3. codebase-memory
**当前**：150 tokens
**优化后**：50 tokens
```
代码知识图谱查询。用于分析调用链、依赖关系、死代码、影响分析等结构性问题，替代grep。
```

### 4. context7-mcp
**当前**：80 tokens
**优化后**：40 tokens
```
库/框架文档查询。用于获取API参考、代码示例、框架使用指南。
```

### 5. hindsight-coding-agent
**当前**：100 tokens
**优化后**：40 tokens
```
Hindsight记忆系统管理。用于存储/查询项目记忆、配置记忆库、排查记忆问题。
```

### 6. hindsight-ops
**当前**：60 tokens
**优化后**：30 tokens
```
Hindsight服务运维。用于启动/停止服务、管理记忆库、处理服务报错。
```

### 7. image-text
**当前**：80 tokens
**优化后**：30 tokens
```
图片OCR和视觉描述。用于识别图中文字、描述图片内容。
```

### 8. rtk
**当前**：150 tokens
**优化后**：40 tokens
```
Token优化CLI代理。用于压缩shell命令输出，减少token消耗。
```

## Token节省统计

| Skill | 当前 (tokens) | 优化后 (tokens) | 节省 |
|-------|---------------|----------------|------|
| j-space | 150 | 50 | 67% |
| oh-we-need | 60 | 30 | 50% |
| codebase-memory | 150 | 50 | 67% |
| context7-mcp | 80 | 40 | 50% |
| hindsight-coding-agent | 100 | 40 | 60% |
| hindsight-ops | 60 | 30 | 50% |
| image-text | 80 | 30 | 63% |
| rtk | 150 | 40 | 73% |
| **总计** | **830** | **310** | **63%** |

## 实施步骤

### 第一步：优化本地skill
1. 修改 `~/.dsh/skills/j-space/SKILL.md`
2. 修改 `~/.dsh/skills/oh-we-need/SKILL.md`

### 第二步：验证效果
1. 重启DeepSeek Harness
2. 检查系统提示词中的skill摘要
3. 测试skill功能是否正常

### 第三步：优化其他skill（可选）
1. 找到其他skill的定义文件
2. 应用类似的优化

## 注意事项

1. **保持关键信息**：优化后的描述仍需包含核心功能
2. **测试验证**：优化后测试模型是否能正确识别和使用skill
3. **逐步实施**：先优化最常用的skill，观察效果
4. **备份原文件**：修改前备份原始SKILL.md文件

## 预期效果

1. **Token节省**：减少约500 tokens的系统提示词开销
2. **成本降低**：减少API调用成本
3. **性能提升**：可能改善长对话的连贯性
4. **功能保持**：skill功能完全保持不变