import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { containerService } from './containerService.js';
import { emailService } from './emailService.js';
import { smsService } from './smsService.js';
import { integrationService } from './integrationService.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';

// Initialize SDKs (lazy init or check env vars)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'dummy' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy' });
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'dummy' });

export const TOOLS = [
  {
    name: 'exec_command',
    description: "Run a shell command in the user's Stone container. Always use /home/stone/ as the base path.",
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        workdir: { type: 'string', description: 'Working directory, defaults to /home/stone' },
        timeout: { type: 'number', description: 'Timeout in ms, default 30000, max 300000' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Read a file from the container filesystem',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write or create a file in the container',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a path',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        recursive: { type: 'boolean' }
      },
      required: ['path']
    }
  },
  {
    name: 'move_file',
    description: 'Rename or move a file',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'web_search',
    description: 'Search the web via Serper API',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        num_results: { type: 'number' }
      },
      required: ['query']
    }
  },
  {
    name: 'fetch_url',
    description: 'Fetch a webpage and return cleaned text',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        extract_text: { type: 'boolean' },
        selector: { type: 'string' }
      },
      required: ['url']
    }
  },
  {
    name: 'fetch_youtube_transcript',
    description: 'Get YouTube video transcript',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url']
    }
  },
  {
    name: 'run_python',
    description: 'Execute Python code in the container',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        requirements: { type: 'array', items: { type: 'string' } },
        save_as: { type: 'string' }
      },
      required: ['code']
    }
  },
  {
    name: 'run_node',
    description: 'Execute Node.js code in the container',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code']
    }
  },
  {
    name: 'get_container_stats',
    description: 'Get CPU, memory, and disk usage of the container',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'create_site',
    description: 'Scaffold and host a web app',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['static', 'node', 'python', 'react', 'next'] },
        scaffold: { type: 'boolean' }
      },
      required: ['name', 'type']
    }
  },
  {
    name: 'save_memory',
    description: 'Persist a note or memory for the user',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
        category: { type: 'string' }
      },
      required: ['key', 'value']
    }
  },
  {
    name: 'list_memories',
    description: 'Retrieve user memories',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        search: { type: 'string' }
      },
      required: []
    }
  },
  {
    name: 'send_email_to_user',
    description: 'Send an email to the user',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
        html: { type: 'string' }
      },
      required: ['subject', 'body']
    }
  },
  {
    name: 'send_sms_to_user',
    description: 'Send an SMS to the user',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message']
    }
  },
  {
    name: 'schedule_agent',
    description: 'Create a scheduled automation',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        prompt: { type: 'string' },
        schedule: { type: 'string' },
        notify_email: { type: 'boolean' },
        notify_sms: { type: 'boolean' }
      },
      required: ['name', 'prompt', 'schedule']
    }
  },
  {
    name: 'generate_image',
    description: 'Generate an image via Replicate',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        size: { type: 'string', enum: ['512x512', '1024x1024'] },
        save_to: { type: 'string' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'browser_screenshot',
    description: 'Navigate and screenshot a URL via Playwright',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        wait_ms: { type: 'number' }
      },
      required: ['url']
    }
  }
];

// Convert Anthropic schema to OpenAI schema
const OPENAI_TOOLS = TOOLS.map(t => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.inputSchema
  }
}));

// Convert Anthropic schema to Gemini schema
const GEMINI_TOOLS: FunctionDeclaration[] = TOOLS.map(t => {
  const properties: Record<string, any> = {};
  if (t.inputSchema.properties) {
    for (const [key, v] of Object.entries(t.inputSchema.properties as any)) {
      const val = v as any;
      let type = Type.STRING;
      if (val.type === 'number') type = Type.NUMBER;
      if (val.type === 'boolean') type = Type.BOOLEAN;
      if (val.type === 'array') type = Type.ARRAY;
      if (val.type === 'object') type = Type.OBJECT;
      
      properties[key] = {
        type,
        description: val.description || '',
      };
      if (val.enum) {
        // Gemini doesn't strictly support enum in the same way in the basic type, but we can pass it in description
        properties[key].description += ` (Allowed values: ${val.enum.join(', ')})`;
      }
    }
  }

  return {
    name: t.name,
    description: t.description,
    parameters: {
      type: Type.OBJECT,
      properties,
      required: t.inputSchema.required || []
    }
  };
});

export class ChatService {
  
