# 项目专用命令速查表

为了提高效率，本项目的开发环境已安装以下高性能工具：

| 功能 | 推荐命令 | 替代原生命令 | 说明 |
|------|---------|-------------|------|
| 文件搜索 | `fd` | `find` | 更快，自动忽略 .gitignore |
| 内容搜索 | `rg` | `grep -r` | 极速，自动忽略 .gitignore |
| 文件预览 | `bat` | `cat` | 带语法高亮 |
| 磁盘分析 | `ncdu` | `du -sh` | 交互式可视化 |
| 目录树 | `tree -L 2 -I "node_modules\|.git"` | `ls -R` | 结构化展示 |

## 执行规范

1. 在执行上述类型的任务时，**优先使用推荐命令**
2. 如果推荐命令不存在，先运行 `brew install fd ripgrep bat ncdu tree` 安装
3. 只有在安装失败或特殊参数需求时，才降级使用原生命令

## 示例

- ❌ 不推荐：`find . -name "*.js"`
- ✅ 推荐：`fd -e js`
- ❌ 不推荐：`grep -r "TODO" .`
- ✅ 推荐：`rg "TODO"`

## 与 rtk 技能的集成

本项目已集成 `rtk` 技能，提供输出优化功能：

| 任务类型 | 推荐工具 | rtk 对应命令 | 备注 |
|---------|---------|-------------|------|
| 文件搜索 | `fd` | `rtkfind` | 始终用 fd 替代 find |
| 内容搜索 | `rg` | `rtk rg`/`rtk grep` | 自动压缩输出 |
| 文件预览 | `bat` | `rtk read` | 大文件用 rtk read |
| 磁盘分析 | `ncdu` | 无（rtk 未覆盖） | 快速查看可用 `du` |
| 目录树 | `tree` | `rtk tree` | 自动压缩输出 |

### 使用建议

1. **默认使用 rtk 优化命令**：如 `rtkfind`、`rtk rg`、`rtk read`
2. **需要语法高亮时使用原生工具**：如 `bat` 查看代码
3. **磁盘分析使用 `ncdu`**：rtk 未覆盖此功能
4. **保持工具更新**：定期运行 `brew upgrade` 更新工具版本

## 安装命令

如果工具未安装，运行以下命令：

```bash
# 安装所有推荐工具
brew install fd ripgrep bat ncdu tree

# 或单独安装
brew install fd      # 文件搜索
brew install ripgrep # 内容搜索
brew install bat     # 文件预览
brew install ncdu    # 磁盘分析
brew install tree    # 目录树
```

## 性能对比

| 工具 | 速度 | 输出优化 | 代理友好度 |
|------|------|---------|-----------|
| fd | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐⭐⭐ |
| rtkfind | ⭐⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐⭐ |
| rg | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐⭐⭐ |
| rtk rg | ⭐⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐⭐ |
| bat | ⭐⭐⭐⭐ | ❌ | ⭐⭐⭐ |
| rtk read | ⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐⭐ |
| ncdu | ⭐⭐⭐ | ❌ | ⭐⭐⭐ |
| du | ⭐⭐⭐⭐ | ❌ | ⭐⭐⭐⭐ |
| tree | ⭐⭐⭐⭐ | ❌ | ⭐⭐⭐ |
| rtk tree | ⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐⭐ |

---

**最后更新**: 2025年8月21日  
**维护者**: DeepSeek Harness 项目组