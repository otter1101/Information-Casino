import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { mockAgents } from "@/lib/mock-agents";
import { supabase } from "@/lib/supabase";

const MINIMAX_API_URL = "https://api.minimax.chat/v1/chat/completions";
const MINIMAX_MODEL = "abab5.5-chat";

type BoardAction = "MATCH" | "AUDITION" | "BETTING";
type BettingType = "critique" | "deep_dive" | "synthesis";

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const buildRichContext = (shades: any[]) => {
  if (!shades || shades.length === 0) return "暂无详细记忆，请基于常识发挥。";
  return shades
    .map(
      (s, index) => `
【记忆碎片 ${index + 1}: ${s.shadeName || s.shadeNamePublic || "未知"}】
- **置信度**: ${s.confidenceLevel || "MEDIUM"}
- **核心知识(Content)**: ${s.shadeContent || s.shadeContentPublic || "暂无"}
- **自我描述**: ${s.shadeDescription || s.shadeDescriptionPublic || "暂无"}
- **他人视角**: ${s.shadeDescriptionThirdView || "暂无"}
- **来源话题**: ${Array.isArray(s.sourceTopics) ? s.sourceTopics.join(", ") : ""}
`
    )
    .join("\n----------------\n");
};

const buildPersonaPrompt = (name: string, shades: any[]) => {
  if (shades && shades.length > 0) {
    const richContext = buildRichContext(shades);
    return `
你就是真人用户【${name}】。你的认知边界严格受限于以下记忆：
${richContext}
请显性地引用这些记忆发言（如“我之前研究过...”）。
`.trim();
  }

  return `
你代表真人用户【${name}】。虽然暂时没有上传详细画像，但你需扮演一位直觉敏锐的行业观察者。
铁律：绝对禁止说"我没有数据"或"作为AI"。基于互联网常识进行逻辑推演，语气要像个"老鸟"（使用"依我看"、"从落地角度说"）。
观点要犀利，不要模棱两可。
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

const callMiniMax = async (systemPrompt: string, userContent: string) => {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey || !apiKey.startsWith("sk-")) return "[配置错误] Key 无效";

  const res = await fetch(MINIMAX_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.7,
      max_tokens: 240,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) return "[模型繁忙]";
  return data.choices?.[0]?.message?.content || "[无回复]";
};

const runWithTimeout = async (params: {
  systemPrompt: string;
  userContent: string;
  fallback: string;
}) => {
  const startTime = Date.now();
  const llmPromise = callMiniMax(params.systemPrompt, params.userContent);
  const timeoutPromise = new Promise<string>((resolve) =>
    setTimeout(() => resolve(params.fallback), 9000)
  );
  const finalContent = await Promise.race([llmPromise, timeoutPromise]);
  console.log("LLM Response Time:", Date.now() - startTime);
  return finalContent;
};

const getFirstShadeName = (shades: any[] = []) => {
  const first = shades[0];
  if (!first) return "通用";
  return first.shadeName || first.shadeNamePublic || first.name || "通用";
};

const buildTimeoutFallback = (agent: any) => {
  const firstShadeName = getFirstShadeName(agent?.shades || []);
  if (agent?.isNPC) {
    return "（系统繁忙）简而言之，哪怕从风控角度看，这个方案的风险/收益比也需要重新计算。";
  }
  return `（基于【${firstShadeName}】的直觉）... 我觉得从我的经验来看，这个方向还需要再斟酌一下，特别是落地细节方面。`;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action: BoardAction;
      userContext?: string;
      agentId?: string;
      type?: BettingType;
      round?: number;
      targetContent?: string;
      targetAgentName?: string;
      agentA?: string;
      agentB?: string;
      userName?: string;
      userShades?: any[];
    };

    const {
      action,
      userContext = "",
      agentId = "",
      type,
      round,
      targetContent,
      targetAgentName,
      agentA,
      agentB,
      userName = "用户",
      userShades = [],
    } = body;

    const getAgentProfile = async (rawId: string) => {
      const mockAgent = mockAgents.find((a) => a.id === rawId);
      if (mockAgent) {
        return {
          name: mockAgent.name,
          isNPC: true,
          context: mockAgent.system_prompt,
          shades: mockAgent.shades || [],
        };
      }

      const normalizedId = rawId.startsWith("db_")
        ? rawId.replace("db_", "")
        : rawId.startsWith("real_")
        ? rawId.replace("real_", "")
        : rawId;

      const { data: user } = await supabase
        .from("users")
        .select("name, shades, avatar")
        .eq("id", normalizedId)
        .single();

      if (user) {
        return {
          name: user.name,
          isNPC: false,
          context: buildPersonaPrompt(safeDecode(user.name || "用户"), user.shades || []),
          shades: user.shades || [],
        };
      }

      throw new Error(`Agent ${rawId} not found`);
    };

    if (action === "MATCH") {
      const cookieStore = await cookies();
      const currentUserId = cookieStore.get("sm_user_id")?.value;

      let realCandidates: any[] = [];
      if (process.env.SUPABASE_SERVICE_KEY) {
        let query = supabase.from("users").select("*");
        if (currentUserId) query = query.neq("id", currentUserId);
        const { data } = await query;
        realCandidates = data || [];
      }

      const sampledReals = sample(realCandidates, 2).map((u) => ({
        id: `db_${u.id}`,
        name: u.name,
        avatar: u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.name}`,
        shades: u.shades || [],
        system_prompt: buildPersonaPrompt(safeDecode(u.name || "用户"), u.shades || []),
        isRealUser: true,
      }));

      const randomNpc = sample(mockAgents, 1).map((npc) => ({ ...npc, isNPC: true }));
      let boardAgents = [...sampledReals, ...randomNpc];

      if (boardAgents.length < 3) {
        const needed = 3 - boardAgents.length;
        const fallback = sample(mockAgents, needed).map((npc) => ({ ...npc, isNPC: true }));
        boardAgents = [...boardAgents, ...fallback];
      }

      return NextResponse.json({ agents: boardAgents });
    }

    if (action === "AUDITION" || action === "BETTING") {
      console.log("Fetching User Shades for:", agentId);
      const targetAgent = await getAgentProfile(agentId);

      const shadesForPersona =
        userShades && userShades.length > 0 ? userShades : targetAgent.shades || [];
      const personaPrompt = buildPersonaPrompt(safeDecode(userName), shadesForPersona);

      const opponentName =
        targetAgentName || (type === "synthesis" ? "对手" : "对手");

      const npcOpponentGuard = `
你的对手名为【${opponentName}】。注意：这只是一个真人的昵称。即使名字包含动物、植物或物品，你也要把他/她视为一位人类创业者。严禁针对名字的字面含义进行生物学批判，必须针对其商业观点反驳。
`.trim();

      const systemPromptBase = targetAgent.isNPC
        ? `${targetAgent.context}\n${npcOpponentGuard}`
        : personaPrompt;

      let prompt = systemPromptBase;
      if (action === "AUDITION") {
        if (round === 1) {
          prompt = `${systemPromptBase}\n【任务】：Round 1 - 建设性方案。\n【用户背景】：${userContext}\n请直接给出一个核心建议。`;
        } else if (round === 2) {
          prompt = `${systemPromptBase}\n【任务】：Round 2 - 批判性攻击。\n【对象】：${targetAgentName}\n【观点】："${targetContent}"\n请直接回怼。`;
        }
      } else if (type === "synthesis") {
        const [agentAProfile, agentBProfile] = await Promise.all([
          getAgentProfile(agentA || ""),
          getAgentProfile(agentB || ""),
        ]);
        prompt = `${systemPromptBase}\n融合 ${agentAProfile.name} 和 ${agentBProfile.name} 的观点。请用100字以内总结两个 Agent 的观点，只输出结论，不要分析过程。`;
      } else if (type === "deep_dive") {
        prompt = `${systemPromptBase}\n用户付费深挖。请给出执行步骤，120字以内。`;
      } else {
        prompt = `${systemPromptBase}\n用户付费加大火力。请犀利指出弱点，100字以内。`;
      }

      const richContext = buildRichContext(shadesForPersona);
      console.log("Rich Context Length:", richContext.length);

      const fallbackResponse = buildTimeoutFallback({
        ...targetAgent,
        shades: shadesForPersona,
      });

      const finalContent = await runWithTimeout({
        systemPrompt: prompt,
        userContent: "请直接输出观点。",
        fallback: fallbackResponse,
      });

      return NextResponse.json(finalContent);
    }

    return NextResponse.json({ error: "Unknown action" });
  } catch (error) {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}