# openclaw-modelstudio-memory

阿里云ModelStudio长期记忆服务 OpenClaw 插件，为 AI Agent 提供长期记忆能力。

## 功能特性

- ✅ **自动记忆捕获**（autoCapture）：对话结束后自动提取关键信息存储
- ✅ **自动记忆召回**（autoRecall）：对话开始前自动检索相关记忆注入上下文
- ✅ **语义搜索**：基于向量相似度的记忆搜索
- ✅ **手动存储**：支持手动存储指定内容
- ✅ **记忆管理**：列出、删除记忆
- ✅ **CLI 命令**：`openclaw modelstudio-memory search/list/stats`

## 安装

### 方式 A：从本地安装
```bash
git clone git@github.com:taoquanyus/openclaw-modelstudio-memory.git
```

```bash
# 链接模式（代码修改后重启 Gateway 即生效）
openclaw plugins install -l ./openclaw-modelstudio-memory

# 或复制模式
openclaw plugins install ./openclaw-modelstudio-memory
```

### 方式 B：从 npm 安装

```bash
openclaw plugins install @modelstudio/openclaw-modelstudio-memory
```

### 验证安装

```bash
# 查看插件信息
openclaw plugins info openclaw-modelstudio-memory

# 查看状态
openclaw modelstudio-memory stats
```

## 配置

在 `~/.openclaw/openclaw.json` 中添加配置：

```json5
{
  plugins: {
    slots: {
      memory: "openclaw-modelstudio-memory"
    },
    entries: {
      "openclaw-modelstudio-memory": {
        enabled: true,
        config: {
          // 必需配置
          "apiKey": "${DASHSCOPE_API_KEY}",
          "userId": "user_001",
          
          // 可选配置（以下为默认值）
          "baseUrl": "https://dashscope.aliyuncs.com/api/v2/apps/memory",
          "autoCapture": true,
          "autoRecall": true,
          "topK": 5,
          "minScore": 0,
          "captureMaxMessages": 10,
          "recallMinPromptLength": 10,
          "recallCacheTtlMs": 300000
        }
      }
    }
  }
}
```

### 配置项说明

| 配置项 | 类型 | 必需 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `apiKey` | `string` | ✅ | - | DashScope API Key，支持 `${ENV_VAR}` 格式 |
| `userId` | `string` | ✅ | - | 用户 ID，用于隔离不同用户的记忆 |
| `baseUrl` | `string` | ❌ | `https://dashscope.aliyuncs.com/api/v2/apps/memory` | API endpoint（私有部署时填写完整 URL） |
| `autoCapture` | `boolean` | ❌ | `true` | 是否自动捕获对话 |
| `autoRecall` | `boolean` | ❌ | `true` | 是否自动召回记忆 |
| `topK` | `number` | ❌ | `5` | 搜索/召回的记忆数量 |
| `minScore` | `number` | ❌ | `0` | 最小相似度阈值（0-100） |
| `captureMaxMessages` | `number` | ❌ | `10` | 自动捕获时的最大消息数量 |
| `recallMinPromptLength` | `number` | ❌ | `10` | 触发自动召回的最小 prompt 长度 |
| `recallCacheTtlMs` | `number` | ❌ | `300000` | 召回缓存时间（毫秒），0 禁用缓存 |

## 环境变量

```bash
# 设置 DashScope API Key
export DASHSCOPE_API_KEY="your-api-key"

# 重启 Gateway
openclaw gateway restart
```

获取 API Key：https://help.aliyun.com/zh/model-studio/get-api-key

## 使用方法

### 自动记忆（推荐）

安装并配置后，插件会自动工作：

1. **自动捕获**：每次对话结束后，自动提取关键信息存储
2. **自动召回**：每次对话开始前，自动检索相关记忆注入上下文

无需手动干预，Agent 会自动拥有长期记忆能力。

### 手动工具

Agent 可以调用以下工具：

#### `memory_search` - 搜索记忆

```
用户："我之前说过什么重要的事情？"
→ Agent 调用 memory_search({ query: "重要的事情" })
→ 返回相关记忆列表
```

#### `memory_store` - 手动存储记忆

```
用户："记住我喜欢 Go 语言"
→ Agent 调用 memory_store({ content: "用户喜欢 Go 语言" })
→ 直接存储，不走提取逻辑
```

#### `memory_list` - 列出记忆

```
用户："列出我所有的记忆"
→ Agent 调用 memory_list({ page: 1, pageSize: 10 })
→ 返回记忆列表
```

#### `memory_forget` - 删除记忆

```
用户："删除我关于 XXX 的记忆"
→ Agent 先调用 memory_search 找到记忆 ID
→ 然后调用 memory_forget({ memoryId: "xxx" })
→ 删除指定记忆
```

### CLI 命令

```bash
# 搜索记忆
openclaw modelstudio-memory search "我需要做什么"

# 列出记忆
openclaw modelstudio-memory list --page 1 --size 10

# 查看状态
openclaw modelstudio-memory stats
```

## 工作原理

### 自动捕获流程

```
对话结束 → agent_end 钩子触发
    ↓
提取最近 N 条消息
    ↓
调用ModelStudio AddMemory API
    ↓
服务端 AI 自动提取关键信息
    ↓
存储到向量数据库
```

### 自动召回流程

```
用户发送消息 → before_agent_start 钩子触发
    ↓
检查 prompt 长度（短消息跳过）
    ↓
检查缓存（可选）
    ↓
调用ModelStudio SearchMemory API
    ↓
返回相关记忆
    ↓
注入到 prompt 上下文
```

## 注意事项

1. **API 限流**：
   - AddMemory: 120 QPM
   - SearchMemory: 300 QPM
   - 总计不超过 3000 QPM

2. **延迟**：
   - 搜索延迟约 200-500ms
   - 捕获延迟约 500-1000ms（后台异步，不影响响应）

3. **缓存**：
   - 默认启用 5 分钟召回缓存
   - 可通过 `recallCacheTtlMs: 0` 禁用

## 故障排查

### 检查插件状态

```bash
openclaw plugins info openclaw-modelstudio-memory
openclaw modelstudio-memory stats
```

### 查看日志

```bash
tail -f ~/.openclaw/logs/gateway.log | grep modelstudio-memory
```

### 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| `apiKey is required` | 未配置 API Key | 设置 `DASHSCOPE_API_KEY` 环境变量 |
| `InvalidApiKey` | API Key 无效 | 检查 API Key 是否正确 |
| `TooManyRequests` | 请求频率过高 | 降低调用频率 |

## 相关文档

- [ModelStudio长期记忆 API 文档](https://help.aliyun.com/zh/model-studio/developer-reference/long-term-memory)
- [获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)
- [OpenClaw 插件开发指南](https://docs.openclaw.ai/tools/plugin)

## License

Apache-2.0