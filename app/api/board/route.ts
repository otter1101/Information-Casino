import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { mockAgents } from "@/lib/mock-agents";
import { supabase } from "@/lib/supabase";

export const runtime = "edge";

const MINIMAX_API_URL = "https://api.minimax.chat/v1/chat/completions";
const MINIMAX_MODEL = "abab5.5-chat";
const STREAM_TIMEOUT_MS = 8500;

type BoardAction = "MATCH" | "AUDITION" | "BETTING";
type BettingType = "critique" | "deep_dive" | "synthesis";

type AgentProfile = {
  name: string;
  isNPC: boolean;
  context: string;
  shades: any[];
};

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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

const getFirstShadeName = (shades: any[] = []) => {
  const first = shades[0];
  if (!first) return "技术";
  return first.shadeName || first.shadeNamePublic || first.name || "技术";
};

const buildTimeoutFallback = (agent: AgentProfile) => {
  const firstShadeName = getFirstShadeName(agent.shades || []);
  if (agent.isNPC) {
    return "（系统繁忙）简而言之，哪怕从风控角度看，这个方案的风险/收益比也需要重新计算。";
  }
  return `（网络波动）从${firstShadeName}底层逻辑看，这个方案的扩展性还需要再测算一下。`;
};

const buildOpponentAnchor = (targetName: string) =>
  `注意：你的对话对象是名为【${targetName}】的真人。即使名字像动物或物品，也请将其视为人类产品经理或创业者。严禁对其名字进行字面意义上的调侃，必须针对其【商业逻辑】进行博弈。`;

const shouldIgnoreHistory = (content?: string) =>
  !!content &&
  (content.includes("网络波动") ||
    content.includes("系统繁忙") ||
    content.includes("[ERROR]") ||
    content.includes("模型繁忙"));

const callMiniMaxStream = async (systemPrompt: string, userContent: string) => {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey || !apiKey.startsWith("sk-")) {
    throw new Error("missing_key");
  }

  return fetch(MINIMAX_API_URL, {
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
      stream: true,
    }),
  });
};

const streamFromMiniMax = async (
  systemPrompt: string,
  userContent: string,
  fallback: string
) => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let aborted = false;
      const timeoutId = setTimeout(() => {
        aborted = true;
        controller.enqueue(encoder.encode(fallback));
        controller.close();
      }, STREAM_TIMEOUT_MS);

      try {
        const res = await callMiniMaxStream(systemPrompt, userContent);
        if (!res.ok || !res.body) {
          clearTimeout(timeoutId);
          controller.enqueue(encoder.encode("[ERROR] stream_failed"));
          controller.close();
          return;
        }

        const reader = res.body.getReader();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (aborted || done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.replace("data:", "").trim();
            if (payload === "[DONE]") {
              clearTimeout(timeoutId);
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(payload);
              const text =
                json.choices?.[0]?.delta?.content ||
                json.choices?.[0]?.message?.content ||
                json.text ||
                "";
              if (text) controller.enqueue(encoder.encode(text));
            } catch {
              continue;
            }
          }
        }

        clearTimeout(timeoutId);
        controller.close();
      } catch {
        clearTimeout(timeoutId);
        controller.enqueue(encoder.encode("[ERROR] stream_exception"));
        controller.close();
      }
    },
  });
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

    const getAgentById = async (rawId: string): Promise<AgentProfile> => {
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
        .select("*")
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

      return {
        name: "匿名专家",
        isNPC: false,
        context: buildPersonaPrompt("匿名专家", []),
        shades: [],
      };
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
      const targetAgent = await getAgentById(agentId);
      const shadesForPersona =
        userShades && userShades.length > 0 ? userShades : targetAgent.shades || [];
      const personaPrompt = buildPersonaPrompt(safeDecode(userName), shadesForPersona);

      const opponentName = targetAgentName || "水濑";
      const opponentAnchor = buildOpponentAnchor(opponentName);
      const systemPromptBase = targetAgent.isNPC
        ? `${targetAgent.context}\n${opponentAnchor}`
        : `${personaPrompt}\n${opponentAnchor}`;

      const ignoreHistory = shouldIgnoreHistory(targetContent);
      const cleanTargetContent = ignoreHistory ? "" : targetContent || "";
      const cleanTargetName = targetAgentName || "对手";

      let prompt = systemPromptBase;
      if (action === "AUDITION") {
        if (round === 1) {
          prompt = `${systemPromptBase}\n【任务】：Round 1 - 建设性方案。\n【用户背景】：${userContext}\n请直接给出一个核心建议。`;
        } else if (round === 2) {
          const historyNote = ignoreHistory
            ? "前序内容疑似兜底话术，忽略前序，直接针对用户目标独立评论。"
            : "";
          prompt = `${systemPromptBase}\n${historyNote}\n【任务】：Round 2 - 批判性攻击。\n【对象】：${cleanTargetName}\n【观点】："${cleanTargetContent}"\n请直接回怼。`;
        }
      } else if (type === "synthesis") {
        const [agentAProfile, agentBProfile] = await Promise.all([
          getAgentById(agentA || ""),
          getAgentById(agentB || ""),
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

      const stream = await streamFromMiniMax(
        prompt,
        "请直接输出观点。",
        fallbackResponse
      );

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    return NextResponse.json({ error: "Unknown action" });
  } catch (error) {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}