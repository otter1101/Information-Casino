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

    // --- Helper: Find Agent ---
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
      
      // 1. 获取当前登录者 (我)
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

      // 2. 🚀 智能选人逻辑
      let boardAgents: any[] = [];
      
      if (process.env.SUPABASE_SERVICE_KEY) {
          // A. 海选：先拉取最近活跃的 50 个真人 (保证是活人)
          let query = supabase.from('users').select('*').order('last_seen', { ascending: false }).limit(50);
          if (currentUserId) query = query.neq('id', currentUserId);
          
          const { data: candidates } = await query;

          if (candidates && candidates.length > 0) {
              // B. 定义高优标签 (你要求的核心职业)
              // 只要标签里包含这些字眼，权重就极高
              const PRIORITY_TAGS = ['AI', '产品', 'Product', '工程师', 'Engineer', '创业', 'Founder', '技术', 'Tech'];
              
              // C. 评分系统
              const scoredCandidates = candidates.map(u => {
                  let score = 0;
                  // 此时 u.shades 是 JSON 对象或数组
                  // 我们尝试转成字符串来匹配
                  const shadesStr = JSON.stringify(u.shades || []).toLowerCase();
                  const promptStr = (u.system_prompt || "").toLowerCase();
                  const fullText = shadesStr + " " + promptStr;

                  // 规则1：命中高优标签 (+10分/个)
                  PRIORITY_TAGS.forEach(tag => {
                      if (fullText.includes(tag.toLowerCase())) score += 10;
                  });

                  // 规则2：上下文相关性 (简单匹配用户输入的内容) (+5分)
                  // 比如用户搜"求职"，如果 Agent 标签里有 "求职" 或 "招聘"，加分
                  if (userContext) {
                      const contextKeywords = userContext.slice(0, 50).toLowerCase(); // 取前50字作为关键词源
                      if (fullText.includes(contextKeywords)) score += 5;
                  }

                  return { ...u, matchScore: score };
              });

              // D. 排序：分数高者在前，分数相同按时间
              scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);

              // E. 选取前 3 名
              const topPicks = scoredCandidates.slice(0, 3);

              boardAgents = topPicks.map(u => ({
                  id: `db_${u.id}`,
                  name: u.name,
                  avatar: u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.name}`,
                  shades: u.shades || [],
                  system_prompt: u.system_prompt,
                  // 在名字后面加个标签展示，显摆一下匹配度 (可选)
                  // name: `${u.name} ${u.matchScore > 0 ? '⭐' : ''}` 
              }));
          }
      }

      // 3. 补位逻辑 (如果还没凑够 3 人，用精英 NPC 补)
      // NPC 也要选符合你要求的：Kevin(VC/创业), Steve(产品), Woz(技术) 正好完美对应你的需求！
      if (boardAgents.length < 3) {
          const needed = 3 - boardAgents.length;
          // 优先顺序: Steve(产品) -> Woz(技术) -> Kevin(创业/VC)
          const priorityNPCs = [
              'steve-product-tyrant', // 对应 AI产品
              'woz-tech-pessimist',   // 对应 工程师
              'kevin-greedy-vc'       // 对应 创业者
          ];
          
          const backupNPCs = mockAgents.filter(a => priorityNPCs.includes(a.id));
          // 按 priorityNPCs 的顺序排序 backupNPCs
          const sortedBackups = backupNPCs.sort((a, b) => priorityNPCs.indexOf(a.id) - priorityNPCs.indexOf(b.id));
          
          // 过滤掉已经在 board 里的
          const remainingNPCs = sortedBackups.slice(0, needed);
          boardAgents = [...boardAgents, ...remainingNPCs];
      }

      return NextResponse.json({ agents: [...boardAgents, myAgent] });
    }

    // --- AUDITION & BETTING (保持之前的修复版：字数控制+去星号) ---
    if (action === 'AUDITION' || action === 'BETTING') {
        const targetAgent = await findAgent(agentId) || { name: "Agent", system_prompt: "" };
        let prompt = "";
        const styleGuide = `【格式铁律】：1. 严禁使用 Markdown 星号 (*, **)。2. 严禁使用分点列表。3. 请输出一段完整的自然段落。4. 字数严格控制在 150 字以内。`;

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