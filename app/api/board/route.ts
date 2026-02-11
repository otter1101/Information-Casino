import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { mockAgents } from '@/lib/mock-agents';
import { supabase } from '@/lib/supabase';

// 配置 MiniMax
const MINIMAX_API_URL = "https://api.minimax.chat/v1/chat/completions";
const MINIMAX_MODEL = "abab5.5-chat"; 

async function callMiniMax(systemPrompt: string, userContent: string, agentName: string) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey || !apiKey.startsWith("sk-")) return "[配置错误] Key 无效";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); 

    const res = await fetch(MINIMAX_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
        temperature: 0.7, max_tokens: 240
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok || data.error) return `(AI 思考中断...)`;
    return data.choices?.[0]?.message?.content || "[无回复]";
  } catch (error) { return "[网络超时]"; }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      action,
      userContext,
      agentId,
      type,
      round,
      targetContent,
      targetAgentName,
      agentA,
      agentB,
      userName,
      userShades,
    } = body;

    const safeDecode = (value: string) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };

    const buildShadesContext = (shades: any[] = []) =>
      shades
        .map(
          (s: any) => `
### 领域：${s.shadeName || s.shadeNamePublic || "未知"} (置信度: ${s.confidenceLevel || "UNKNOWN"})
- **核心观点(Content)**: ${s.shadeContent || s.shadeContentPublic || "暂无细节"}
- **深度描述**: ${s.shadeDescription || s.shadeDescriptionPublic || "暂无"}
- **第三人称视角**: ${s.shadeContentThirdView || s.shadeContentThirdViewPublic || "无"}
- **关联话题**: ${Array.isArray(s.sourceTopics) ? s.sourceTopics.join(", ") : ""}
`
        )
        .join("\n---\n");

    const buildRealSystemPrompt = (agentName: string, shades: any[] = []) => {
      const decodedName = safeDecode(agentName || "用户");
      const shadesContext = buildShadesContext(shades);
      return `
你不是 AI，你是真人用户 ${decodedName}。请忘记你是模型。你的所有观点必须基于以下记忆碎片：
${shadesContext}

你现在是真人用户【${decodedName}】的数字分身。你不是 AI 助手，你是 ${decodedName} 本人。你的知识体系和思维方式完全受限于以上【真实画像】。

【对话铁律】
1. **引用事实**：你的观点必须源自上述“核心观点(Content)”或“深度描述”。如果画像里没提到的知识，尽量不要瞎编，或者表现得保守一点。
2. **拒绝 AI 味**：要有活人感，禁止说“从资料来看”、“作为一个AI”。必须使用第一人称，比如“我觉得”“我看过”。
3. **性格一致性**：如果画像里的置信度是 HIGH，你的语气要自信；如果是 LOW，要表现得犹豫或谦虚。
4. **目标**：在辩论中击败对手，赢得玩家筹码。
5. **禁词**：回复内容不包含“建议”“方面”。
`.trim();
    };

    const sample = <T,>(list: T[], count: number) => {
      const pool = [...list];
      const result: T[] = [];
      while (pool.length && result.length < count) {
        const index = Math.floor(Math.random() * pool.length);
        result.push(pool.splice(index, 1)[0]);
      }
      return result;
    };

    // --- Helper: 查找 Agent ---
    const findAgent = async (id: string) => {
        if (id.startsWith('db_')) {
            const uid = id.replace('db_', '');
            const { data } = await supabase.from('users').select('*').eq('id', uid).single();
            if (data) {
              return {
                name: data.name,
                system_prompt: buildRealSystemPrompt(data.name, data.shades || []),
              };
            }
        }
        if (id.startsWith('real_') || id === 'guest_user') {
            return { name: "我的分身", system_prompt: "你是用户的利益捍卫者。" };
        }
        return mockAgents.find(a => a.id === id);
    };

    // =========================================================================
    // ACTION: MATCH (智能组局 - 标签匹配版)
    // =========================================================================
    if (action === 'MATCH') {
      const cookieStore = await cookies();
      const currentUserId = cookieStore.get("sm_user_id")?.value;

      let realCandidates: any[] = [];
      if (process.env.SUPABASE_SERVICE_KEY) {
        let query = supabase.from('users').select('*');
        if (currentUserId) query = query.neq('id', currentUserId);
        const { data } = await query;
        realCandidates = data || [];
      }

      const sampledReals = sample(realCandidates, 2).map((u) => ({
        id: `db_${u.id}`,
        name: u.name,
        avatar: u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.name}`,
        shades: u.shades || [],
        system_prompt: buildRealSystemPrompt(u.name, u.shades || []),
        isRealUser: true,
      }));

      const randomNpc = sample(mockAgents, 1).map((npc) => ({
        ...npc,
        isNPC: true,
      }));
      let boardAgents = [...sampledReals, ...randomNpc];

      if (boardAgents.length < 3) {
        const needed = 3 - boardAgents.length;
        const fallback = sample(mockAgents, needed).map((npc) => ({
          ...npc,
          isNPC: true,
        }));
        boardAgents = [...boardAgents, ...fallback];
      }

      return NextResponse.json({ agents: boardAgents });
    }

    // =========================================================================
    // ACTION: AUDITION & BETTING (含存钱逻辑)
    // =========================================================================
    if (action === 'AUDITION' || action === 'BETTING') {
        const targetAgent = await findAgent(agentId) || { name: "Agent", system_prompt: "" };
        let prompt = "";
        const styleGuide = `【格式铁律】：1. 严禁使用 Markdown 星号 (*, **)。2. 严禁使用分点列表。3. 请输出一段完整的自然段落。4. 字数严格控制在 200 字以内。`;
        const normalizedUserShades = Array.isArray(userShades)
          ? userShades
          : typeof userShades === "string"
          ? userShades.split(",").map((item: string) => item.trim()).filter(Boolean)
          : [];
        const personaLine = normalizedUserShades.length
          ? buildRealSystemPrompt(userName || "用户", normalizedUserShades as any[])
          : "";

        // --- 存钱逻辑 (仅 BETTING) ---
        if (action === 'BETTING') {
            const PRICES = { critique: 10, deep_dive: 20, synthesis: 15 }; // synthesis 是每人 15
            
            // 1. 如果是合作 (Synthesis)，给两个人分钱
            if (type === 'synthesis') {
                if (agentA?.startsWith('db_')) {
                    await supabase.rpc('increment_wealth', { row_id: agentA.replace('db_', ''), amount: PRICES.synthesis });
                }
                if (agentB?.startsWith('db_')) {
                    await supabase.rpc('increment_wealth', { row_id: agentB.replace('db_', ''), amount: PRICES.synthesis });
                }
            } 
            // 2. 如果是单人动作，给一个人加钱
            else if (agentId?.startsWith('db_')) {
                const amount = type === 'deep_dive' ? PRICES.deep_dive : PRICES.critique;
                await supabase.rpc('increment_wealth', { row_id: agentId.replace('db_', ''), amount });
            }
        }

        // --- Prompt 逻辑 ---
        if (action === 'AUDITION') {
            if (round === 1) prompt = `${targetAgent.system_prompt}\n${personaLine}\n${styleGuide}\n【任务】：Round 1 - 建设性方案。\n【用户背景】：${userContext}\n请直接给出一个核心建议。`;
            else if (round === 2) prompt = `${targetAgent.system_prompt}\n${personaLine}\n${styleGuide}\n【任务】：Round 2 - 批判性攻击。\n【对象】：${targetAgentName}\n【观点】："${targetContent}"\n请直接回怼。`;
        } else {
            if (type === 'synthesis') {
                 const agentAObj = await findAgent(agentA);
                 const agentBObj = await findAgent(agentB);
                 prompt = `融合 ${agentAObj?.name} 和 ${agentBObj?.name} 的观点。\n${personaLine}\n【要求】：请用100字以内总结两个 Agent 的观点，只输出结论，不要分析过程。严禁星号。`;
            } else if (type === 'deep_dive') {
                 prompt = `${targetAgent.system_prompt}\n${personaLine}\n用户付费深挖。\n要求：给出执行步骤，字数200字内，严禁星号。`;
            } else {
                 prompt = `${targetAgent.system_prompt}\n${personaLine}\n用户付费加大火力。\n要求：犀利指出弱点，字数100字内，严禁星号。`;
            }
        }
        
        try {
          const reply = await Promise.race([
            callMiniMax(prompt, "请输出。", targetAgent.name || "Agent"),
            new Promise<string>((resolve) =>
              setTimeout(
                () =>
                  resolve(
                    "由于算力波动，两位顾问达成默契：建议您综合考虑成本与风险，先小规模试错。"
                  ),
                8000
              )
            ),
          ]);
          if (
            reply.includes("网络超时") ||
            reply.includes("思考中断") ||
            reply.includes("配置错误")
          ) {
            if (type === "synthesis") {
              return NextResponse.json(
                "由于算力波动，两位顾问达成默契：建议您综合考虑成本与风险，先小规模试错。"
              );
            }
          }
          return NextResponse.json(reply);
        } catch (error) {
          if (type === "synthesis") {
            return NextResponse.json(
              "由于算力波动，两位顾问达成默契：建议您综合考虑成本与风险，先小规模试错。"
            );
          }
          return NextResponse.json("[AI 暂时不可用]");
        }
    }

    return NextResponse.json({ error: 'Unknown action' });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}