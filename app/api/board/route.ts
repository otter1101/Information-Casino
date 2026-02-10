import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { mockAgents } from '@/lib/mock-agents';

// 配置 MiniMax
const MINIMAX_API_URL = "https://api.minimax.chat/v1/chat/completions";
const MINIMAX_MODEL = "abab5.5-chat"; 

// 辅助函数：调用 MiniMax (带超时控制)
async function callMiniMax(systemPrompt: string, userContent: string, agentName: string) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey || !apiKey.startsWith("sk-")) {
    return "[系统配置错误]: 请检查 .env.local 中的 API Key";
  }

  try {
    const controller = new AbortController();
    // 缩短到 10s 超时
    const timeoutId = setTimeout(() => controller.abort(), 10000); 

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
        temperature: 0.7,
        max_tokens: 300,
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await res.json();
    if (!res.ok || data.error) {
      console.error(`❌ MiniMax 报错 [${agentName}]:`, JSON.stringify(data));
      return `(API 繁忙...) [${data.error?.message || "Error"}]`;
    }
    return data.choices?.[0]?.message?.content || "[无有效回复]";

  } catch (error) {
    console.error(`❌ MiniMax 网络异常 [${agentName}]:`, error);
    return "[网络超时] AI 服务响应过慢，请重试";
  }
}

// 核心 API
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, userContext, agentId, type } = body;

    // ACTION: MATCH (组局)
    if (action === 'MATCH') {
      const cookieStore = await cookies();
      const token = cookieStore.get("secondme_access_token")?.value;
      
      let realUserAgent = null;

      // 尝试拉取真人信息
      if (token) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000); // 2秒如果不返回就跳过
          
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
              shades: info.shades || ["Owner", "Real User"],
              system_prompt: `你是用户 ${info.nickname} 的数字分身。你的标签是：${(info.shades || []).join(', ')}。请代表你的主人发言。`,
              isReal: true
            };
          }
        } catch (e) {
          console.error("⚠️ 拉取真人信息超时/失败:", e);
        }
      }

      // --- 关键修复：确保数组里绝对没有 undefined ---
      
      // 1. 先拿前3个精英 NPC (Steve, Kevin, Woz)
      // 使用 .slice 即使数组不够长也不会报错，只会返回少一点
      const eliteNPCs = mockAgents.slice(0, 3); 

      // 2. 准备第 4 位 (真人 或 影子替补)
      const slot4 = realUserAgent || {
        id: 'shadow_user',
        name: '神秘访客',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Shadow',
        shades: ['Observer'],
        system_prompt: '你是一个神秘的观察者，观点中立但犀利。'
      };

      // 3. 准备第 5 位 (数据狂魔 Leo 的硬编码备份，防止 mockAgents 里没有他)
      const slot5 = {
        id: 'leo_backup',
        name: 'Leo(数据狂魔)',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Leo',
        shades: ['Analytics', 'Logic'],
        system_prompt: '你是数据分析师，只相信数据，喜欢泼冷水。'
      };

      // 组装最终列表，过滤掉任何可能的空值
      const finalBoard = [...eliteNPCs, slot4, slot5].filter(Boolean);

      return NextResponse.json({ agents: finalBoard });
    }

    // ACTION: AUDITION & BETTING
    if (action === 'AUDITION' || action === 'BETTING') {
      if (!agentId) return NextResponse.json({ error: "Agent ID missing" }, { status: 400 });

      let systemPrompt = "";
      let agentName = "Agent";

      if (agentId.startsWith("real_user")) {
        agentName = "我的分身";
        systemPrompt = "你是当前用户的数字分身。请基于一个理性、务实的视角，对用户的方案进行点评。不要客套，直接输出核心价值点。";
      } else {
        const agent = mockAgents.find(a => a.id === agentId);
        // 如果在 mock 里找不到，就给一个默认设定 (兜底)
        if (agent) {
          agentName = agent.name;
          systemPrompt = agent.system_prompt;
        } else {
          agentName = "Guest Agent";
          systemPrompt = "你是一个商业顾问，请给出犀利的点评，字数100字以内。";
        }
      }

      let finalPrompt = "";
      if (action === 'AUDITION') {
        finalPrompt = `你正在参与商业互评。严禁复述问题。直接输出观点(100字内)。\n你的设定：${systemPrompt}`;
      } else if (action === 'BETTING') {
         finalPrompt = `用户付费要求深挖/点评。请用最专业的角度分析。你的设定：${systemPrompt}`;
      }

      const reply = await callMiniMax(finalPrompt, userContext || "开始分析", agentName);
      return new NextResponse(reply);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  } catch (error) {
    console.error("Server Error:", error);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}