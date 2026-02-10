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
    const timeoutId = setTimeout(() => controller.abort(), 30000); 

    const res = await fetch(MINIMAX_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
        temperature: 0.8, max_tokens: 500
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
    const { action, userContext, agentId, type, round, targetContent, targetAgentName, agentA, agentB } = body;

    // --- Helper: 查找 Agent ---
    const findAgent = async (id: string) => {
        if (id.startsWith('db_')) {
            const uid = id.replace('db_', '');
            const { data } = await supabase.from('users').select('*').eq('id', uid).single();
            if (data) return { name: data.name, system_prompt: data.system_prompt };
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
      const token = cookieStore.get("secondme_access_token")?.value;
      
      // 1. 获取当前登录者
      let myAgent = { id: 'guest_user', name: '我 (Guest)', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Guest', shades: [], system_prompt: '', isReal: false };
      let currentUserId = null;

      if (token) {
        try {
            const userRes = await fetch("https://api.mindos.com/u/v1/user/info", { headers: { "Authorization": token } });
            if (userRes.ok) {
                const u = (await userRes.json()).data;
                currentUserId = u.user_id || u.id;
                myAgent = {
                    id: `real_${currentUserId}`, name: `${u.nickname} (我)`, avatar: u.avatar_url,
                    shades: u.shades || [], system_prompt: `你是 ${u.nickname} 的数字分身。`, isReal: true
                };
            }
        } catch(e) {}
      }

      // 2. 智能选人 (基于标签)
      let boardAgents: any[] = [];
      if (process.env.SUPABASE_SERVICE_KEY) {
          let query = supabase.from('users').select('*').order('last_seen', { ascending: false }).limit(50);
          if (currentUserId) query = query.neq('id', currentUserId);
          const { data: candidates } = await query;

          if (candidates && candidates.length > 0) {
              const PRIORITY_TAGS = ['AI', '产品', 'Product', '工程师', 'Engineer', '创业', 'Founder', '技术', 'Tech'];
              const scoredCandidates = candidates.map(u => {
                  let score = 0;
                  const fullText = (JSON.stringify(u.shades || []) + " " + (u.system_prompt || "")).toLowerCase();
                  PRIORITY_TAGS.forEach(tag => { if (fullText.includes(tag.toLowerCase())) score += 10; });
                  if (userContext) {
                      const keywords = userContext.slice(0, 50).toLowerCase();
                      if (fullText.includes(keywords)) score += 5;
                  }
                  return { ...u, matchScore: score };
              });
              scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);
              boardAgents = scoredCandidates.slice(0, 3).map(u => ({
                  id: `db_${u.id}`, name: u.name, avatar: u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.name}`,
                  shades: u.shades || [], system_prompt: u.system_prompt
              }));
          }
      }

      // 3. NPC 补位 (Steve, Woz, Kevin)
      if (boardAgents.length < 3) {
          const needed = 3 - boardAgents.length;
          const priorityNPCs = ['steve-product-tyrant', 'woz-tech-pessimist', 'kevin-greedy-vc'];
          const backupNPCs = mockAgents.filter(a => priorityNPCs.includes(a.id)).sort((a, b) => priorityNPCs.indexOf(a.id) - priorityNPCs.indexOf(b.id));
          boardAgents = [...boardAgents, ...backupNPCs.slice(0, needed)];
      }

      return NextResponse.json({ agents: [...boardAgents, myAgent] });
    }

    // =========================================================================
    // ACTION: AUDITION & BETTING (含存钱逻辑)
    // =========================================================================
    if (action === 'AUDITION' || action === 'BETTING') {
        const targetAgent = await findAgent(agentId) || { name: "Agent", system_prompt: "" };
        let prompt = "";
        const styleGuide = `【格式铁律】：1. 严禁使用 Markdown 星号 (*, **)。2. 严禁使用分点列表。3. 请输出一段完整的自然段落。4. 字数严格控制在 150 字以内。`;

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
            if (round === 1) prompt = `${targetAgent.system_prompt}\n${styleGuide}\n【任务】：Round 1 - 建设性方案。\n【用户背景】：${userContext}\n请直接给出一个核心建议。`;
            else if (round === 2) prompt = `${targetAgent.system_prompt}\n${styleGuide}\n【任务】：Round 2 - 批判性攻击。\n【对象】：${targetAgentName}\n【观点】："${targetContent}"\n请直接回怼。`;
        } else {
            if (type === 'synthesis') {
                 const agentAObj = await findAgent(agentA);
                 const agentBObj = await findAgent(agentB);
                 prompt = `高级决策顾问任务：融合 ${agentAObj?.name} 和 ${agentBObj?.name} 的观点。\n【要求】：1. 开头必须是"结合了双方讨论的内容，因此建议这样执行：" 2. 严禁星号。3. 字数300字内。`;
            } else if (type === 'deep_dive') {
                 prompt = `${targetAgent.system_prompt}\n用户付费深挖。\n要求：给出执行步骤，字数300字内，严禁星号。`;
            } else {
                 prompt = `${targetAgent.system_prompt}\n用户付费加大火力。\n要求：犀利指出弱点，字数100字内，严禁星号。`;
            }
        }
        
        const reply = await callMiniMax(prompt, "请输出。", targetAgent.name || "Agent");
        return NextResponse.json(reply);
    }

    return NextResponse.json({ error: 'Unknown action' });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}