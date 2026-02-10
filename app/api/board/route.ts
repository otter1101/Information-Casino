import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { mockAgents } from '@/lib/mock-agents';

// 配置 MiniMax
const MINIMAX_API_URL = "https://api.minimax.chat/v1/chat/completions";
const MINIMAX_MODEL = "abab5.5-chat"; 

async function callMiniMax(systemPrompt: string, userContent: string, agentName: string) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey || !apiKey.startsWith("sk-")) return "[配置错误] Key 无效";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); 

    const res = await fetch(MINIMAX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        temperature: 0.8, // 保持高温度，让说话更像人
        max_tokens: 500, 
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await res.json();
    if (!res.ok || data.error) {
      console.error(`❌ MiniMax Error [${agentName}]:`, JSON.stringify(data));
      return `(AI 思考中断...)`;
    }
    return data.choices?.[0]?.message?.content || "[无回复]";
  } catch (error) {
    console.error(`❌ Network Error [${agentName}]:`, error);
    return "[网络超时]";
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, userContext, agentId, type, round, targetContent, targetAgentName, agentA, agentB } = body;

    // --- MATCH ---
    if (action === 'MATCH') {
      const cookieStore = await cookies();
      const token = cookieStore.get("secondme_access_token")?.value;
      
      let realUserAgent = {
        id: 'guest_user',
        name: '我 (Guest)',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Guest',
        shades: ['Observer'],
        system_prompt: '你是一个冷静的旁观者。',
        isReal: false
      };

      if (token) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const userRes = await fetch("https://api.mindos.com/u/v1/user/info", {
            headers: { "Authorization": token },
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (userRes.ok) {
            const userData = await userRes.json();
            const info = userData.data; 
            realUserAgent = {
              id: `real_user_${info.user_id || 'me'}`,
              name: `${info.nickname || '我'} (真人)`,
              avatar: info.avatar_url || "https://api.dicebear.com/7.x/avataaars/svg?seed=Me",
              shades: info.shades || ["Owner"],
              system_prompt: `你是用户 ${info.nickname} 的数字分身。你的利益与用户绑定。`,
              isReal: true
            };
          }
        } catch (e) { console.log("Guest mode fallback"); }
      }

      let eliteNPCs = mockAgents.filter(a => 
        ['steve-product-tyrant', 'kevin-greedy-vc', 'woz-tech-pessimist'].includes(a.id)
      );
      if (eliteNPCs.length < 3) eliteNPCs = mockAgents.slice(0, 3);

      return NextResponse.json({ agents: [...eliteNPCs, realUserAgent] });
    }

    // --- AUDITION ---
    if (action === 'AUDITION') {
      const agent = mockAgents.find(a => a.id === agentId) || 
                    (agentId.startsWith('real') || agentId === 'guest_user' ? { name: "我的分身", system_prompt: "你是用户的利益捍卫者。" } : null);
      if (!agent) return NextResponse.json({ error: "Agent missing" });

      let prompt = "";
      // 通用风格约束：去星号，去列表，纯文本
      const styleGuide = `
      【格式铁律】：
      1. 严禁使用 Markdown 星号 (*, **)。
      2. 严禁使用分点列表 (1. 2. 3.)。
      3. 请输出一段完整的、自然的对话段落，像真人在群里发言一样。
      4. 字数严格控制在 150 字以内。
      `;

      if (round === 1) {
        prompt = `
        ${agent.system_prompt}
        ${styleGuide}
        【任务】：Round 1 - 建设性方案。
        【用户背景】：${userContext}
        请直接给出一个最核心的、具体的建议。不要寒暄，直奔主题。
        `;
      } else if (round === 2) {
        prompt = `
        ${agent.system_prompt}
        ${styleGuide}
        【任务】：Round 2 - 批判性攻击。
        【攻击对象】：${targetAgentName}
        【对方观点】："${targetContent}"
        
        请直接回怼上面的观点。指出为什么它是错的。语言要犀利，不要客气。
        `;
      }
      const reply = await callMiniMax(prompt, "请输出。", agent.name);
      return new NextResponse(reply);
    }

    // --- BETTING ---
    if (action === 'BETTING') {
      
      // 1. SYNTHESIS (合作 - 30币)
      if (type === 'synthesis') {
         const pA = mockAgents.find(a => a.id === agentA)?.system_prompt || "专家A";
         const pB = mockAgents.find(a => a.id === agentB)?.system_prompt || "专家B";
         
         const prompt = `
         你是一个高级决策顾问。请融合以下两个视角的智慧：
         视角A：${pA}
         视角B：${pB}
         【用户背景】：${userContext}
         
         【严格要求】：
         1. 开头第一句话必须是："结合了双方讨论的内容，因此建议这样执行："
         2. 综合两者的优点，给出一份执行方案。
         3. 严禁使用 Markdown 星号。
         4. 字数控制在 300 字以内。
         `;
         const reply = await callMiniMax(prompt, "开始融合。", "Synthesizer");
         return new NextResponse(reply);
      }

      // 2. 单人动作
      const agent = mockAgents.find(a => a.id === agentId) || { name: "Agent", system_prompt: "" };
      let prompt = "";
      
      if (type === 'deep_dive') { 
        prompt = `${agent.system_prompt}\n用户付费深挖。请给出具体的执行步骤。原始背景：${userContext}\n要求：字数300字以内。可以分段，但严禁使用Markdown星号。`;
      } else if (type === 'critique') { 
        prompt = `${agent.system_prompt}\n用户付费要求加大火力。请用最刻薄的语言指出用户最大的弱点。原始背景：${userContext}\n要求：字数100字以内，严禁使用Markdown星号，直接输出一段话。`;
      }
      
      const reply = await callMiniMax(prompt, "请输出高价值内容。", agent.name);
      return new NextResponse(reply);
    }

    return NextResponse.json({ error: 'Unknown action' });
  } catch (error) {
    console.error("Server Error:", error);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}