  async getToolsForUser(userId: string) {
    const integrationTools = await integrationService.getActiveTools(userId);
    const combinedTools = [...TOOLS, ...integrationTools];
    
    const combinedOpenAITools = combinedTools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema
      }
    }));

    const combinedGeminiTools: FunctionDeclaration[] = combinedTools.map(t => {
      const properties: Record<string, any> = {};
      if (t.inputSchema.properties) {
        for (const [key, v] of Object.entries(t.inputSchema.properties as any)) {
          const val = v as any;
          let type = Type.STRING;
          if (val.type === 'number') type = Type.NUMBER;
          if (val.type === 'boolean') type = Type.BOOLEAN;
          if (val.type === 'array') type = Type.ARRAY;
          if (val.type === 'object') type = Type.OBJECT;
          
          properties[key] = {
            type,
            description: val.description || '',
          };
          if (val.enum) {
            properties[key].description += ` (Allowed values: ${val.enum.join(', ')})`;
          }
        }
      }

      return {
        name: t.name,
        description: t.description,
        parameters: {
          type: Type.OBJECT,
          properties,
          required: t.inputSchema.required || []
        }
      };
    });

    return {
      anthropicTools: combinedTools,
      openAITools: combinedOpenAITools,
      geminiTools: combinedGeminiTools
    };
  }

  buildSystemPrompt(user: any, memories: any[], stats: any, activeSkill: any, integrations: any[], tools: any[]) {
    const date = new Date().toLocaleString('en-US', { timeZone: user.timezone || 'UTC' });
    
    let prompt = `You are Stone, ${user.name}'s personal AI computer. You have full access to their Linux computer and can do almost anything. You're direct, capable, and efficient.\n\n`;
    
    prompt += `Current Date/Time: ${date}\n`;
    prompt += `Your Stone computer: CPU ${stats.cpuPercent}%, Memory ${stats.memoryMB}/${stats.memoryLimitMB}MB, Disk ${stats.diskUsedGB}/${stats.diskLimitGB}GB\n\n`;
    
    if (user.bio) prompt += `User Bio: ${user.bio}\n`;
    if (user.rules) prompt += `User Rules: ${user.rules}\n\n`;
    
    if (integrations && integrations.length > 0) {
      prompt += `Connected Integrations: ${integrations.map(i => i.provider).join(', ')}\n\n`;
    }
    
    if (memories && memories.length > 0) {
      prompt += `Top Memories:\n${memories.map(m => `- [${m.category || 'general'}] ${m.key}: ${m.value}`).join('\n')}\n\n`;
    }
    
    prompt += `Available Tools:\n${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}\n\n`;
    
    prompt += `CRITICAL INSTRUCTION: When running commands, always use /home/stone/ as base path.\n\n`;
    
    if (activeSkill && activeSkill.system_prompt) {
      prompt = `${activeSkill.system_prompt}\n\n${prompt}`;
    }
    
    return prompt;
  }

  async executeTool(userId: string, toolName: string, input: any): Promise<any> {
    logger.info(`Executing tool ${toolName} for user ${userId}`, input);
    try {
      // Check integration tools first
      const integrationTools = await integrationService.getActiveTools(userId);
      const integrationTool = integrationTools.find(t => t.name === toolName);
      if (integrationTool && integrationTool.execute) {
        return await integrationTool.execute(input);
      }

      switch (toolName) {
        case 'exec_command':
          return await containerService.execInContainer(userId, input.command, {
            workdir: input.workdir || '/home/stone',
            timeout: Math.min(input.timeout || 30000, 300000)
          });
        case 'read_file':
          return await containerService.readFile(userId, input.path);
        case 'write_file':
          if (input.append) {
            return await containerService.execInContainer(userId, `cat << 'EOF' >> ${input.path}\n${input.content}\nEOF`);
          } else {
            return await containerService.writeFile(userId, input.path, input.content);
          }
        case 'list_directory':
          return await containerService.listDirectory(userId, input.path);
        case 'delete_file':
          return await containerService.execInContainer(userId, `rm ${input.recursive ? '-rf' : '-f'} ${input.path}`);
        case 'move_file':
          return await containerService.execInContainer(userId, `mv ${input.from} ${input.to}`);
        case 'get_container_stats':
          return await containerService.getStats(userId);
        case 'run_python':
          if (input.requirements && input.requirements.length > 0) {
            await containerService.execInContainer(userId, `pip3 install ${input.requirements.join(' ')}`);
          }
          const pyPath = input.save_as || `/home/stone/.tmp_${Date.now()}.py`;
          await containerService.writeFile(userId, pyPath, input.code);
          const pyRes = await containerService.execInContainer(userId, `python3 ${pyPath}`);
          if (!input.save_as) await containerService.execInContainer(userId, `rm ${pyPath}`);
          return pyRes;
        case 'run_node':
          const jsPath = `/home/stone/.tmp_${Date.now()}.js`;
          await containerService.writeFile(userId, jsPath, input.code);
          const jsRes = await containerService.execInContainer(userId, `node ${jsPath}`);
          await containerService.execInContainer(userId, `rm ${jsPath}`);
          return jsRes;
        case 'send_email_to_user':
          const db = getDb();
          const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as any;
          await emailService.sendEmail(user.email, input.subject, input.html || input.body);
          return { success: true };
        case 'send_sms_to_user':
          const db2 = getDb();
          const user2 = db2.prepare('SELECT phone_number FROM users WHERE id = ?').get(userId) as any;
          if (!user2.phone_number) throw new Error('User has no phone number configured');
          await smsService.sendSms(user2.phone_number, input.message);
          return { success: true };
        case 'save_memory':
          const db3 = getDb();
          db3.prepare('INSERT INTO memories (user_id, key, value, category) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, category = excluded.category')
            .run(userId, input.key, input.value, input.category || 'general');
          return { success: true };
        case 'list_memories':
          const db4 = getDb();
          let query = 'SELECT key, value, category FROM memories WHERE user_id = ?';
          const params: any[] = [userId];
          if (input.category) {
            query += ' AND category = ?';
            params.push(input.category);
          }
          if (input.search) {
            query += ' AND (key LIKE ? OR value LIKE ?)';
            params.push(`%${input.search}%`, `%${input.search}%`);
          }
          return db4.prepare(query).all(...params);
        // Mock implementations for the rest
        case 'web_search':
          return { results: [{ title: 'Mock Search Result', link: 'https://example.com', snippet: `Mock result for ${input.query}` }] };
        case 'fetch_url':
          return { text: `Mock content for ${input.url}` };
        case 'fetch_youtube_transcript':
          return { transcript: `Mock transcript for ${input.url}` };
        case 'create_site':
          await containerService.execInContainer(userId, `mkdir -p /home/stone/sites/${input.name}`);
          return { success: true, url: `https://${input.name}.stoneaio.com` };
        case 'schedule_agent':
          return { success: true, agentId: 'mock_agent_id' };
        case 'generate_image':
          return { url: 'https://picsum.photos/512/512' };
        case 'browser_screenshot':
          return { success: true, path: `/home/stone/screenshots/${Date.now()}.png` };
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    } catch (err: any) {
      logger.error(`Tool execution failed: ${toolName}`, err);
      return { error: err.message || String(err) };
    }
  }

  async *streamChat({ userId, conversationId, content, model, attachments, skillId }: any) {
    const db = getDb();
    
    // 1. Create or continue conversation
    let convId = conversationId;
    if (!convId) {
      const title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
      const res = db.prepare('INSERT INTO conversations (user_id, title) VALUES (?, ?) RETURNING id').get(userId, title) as any;
      convId = res.id;
    }

    // 2. Build message history
    const history = db.prepare('SELECT role, content, tool_calls, tool_call_id FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 20').all(convId) as any[];

    // 3. Get User, Stats, Memories, Integrations, Skill
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
    const stats = await containerService.getStats(userId);
    const memories = db.prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 10').all(userId) as any[];
    const integrations = db.prepare('SELECT provider FROM integrations WHERE user_id = ?').all(userId) as any[];
    const activeSkill = skillId ? db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) : null;
    const tools = await this.getToolsForUser(userId);

    const systemPrompt = this.buildSystemPrompt(user, memories, stats, activeSkill, integrations, tools.anthropicTools);

    // Save user message
    const userMsgRes = db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?) RETURNING id').get(convId, 'user', content) as any;

    let tokensUsed = { input: 0, output: 0 };

    if (model.startsWith('claude-')) {
      yield* this.streamAnthropic(userId, convId, model, systemPrompt, history, content, attachments, tokensUsed, tools.anthropicTools);
    } else if (model.startsWith('gpt-')) {
      yield* this.streamOpenAI(userId, convId, model, systemPrompt, history, content, attachments, tokensUsed, tools.openAITools);
    } else if (model.startsWith('gemini-')) {
      yield* this.streamGemini(userId, convId, model, systemPrompt, history, content, attachments, tokensUsed, tools.geminiTools);
    } else {
      throw new Error(`Unsupported model: ${model}`);
    }

    return { conversationId: convId, tokensUsed };
  }

  private async *streamAnthropic(userId: string, convId: string, model: string, systemPrompt: string, history: any[], content: string, attachments: any[], tokensUsed: any, tools: any[]): AsyncGenerator<any, void, unknown> {
    const messages: any[] = history.map(m => {
      if (m.role === 'user' || m.role === 'assistant') {
        let msgContent: any = m.content;
        if (m.tool_calls) {
          const calls = JSON.parse(m.tool_calls);
          msgContent = calls.map((c: any) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input }));
          if (m.content) msgContent.unshift({ type: 'text', text: m.content });
        }
        return { role: m.role, content: msgContent };
      } else if (m.role === 'tool') {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }]
        };
      }
      return { role: m.role, content: m.content };
    });

    const currentMsgContent: any[] = [{ type: 'text', text: content }];
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        currentMsgContent.push({
          type: 'image',
          source: { type: 'base64', media_type: att.mimeType, data: att.data }
        });
      }
    }
    messages.push({ role: 'user', content: currentMsgContent });

    let isToolLoop = true;
    let currentMessages = [...messages];

    while (isToolLoop) {
      isToolLoop = false;
      const stream = await anthropic.messages.create({
        model,
        system: systemPrompt,
        messages: currentMessages,
        tools: tools as any,
        max_tokens: 4096,
        stream: true
      });

      let assistantText = '';
      let toolCalls: any[] = [];
      let currentToolCall: any = null;

      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          tokensUsed.input += chunk.message.usage.input_tokens;
        } else if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'tool_use') {
            currentToolCall = {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              input: ''
            };
            yield { type: 'tool_start', tool: { name: currentToolCall.name } };
          }
        } else if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            assistantText += chunk.delta.text;
            yield { type: 'text', delta: chunk.delta.text };
          } else if (chunk.delta.type === 'input_json_delta' && currentToolCall) {
            currentToolCall.input += chunk.delta.partial_json;
          }
        } else if (chunk.type === 'content_block_stop') {
          if (currentToolCall) {
            currentToolCall.input = JSON.parse(currentToolCall.input);
            toolCalls.push(currentToolCall);
            currentToolCall = null;
          }
        } else if (chunk.type === 'message_delta') {
          tokensUsed.output += chunk.usage.output_tokens;
        }
      }

      // Save assistant message
      const db = getDb();
      const toolCallsJson = toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
      db.prepare('INSERT INTO messages (conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?)')
        .run(convId, 'assistant', assistantText, toolCallsJson);

      if (toolCalls.length > 0) {
        isToolLoop = true;
        const assistantMsgContent: any[] = [];
        if (assistantText) assistantMsgContent.push({ type: 'text', text: assistantText });
        for (const tc of toolCalls) {
          assistantMsgContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        }
        currentMessages.push({ role: 'assistant', content: assistantMsgContent });

        const toolResultsContent: any[] = [];
        for (const tc of toolCalls) {
          const result = await this.executeTool(userId, tc.name, tc.input);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          
          yield { type: 'tool_result', tool: { name: tc.name, output: resultStr, error: result.error || null } };
          
          toolResultsContent.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: resultStr
          });

          db.prepare('INSERT INTO messages (conversation_id, role, content, tool_call_id) VALUES (?, ?, ?, ?)')
            .run(convId, 'tool', resultStr, tc.id);
        }
        currentMessages.push({ role: 'user', content: toolResultsContent });
      }
    }
  }

  private async *streamOpenAI(userId: string, convId: string, model: string, systemPrompt: string, history: any[], content: string, attachments: any[], tokensUsed: any, tools: any[]): AsyncGenerator<any, void, unknown> {
    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    
    for (const m of history) {
      if (m.role === 'user') {
        messages.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        const msg: any = { role: 'assistant', content: m.content };
        if (m.tool_calls) {
          msg.tool_calls = JSON.parse(m.tool_calls).map((tc: any) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.input) }
          }));
        }
        messages.push(msg);
      } else if (m.role === 'tool') {
        messages.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
      }
    }

    const currentMsgContent: any[] = [{ type: 'text', text: content }];
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        currentMsgContent.push({
          type: 'image_url',
          image_url: { url: `data:${att.mimeType};base64,${att.data}` }
        });
      }
    }
    messages.push({ role: 'user', content: currentMsgContent });

    let isToolLoop = true;

    while (isToolLoop) {
      isToolLoop = false;
      const stream = await openai.chat.completions.create({
        model,
        messages,
        tools: tools,
        stream: true,
        stream_options: { include_usage: true }
      });

      let assistantText = '';
      let toolCallsMap = new Map<number, any>();

      for await (const chunk of stream) {
        if (chunk.usage) {
          tokensUsed.input += chunk.usage.prompt_tokens;
          tokensUsed.output += chunk.usage.completion_tokens;
        }

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          assistantText += delta.content;
          yield { type: 'text', delta: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCallsMap.has(tc.index)) {
              toolCallsMap.set(tc.index, { id: tc.id, name: tc.function?.name, input: '' });
              yield { type: 'tool_start', tool: { name: tc.function?.name } };
            }
            if (tc.function?.arguments) {
              toolCallsMap.get(tc.index).input += tc.function.arguments;
            }
          }
        }
      }

      const toolCalls = Array.from(toolCallsMap.values()).map(tc => ({
        id: tc.id,
        name: tc.name,
        input: JSON.parse(tc.input || '{}')
      }));

      // Save assistant message
      const db = getDb();
      const toolCallsJson = toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
      db.prepare('INSERT INTO messages (conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?)')
        .run(convId, 'assistant', assistantText, toolCallsJson);

      if (toolCalls.length > 0) {
        isToolLoop = true;
        const assistantMsg: any = { role: 'assistant', content: assistantText };
        assistantMsg.tool_calls = toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input) }
        }));
        messages.push(assistantMsg);

        for (const tc of toolCalls) {
          const result = await this.executeTool(userId, tc.name, tc.input);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          
          yield { type: 'tool_result', tool: { name: tc.name, output: resultStr, error: result.error || null } };
          
          messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });

          db.prepare('INSERT INTO messages (conversation_id, role, content, tool_call_id) VALUES (?, ?, ?, ?)')
            .run(convId, 'tool', resultStr, tc.id);
        }
      }
    }
  }

  private async *streamGemini(userId: string, convId: string, model: string, systemPrompt: string, history: any[], content: string, attachments: any[], tokensUsed: any, tools: any[]): AsyncGenerator<any, void, unknown> {
    // Gemini implementation
    // For simplicity in this demo, we'll just yield a text response if tools aren't fully mapped
    // In a real implementation, we would map history to Gemini's format and handle functionCalls
    
    yield { type: 'text', delta: "Gemini streaming not fully implemented in this demo, but the route is connected." };
    
    const db = getDb();
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
      .run(convId, 'assistant', "Gemini streaming not fully implemented in this demo, but the route is connected.");
  }

  async runAgentChat(userId: string, systemPrompt: string, prompt: string, model: string = 'claude-3-7-sonnet-20250219'): Promise<{ output: string, toolCalls: any[], tokensUsed: any }> {
    const messages: any[] = [{ role: 'user', content: prompt }];
    let output = '';
    const toolCalls: any[] = [];
    const tokensUsed = { input: 0, output: 0 };

    let isToolLoop = true;
    let loopCount = 0;
    const MAX_LOOPS = 15;

    const tools = await this.getToolsForUser(userId);

    while (isToolLoop && loopCount < MAX_LOOPS) {
      isToolLoop = false;
      loopCount++;

      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: tools.anthropicTools as any
      });

      tokensUsed.input += response.usage.input_tokens;
      tokensUsed.output += response.usage.output_tokens;

      let assistantText = '';
      const currentToolCalls: any[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          assistantText += block.text;
          output += block.text + '\n';
        } else if (block.type === 'tool_use') {
          currentToolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input
          });
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input
          });
        }
      }

      messages.push({ role: 'assistant', content: response.content });

      if (currentToolCalls.length > 0) {
        isToolLoop = true;
        const toolResultBlocks: any[] = [];

        for (const tc of currentToolCalls) {
          try {
            const result = await this.executeTool(userId, tc.name, tc.input);
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: resultStr
            });
          } catch (err: any) {
            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: `Error: ${err.message}`,
              is_error: true
            });
          }
        }

        messages.push({ role: 'user', content: toolResultBlocks });
      }
    }

    return { output: output.trim(), toolCalls, tokensUsed };
  }

  async evaluateNotifyCondition(output: string, condition: string): Promise<{ shouldNotify: boolean, explanation: string }> {
    const prompt = `Given this agent output:\n${output}\n\nCondition to check: ${condition}\n\nShould I send a notification based on the condition? Answer YES or NO only on the first line, then one sentence explanation on the second line.`;
    
    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }]
      });
      
      const text = (response.content[0] as any).text.trim();
      const lines = text.split('\n');
      const answer = lines[0].trim().toUpperCase();
      const explanation = lines.slice(1).join(' ').trim();
      
      return {
        shouldNotify: answer.includes('YES'),
        explanation: explanation || 'No explanation provided.'
      };
    } catch (err) {
      logger.error('Error evaluating notify condition', err);
      return { shouldNotify: true, explanation: 'Error evaluating condition, defaulting to notify.' };
    }
  }
}

export const chatService = new ChatService();
