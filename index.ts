/**
 * OpenClaw ModelStudio Memory Plugin
 *
 * 阿里云百炼记忆服务插件，提供长期记忆能力
 *
 * Features:
 * - memory_search: 语义搜索记忆
 * - memory_store: 手动存储记忆（使用 custom_content）
 * - memory_list: 列出所有记忆
 * - memory_forget: 删除指定记忆
 * - autoRecall: 自动召回相关记忆
 * - autoCapture: 自动捕获对话
 * - CLI: openclaw modelstudio-memory search/stats
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ============================================================================
// Types
// ============================================================================

type BailianMemoryConfig = {
  apiKey: string;
  userId: string;
  baseUrl: string;
  autoCapture: boolean;
  autoRecall: boolean;
  topK: number;
  minScore: number;
  captureMaxMessages: number;
  recallMinPromptLength: number;
  recallCacheTtlMs: number;
};

interface MemoryNode {
  memory_node_id: string;
  content: string;
  created_at?: number;
  updated_at?: number;
  score?: number;
}

interface SearchResponse {
  request_id: string;
  memory_nodes: MemoryNode[];
}

interface AddResponse {
  request_id: string;
  memory_nodes: Array<{
    memory_node_id: string;
    content: string;
    event: string;
  }>;
}

interface ListResponse {
  request_id: string;
  memory_nodes: MemoryNode[];
  total: number;
  page_num: number;
  page_size: number;
}

// ============================================================================
// Config Schema
// ============================================================================

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v2/apps/memory";

const ALLOWED_KEYS = [
  "apiKey",
  "userId",
  "baseUrl",
  "autoCapture",
  "autoRecall",
  "topK",
  "minScore",
  "captureMaxMessages",
  "recallMinPromptLength",
  "recallCacheTtlMs",
];

function resolveEnvVars(value: string): string {
  if (!value) return value;
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const envValue = process.env[key];
    return envValue || "";
  });
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

const modelstudioMemoryConfigSchema = {
  parse(value: unknown): BailianMemoryConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("openclaw-modelstudio-memory config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, ALLOWED_KEYS, "openclaw-modelstudio-memory config");

    // apiKey 是必需的
    const apiKey = typeof cfg.apiKey === "string" ? resolveEnvVars(cfg.apiKey) : "";
    if (!apiKey) {
      throw new Error("apiKey is required for openclaw-modelstudio-memory");
    }

    // userId 是必需的
    const userId = typeof cfg.userId === "string" ? cfg.userId : "";
    if (!userId) {
      throw new Error("userId is required for openclaw-modelstudio-memory");
    }

    return {
      apiKey,
      userId,
      baseUrl:
        typeof cfg.baseUrl === "string" && cfg.baseUrl
          ? cfg.baseUrl
          : DEFAULT_BASE_URL,
      autoCapture: cfg.autoCapture !== false,
      autoRecall: cfg.autoRecall !== false,
      topK: typeof cfg.topK === "number" ? cfg.topK : 5,
      minScore: typeof cfg.minScore === "number" ? cfg.minScore : 0,
      captureMaxMessages:
        typeof cfg.captureMaxMessages === "number" ? cfg.captureMaxMessages : 10,
      recallMinPromptLength:
        typeof cfg.recallMinPromptLength === "number"
          ? cfg.recallMinPromptLength
          : 10,
      recallCacheTtlMs:
        typeof cfg.recallCacheTtlMs === "number" ? cfg.recallCacheTtlMs : 300000,
    };
  },
};

// ============================================================================
// API Client
// ============================================================================

class BailianMemoryClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private userId: string,
    private logger: any
  ) {}

  /**
   * 添加记忆（从对话中自动提取）
   */
  async addMemory(
    messages: Array<{ role: string; content: string }>
  ): Promise<AddResponse> {
    const response = await fetch(`${this.baseUrl}/add`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        user_id: this.userId,
        messages,
      }),
    });
    return this.handleResponse(response);
  }

  /**
   * 添加自定义内容（直接存储，不走提取逻辑）
   */
  async addCustomContent(content: string): Promise<AddResponse> {
    const response = await fetch(`${this.baseUrl}/add`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        user_id: this.userId,
        custom_content: content,
      }),
    });
    return this.handleResponse(response);
  }

  /**
   * 搜索记忆
   */
  async searchMemory(
    messages: Array<{ role: string; content: string }>,
    topK: number,
    minScore: number
  ): Promise<SearchResponse> {
    const response = await fetch(`${this.baseUrl}/memory_nodes/search`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        user_id: this.userId,
        messages,
        top_k: topK,
        min_score: minScore,
      }),
    });
    return this.handleResponse(response);
  }

  /**
   * 列出记忆
   */
  async listMemory(pageNum: number, pageSize: number): Promise<ListResponse> {
    const url = `${this.baseUrl}/memory_nodes?user_id=${encodeURIComponent(this.userId)}&page_num=${pageNum}&page_size=${pageSize}`;
    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  /**
   * 删除记忆
   */
  async deleteMemory(memoryNodeId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/memory_nodes/${encodeURIComponent(memoryNodeId)}`,
      {
        method: "DELETE",
        headers: this.getHeaders(),
      }
    );
    await this.handleResponse(response);
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async handleResponse(response: Response): Promise<any> {
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const error = await response.json();
        errorMessage = error.message || error.error || errorMessage;
      } catch {}
      throw new Error(`Bailian API Error: ${errorMessage}`);
    }
    return response.json();
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * 从消息内容中提取文本
 */
function extractTextContent(content: any): string {
  if (typeof content === "string") {
    // 清理可能的元数据前缀（如 "Sender (untrusted metadata):" 等）
    let text = content;
    
    // 移除 "Sender (untrusted metadata):" 前缀
    text = text.replace(/^Sender \(untrusted metadata\):\s*\n/g, "");
    
    // 移除 JSON 元数据块（```json ... ```）
    text = text.replace(/```json\s*\{[\s\S]*?\}\s*```\n?/g, "");
    
    // 移除时间戳行（如 "[Wed 2026-03-11 00:23 GMT+8]"）
    text = text.replace(/^\[.*?GMT.*?\]\s*/gm, "");
    
    // 移除空行
    text = text.trim();
    
    return text;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && typeof block === "object" && "text" in block)
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

/**
 * 格式化记忆上下文（用于 autoRecall）
 */
function formatMemoriesContext(memories: MemoryNode[]): string {
  const lines = memories.map((m) => `- ${m.content}`);
  return `<relevant-memories>\n找到以下相关记忆:\n${lines.join("\n")}\n</relevant-memories>`;
}

/**
 * 清理消息中的注入上下文
 */
function stripInjectedContext(text: string): string {
  return text.replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>\s*/g, "").trim();
}

// ============================================================================
// Plugin Definition
// ============================================================================

const modelstudioMemoryPlugin = {
  id: "openclaw-modelstudio-memory",
  name: "Memory (Bailian)",
  description: "阿里云百炼长期记忆服务",
  kind: "memory" as const,
  configSchema: modelstudioMemoryConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = modelstudioMemoryConfigSchema.parse(api.pluginConfig);
    const client = new BailianMemoryClient(
      cfg.baseUrl,
      cfg.apiKey,
      cfg.userId,
      api.logger
    );

    api.logger.info(
      `modelstudio-memory: 已注册 (user: ${cfg.userId}, autoCapture: ${cfg.autoCapture}, autoRecall: ${cfg.autoRecall})`
    );

    // ========================================================================
    // Tools
    // ========================================================================

    // ========== memory_search ==========
    api.registerTool(
      {
        name: "memory_search",
        description: "在百炼记忆服务中搜索相关记忆",
        parameters: Type.Object({
          query: Type.String({ description: "搜索查询" }),
          limit: Type.Optional(
            Type.Number({ default: cfg.topK, description: "返回结果数量" })
          ),
        }),
        async execute(_id, params) {
          try {
            const messages = [{ role: "user" as const, content: params.query }];
            const result = await client.searchMemory(
              messages,
              params.limit || cfg.topK,
              cfg.minScore
            );

            const memories = result.memory_nodes || [];

            if (memories.length === 0) {
              return {
                content: [{ type: "text", text: "未找到相关记忆" }],
              };
            }

            const text = memories
              .map((m, i) => `${i + 1}. [${m.memory_node_id}] ${m.content}`)
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `找到 ${memories.length} 条相关记忆:\n\n${text}`,
                },
              ],
              details: {
                count: memories.length,
                memories: memories.map((m) => ({
                  id: m.memory_node_id,
                  content: m.content,
                  score: m.score,
                  created_at: m.created_at,
                  updated_at: m.updated_at,
                })),
              },
            };
          } catch (err) {
            return {
              content: [
                { type: "text", text: `记忆搜索失败: ${err}` },
              ],
              isError: true,
            };
          }
        },
      },
      { name: "memory_search" }
    );

    // ========== memory_store ==========
    api.registerTool(
      {
        name: "memory_store",
        description: "手动存储记忆到百炼服务（直接存储，不走提取逻辑）",
        parameters: Type.Object({
          content: Type.String({ description: "要存储的内容" }),
        }),
        async execute(_id, params) {
          try {
            const result = await client.addCustomContent(params.content);

            const addedCount = result.memory_nodes?.length || 0;

            return {
              content: [
                {
                  type: "text",
                  text: addedCount > 0 ? `已存储 ${addedCount} 条记忆` : "存储成功",
                },
              ],
              details: {
                action: "store",
                count: addedCount,
                memory_nodes: result.memory_nodes,
              },
            };
          } catch (err) {
            return {
              content: [
                { type: "text", text: `记忆存储失败: ${err}` },
              ],
              isError: true,
            };
          }
        },
      },
      { name: "memory_store" }
    );

    // ========== memory_list ==========
    api.registerTool(
      {
        name: "memory_list",
        description: "列出百炼服务中的所有记忆",
        parameters: Type.Object({
          page: Type.Optional(
            Type.Number({ default: 1, description: "页码" })
          ),
          pageSize: Type.Optional(
            Type.Number({ default: 10, description: "每页数量" })
          ),
        }),
        async execute(_id, params) {
          try {
            const result = await client.listMemory(
              params.page || 1,
              params.pageSize || 10
            );

            const memories = result.memory_nodes || [];

            if (memories.length === 0) {
              return {
                content: [{ type: "text", text: "暂无记忆" }],
              };
            }

            const text = memories
              .map((m, i) => `${i + 1}. [${m.memory_node_id}] ${m.content}`)
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `共有 ${result.total} 条记忆，当前显示第 ${result.page_num} 页:\n\n${text}`,
                },
              ],
              details: {
                total: result.total,
                page: result.page_num,
                pageSize: result.page_size,
                memories: memories.map((m) => ({
                  id: m.memory_node_id,
                  content: m.content,
                  created_at: m.created_at,
                  updated_at: m.updated_at,
                })),
              },
            };
          } catch (err) {
            return {
              content: [
                { type: "text", text: `获取记忆列表失败: ${err}` },
              ],
              isError: true,
            };
          }
        },
      },
      { name: "memory_list" }
    );

    // ========== memory_forget ==========
    api.registerTool(
      {
        name: "memory_forget",
        description: "删除指定的记忆。支持三种方式：1) 直接提供 memoryId; 2) 提供 query 关键词搜索后删除; 3) 提供 index 删除第 N 条",
        parameters: Type.Object({
          memoryId: Type.Optional(Type.String({ description: "要删除的记忆 ID（完整 32 位）" })),
          query: Type.Optional(Type.String({ description: "搜索关键词（用于查找要删除的记忆）" })),
          index: Type.Optional(Type.Number({ description: "删除列表中的第 N 条（从 1 开始）" })),
        }),
        async execute(_id, params) {
          try {
            let targetId = params.memoryId;

            // 方式 1：直接提供 memoryId
            if (targetId) {
              await client.deleteMemory(targetId);
              return {
                content: [
                  { type: "text", text: `已删除记忆：${targetId}` },
                ],
                details: {
                  action: "forget",
                  memoryId: targetId,
                },
              };
            }

            // 方式 2：通过 query 搜索后删除
            if (params.query) {
              const searchResult = await client.searchMemory(
                [{ role: "user", content: params.query }],
                1,
                0
              );
              
              if (!searchResult.memory_nodes || searchResult.memory_nodes.length === 0) {
                return {
                  content: [
                    { type: "text", text: `未找到与 "${params.query}" 相关的记忆` },
                  ],
                  isError: true,
                };
              }

              targetId = searchResult.memory_nodes[0].memory_node_id;
              await client.deleteMemory(targetId);
              
              return {
                content: [
                  { type: "text", text: `已删除记忆：${searchResult.memory_nodes[0].content}` },
                ],
                details: {
                  action: "forget",
                  memoryId: targetId,
                  matchedBy: "query",
                  query: params.query,
                },
              };
            }

            // 方式 3：通过 index 删除第 N 条
            if (params.index && params.index > 0) {
              const listResult = await client.listMemory(1, params.index);
              
              if (!listResult.memory_nodes || listResult.memory_nodes.length < params.index) {
                return {
                  content: [
                    { type: "text", text: `当前只有 ${listResult.memory_nodes?.length || 0} 条记忆，无法删除第 ${params.index} 条` },
                  ],
                  isError: true,
                };
              }

              targetId = listResult.memory_nodes[params.index - 1].memory_node_id;
              await client.deleteMemory(targetId);
              
              return {
                content: [
                  { type: "text", text: `已删除第 ${params.index} 条记忆：${listResult.memory_nodes[params.index - 1].content}` },
                ],
                details: {
                  action: "forget",
                  memoryId: targetId,
                  matchedBy: "index",
                  index: params.index,
                },
              };
            }

            // 没有提供任何参数
            return {
              content: [
                { type: "text", text: "请提供 memoryId、query 或 index 参数" },
              ],
              isError: true,
            };
          } catch (err) {
            return {
              content: [
                { type: "text", text: `删除记忆失败：${err}` },
              ],
              isError: true,
            };
          }
        },
      },
      { name: "memory_forget" }
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // ========== autoRecall ==========
    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event) => {
        // 短消息跳过
        if (!event.prompt || event.prompt.length < cfg.recallMinPromptLength) {
          return;
        }

        // 构造消息格式
        const messages = [{ role: "user" as const, content: event.prompt }];

        try {
          const result = await client.searchMemory(
            messages,
            cfg.topK,
            cfg.minScore
          );
          const memories = result.memory_nodes || [];

          // 注入上下文
          if (memories.length > 0) {
            api.logger.info(
              `modelstudio-memory: 召回了 ${memories.length} 条记忆`
            );
            return {
              prependContext: formatMemoriesContext(memories),
            };
          }
        } catch (err) {
          api.logger.warn(`modelstudio-memory: 召回失败: ${err}`);
        }
      });
    }

    // ========== autoCapture ==========
    if (cfg.autoCapture) {
      api.on("agent_end", async (event) => {
        if (!event.success || !event.messages) {
          return;
        }

        try {
          // 提取最近 N 条消息
          const recentMessages = event.messages.slice(-cfg.captureMaxMessages);

          // 格式化消息
          const formattedMessages: Array<{ role: string; content: string }> =
            [];

          for (const msg of recentMessages) {
            if (!msg || typeof msg !== "object") continue;

            const role = (msg as any).role;
            if (role !== "user" && role !== "assistant") continue;

            let content = extractTextContent((msg as any).content);
            if (!content) continue;

            // 清理注入的记忆上下文
            content = stripInjectedContext(content);
            if (!content) continue;

            formattedMessages.push({ role, content });
          }

          if (formattedMessages.length === 0) return;

          // 调用添加记忆 API
          const result = await client.addMemory(formattedMessages);

          const addedCount = result.memory_nodes?.length || 0;
          if (addedCount > 0) {
            api.logger.info(
              `modelstudio-memory: 捕获了 ${addedCount} 条记忆`
            );
          }
        } catch (err) {
          api.logger.warn(`modelstudio-memory: 捕获失败: ${err}`);
        }
      });
    }

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const modelstudio = program
          .command("modelstudio-memory")
          .description("Bailian memory plugin commands");

modelstudio
          .command("search")
          .description("Search memories in Bailian")
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", String(cfg.topK))
          .action(async (query: string, opts: { limit: string }) => {
            try {
              const limit = parseInt(opts.limit, 10);
              const messages = [{ role: "user" as const, content: query }];
              const result = await client.searchMemory(messages, limit, cfg.minScore);

              const memories = result.memory_nodes || [];

              if (memories.length === 0) {
                console.log("No memories found.");
                return;
              }

              const output = memories.map((m) => ({
                id: m.memory_node_id,
                content: m.content,
                score: m.score,
              }));

              console.log(JSON.stringify(output, null, 2));
            } catch (err) {
              console.error(`Search failed: ${err}`);
            }
          });

        // stats 命令
        modelstudio
          .command("stats")
          .description("Show memory statistics")
          .action(async () => {
            try {
              const result = await client.listMemory(1, 1);
              console.log(`User: ${cfg.userId}`);
              console.log(`Total memories: ${result.total}`);
              console.log(`Auto-capture: ${cfg.autoCapture}`);
              console.log(`Auto-recall: ${cfg.autoRecall}`);
              console.log(`Top-K: ${cfg.topK}`);
            } catch (err) {
              console.error(`Stats failed: ${err}`);
            }
          });

        // list 命令
        modelstudio
          .command("list")
          .description("List all memories")
          .option("--page <n>", "Page number", "1")
          .option("--size <n>", "Page size", "10")
          .action(async (opts: { page: string; size: string }) => {
            try {
              const page = parseInt(opts.page, 10);
              const size = parseInt(opts.size, 10);
              const result = await client.listMemory(page, size);

              const memories = result.memory_nodes || [];

              if (memories.length === 0) {
                console.log("No memories found.");
                return;
              }

              const output = memories.map((m) => ({
                id: m.memory_node_id,
                content: m.content,
                created_at: m.created_at,
              }));

              console.log(
                `Total: ${result.total}, Page: ${result.page_num}/${Math.ceil(result.total / result.page_size)}`
              );
              console.log(JSON.stringify(output, null, 2));
            } catch (err) {
              console.error(`List failed: ${err}`);
            }
          });
      },
      { commands: ["modelstudio-memory"] }
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "openclaw-modelstudio-memory",
      start: () => {
        api.logger.info("modelstudio-memory: 服务已启动");
      },
      stop: () => {
        api.logger.info("modelstudio-memory: 服务已停止");
      },
    });
  },
};

export default modelstudioMemoryPlugin;