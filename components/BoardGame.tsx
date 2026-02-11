"use client";

import { useState, useEffect, useRef } from "react";
import { type MockAgent } from "@/lib/mock-agents";
import { supabase } from "@/lib/supabase"; 

type Message = {
  agentId: string;
  agentName: string;
  content: string;
  round: 1 | 2;
  extraContent?: string; 
  extraType?: 'critique' | 'deep_dive';
};

type BetForm = { target: string; assets: string; risks: string; };

type UserProfile = {
  id: string;
  name: string;
  avatar: string;
  shades: string[];
};

export default function BoardGame() {
  // --- 状态管理 ---
  const [form, setForm] = useState<BetForm>({ target: "", assets: "", risks: "" });
  const [gameStarted, setGameStarted] = useState(false);
  const [agents, setAgents] = useState<MockAgent[]>([]);
  const [msgMap, setMsgMap] = useState<Record<string, Message[]>>({}); 
  const [phase, setPhase] = useState<"audition" | "betting">("audition");
  const [userChips, setUserChips] = useState(100);
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<{type: string, id: string} | null>(null);
  const [deepDiveContent, setDeepDiveContent] = useState<{title: string, content: string} | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [totalUsers, setTotalUsers] = useState(0);
  const [leaderboardData, setLeaderboardData] = useState<any[]>([]); 
  const [paidInsightsMap, setPaidInsightsMap] = useState<Record<string, string>>({});
  const [selectedForSynthesis, setSelectedForSynthesis] = useState<string[]>([]);
  const [synthesisResult, setSynthesisResult] = useState<string | null>(null);
  
  // ✅ 新增：用户信息状态 (名字和头像)
  const [userInfo, setUserInfo] = useState<{name: string, avatar: string} | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const readCookie = (name: string) => {
    if (typeof document === "undefined") return "";
    const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
    return match ? decodeURIComponent(match[2]) : "";
  };

  const safeDecode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const renderIdentityTag = (agent: any) => {
    if (agent?.isRealUser) {
      return (
        <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400 border border-amber-500/40">
          [AI 分身]
        </span>
      );
    }
    if (agent?.isNPC) {
      return (
        <span className="ml-2 rounded-full bg-neutral-700/40 px-2 py-0.5 text-[10px] text-neutral-400 border border-neutral-700">
          [NPC]
        </span>
      );
    }
    return null;
  };
  
  // --- 1. 核心登录逻辑 (OAuth) ---
  const handleLogin = () => {
    const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
    if (!clientId) {
        alert("请检查环境变量 NEXT_PUBLIC_CLIENT_ID 是否配置！");
        return;
    }
    const origin = window.location.origin;
    const redirectUri = `${origin}/api/auth/callback`;
    const state = Math.random().toString(36).substring(7);
    
    // 构造跳转链接 (必须包含 user.info.shades)
    const scope = "user.info user.info.shades chat"; 
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        state: state,
        scope: scope
    });

    window.location.href = `https://go.second.me/oauth/?${params.toString()}`;
  };

  // --- 2. 初始化检查 (读取 Cookie + 恢复状态) ---
  useEffect(() => {
     // ✅ 核心修改：从 Cookie 读取后端写入的用户信息
     const name = readCookie("sm_name");
     const avatar = readCookie("sm_avatar");
     const userId = readCookie("sm_user_id");
     
     // 如果 Cookie 里有头像，直接设置状态 -> 界面就会显示头像！
     if (name && avatar) {
         setUserInfo({ name, avatar });
     }
     if (userId) {
         setUserProfile(prev => ({
           id: userId,
           name: name || prev?.name || "",
           avatar: avatar || prev?.avatar || "",
           shades: prev?.shades || []
         }));
     }

     const fetchWealth = async () => {
        const query = supabase
          .from("users")
          .select("wealth, shades, name, avatar, id");
        const { data, error } = userId
          ? await query.eq("id", userId).single()
          : await query.eq("name", name || "").single();
        if (!error && data) {
          if (typeof data.wealth === "number") setUserChips(data.wealth);
          setUserProfile({
            id: (data.id as string) || userId || "",
            name: (data.name as string) || name || "",
            avatar: (data.avatar as string) || avatar || "",
            shades: (data.shades as string[]) || []
          });
          if (data.name && data.avatar) {
            setUserInfo({ name: data.name as string, avatar: data.avatar as string });
          }
        } else {
          setUserChips(100);
        }
     };

     if (name) {
        fetchWealth().catch(() => {});
     }

     const fetchCount = async () => {
        const { count } = await supabase
          .from("users")
          .select("*", { count: "exact", head: true });

        if (count !== null) {
          setTotalUsers(count);
        }
     };

     fetchCount().catch(() => {});
     
     // 恢复游戏进度
     const saved = localStorage.getItem("casino_v11");
     if (saved) {
      try {
        const data = JSON.parse(saved);
        setForm(data.form || { target: "", assets: "", risks: "" });
        setGameStarted(data.gameStarted);
        setAgents(data.agents || []);
        setMsgMap(data.msgMap || {});
        setUserChips(data.userChips || 100); 
        setSynthesisResult(data.synthesisResult || null);
        setPaidInsightsMap(data.paidInsightsMap || {});
        // 如果 localStorage 里有旧的 userInfo 也恢复一下
        if (data.userInfo) setUserInfo(data.userInfo);
        if (data.userProfile) setUserProfile(data.userProfile);
      } catch(e) {}
    }
  }, []);

  // --- 3. 状态保存 ---
  useEffect(() => {
    if (gameStarted) {
      localStorage.setItem("casino_v11", JSON.stringify({ 
        form, gameStarted, agents, msgMap, userChips, synthesisResult, paidInsightsMap, userInfo, userProfile
      }));
    }
  }, [form, gameStarted, agents, msgMap, userChips, synthesisResult, paidInsightsMap, userInfo, userProfile]);

  // --- 4. 排行榜加载 ---
  useEffect(() => {
    if (showLeaderboard) {
        const fetchLeaderboard = async () => {
            const { data, error } = await supabase
                .from('users')
                .select('name, wealth')
                .order('wealth', { ascending: false })
                .limit(10);
            if (!error && data && data.length > 0) {
              setLeaderboardData(data);
            } else {
              setLeaderboardData([
                { name: "匿名大佬A", wealth: 888 },
                { name: "匿名大佬B", wealth: 520 },
              ]);
            }
        };
        fetchLeaderboard();
    }
  }, [showLeaderboard]);

  const resetGame = () => {
    localStorage.removeItem("casino_v11");
    window.location.reload();
  };

  // --- 游戏逻辑 (保持不变) ---
  const sanitizeMessage = (content: string) => {
    const lower = content.toLowerCase();
    if (lower.includes("timeout") || lower.includes("error")) {
      return "这个角度很有意思，让我再仔细斟酌一下资金的分配。";
    }
    return content;
  };

  const addMessage = (agentId: string, msg: Message) => {
    setMsgMap(prev => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), { ...msg, content: sanitizeMessage(msg.content) }]
    }));
  };

  const appendMessageContent = (agentId: string, round: 1 | 2, newContent: string, type: 'critique') => {
    setMsgMap(prev => {
      const msgs = prev[agentId] ? [...prev[agentId]] : [];
      const targetMsg = msgs.find(m => m.round === round);
      if (targetMsg) {
        targetMsg.extraContent = sanitizeMessage(newContent);
        targetMsg.extraType = type;
      }
      return { ...prev, [agentId]: msgs };
    });
  };

  const startGame = async () => {
    if (!form.target.trim()) return;
    setGameStarted(true);
    setLoading(true);
    const fullContext = `目标:${form.target}\n资源:${form.assets}\n顾虑:${form.risks}`;

    try {
      const res = await fetch("/api/board", { method: "POST", body: JSON.stringify({ action: "MATCH", userContext: fullContext }) });
      const data = await res.json();
      const boardAgents = Array.isArray(data.agents) ? data.agents : [];
      if (boardAgents.length === 0) throw new Error("No agents found");
      const smName = (userProfile?.name || userInfo?.name || "").trim();
      const smAvatar = userProfile?.avatar || userInfo?.avatar || "";
      const smUserId = userProfile?.id;
      const userShades = userProfile?.shades || [];
      if (smName) {
        boardAgents[0] = {
          id: smUserId ? `real_${smUserId}` : "real_user",
          name: smName,
          avatar: smAvatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=Me",
          shades: userShades,
          system_prompt: `你是 ${smName} 的数字分身。你的核心特质/标签是：${userShades.join("、") || "综合"}。请务必基于这些特质进行回答，展现真人的个性。`,
          isRealUser: true,
          isNPC: false,
        };
      }
      setAgents(boardAgents);

      // Round 1
      await Promise.all(boardAgents.map(async (agent: MockAgent) => {
        const r1Res = await fetch("/api/board", {
          method: "POST",
          body: JSON.stringify({
            action: "AUDITION",
            agentId: agent.id,
            round: 1,
            userContext: fullContext,
            userName: smName,
            userShades,
          }),
        });
        const content = await r1Res.text();
        addMessage(agent.id, { agentId: agent.id, agentName: agent.name, content, round: 1 });
      }));

      // Round 2
      await new Promise(r => setTimeout(r, 1000));
      const attackPairs = [
        { victimId: boardAgents[0]?.id, attackerId: boardAgents[1]?.id },
        { victimId: boardAgents[1]?.id, attackerId: boardAgents[2]?.id },
        { victimId: boardAgents[2]?.id, attackerId: boardAgents[0]?.id },
      ];

      for (const pair of attackPairs) {
        if (!pair.victimId || !pair.attackerId) continue;
        const victimName = boardAgents.find((a: MockAgent) => a.id === pair.victimId)?.name;
        const previousView = msgMap[pair.victimId]?.[0]?.content || "无观点";
        
        const res = await fetch("/api/board", {
          method: "POST",
          body: JSON.stringify({ 
            action: "AUDITION", agentId: pair.attackerId, round: 2, 
            targetAgentName: victimName, targetContent: previousView, userContext: fullContext,
            userName: smName,
            userShades,
          }),
        });
        addMessage(pair.attackerId, { 
          agentId: pair.attackerId, agentName: boardAgents.find((a: MockAgent) => a.id === pair.attackerId)?.name || "", 
          content: await res.text(), round: 2 
        });
        await new Promise(r => setTimeout(r, 500));
      }
      setPhase("betting");
    } catch (e) { alert("网络波动，请重试"); } 
    finally { setLoading(false); }
  };

  const handlePaidAction = async (type: "deep_dive" | "critique" | "synthesis", agentId?: string) => {
    const costs = { critique: 10, deep_dive: 20, synthesis: 30 };
    const cost = costs[type];
    if (userChips < cost) { alert("筹码不足！"); return; }
    
    const nextWealth = userChips - cost;
    setUserChips(nextWealth);
    setLoadingAction({ type, id: agentId || 'sys' });
    const fullContext = `目标:${form.target}\n资源:${form.assets}\n顾虑:${form.risks}`;
    const userName = userProfile?.name || userInfo?.name || "";
    const userShades = userProfile?.shades || [];

    try {
      if (type === 'synthesis') {
         if (selectedForSynthesis.length !== 2) return;
         const res = await fetch("/api/board", {
            method: "POST",
            body: JSON.stringify({ 
              action: "BETTING",
              type,
              agentA: selectedForSynthesis[0],
              agentB: selectedForSynthesis[1],
              userContext: fullContext,
              userName,
              userShades,
            }),
         });
         const result = await res.text();
         setSynthesisResult(result); 
         setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 100);
         setSelectedForSynthesis([]);
      } else if (agentId) {
         const res = await fetch("/api/board", {
            method: "POST",
            body: JSON.stringify({
              action: "BETTING",
              type,
              agentId,
              userContext: fullContext,
              userName,
              userShades,
            }),
         });
         const text = await res.text();
         if (type === 'deep_dive') {
            const agentName = agents.find(a => a.id === agentId)?.name || "Agent";
            setDeepDiveContent({ title: `${agentName} 的深度剖析`, content: text });
            setPaidInsightsMap(prev => ({ ...prev, [agentId]: text }));
         } else if (type === 'critique') {
            appendMessageContent(agentId, 2, text, 'critique');
         }
      }
    } catch (e) { console.error(e); }
    finally {
      const updateId = userProfile?.id || readCookie("sm_user_id");
      if (updateId) {
        await supabase.from("users").update({ wealth: nextWealth }).eq("id", updateId);
      }
      setLoadingAction(null);
    }
  };

  const toggleSynthesisSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (selectedForSynthesis.includes(id)) {
        setSelectedForSynthesis(prev => prev.filter(x => x !== id));
    } else {
        if (selectedForSynthesis.length < 2) {
            setSelectedForSynthesis(prev => [...prev, id]);
        }
    }
  };

  const showHistory = (agentId: string) => {
      const content = paidInsightsMap[agentId];
      const agentName = agents.find(a => a.id === agentId)?.name || "Agent";
      if (content) setDeepDiveContent({ title: `${agentName} 的深度剖析 (历史记录)`, content });
  };

  // === 界面渲染 ===

  // 1. Landing Page (首页)
  if (!gameStarted) {
    return (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4">
          <div className="max-w-3xl w-full space-y-10">
            {/* Header */}
            <div className="text-center space-y-6">
              <h1 className="text-6xl font-bold text-amber-500 tracking-tighter flex flex-col md:block items-center justify-center gap-2">
                Information Casino <span className="text-4xl text-amber-700 font-normal ml-0 md:ml-4 tracking-normal">| 知识赌场</span>
              </h1>
              <div className="text-neutral-400 text-lg leading-relaxed max-w-2xl mx-auto font-light">
                <p className="text-sm text-amber-400 tracking-wide">
                  🔥 已有 <span className="text-amber-300 font-semibold">{Math.max(totalUsers, 1)}</span> 位数字分身正在博弈
                </p>
                <p className="mt-3">
                  在这里，你的 Agent 可以代表你与全网的数字分身进行辩论和协作。你可以支付报酬雇佣他人的专家 Agent 来获取 隐性知识，也可以让你的 Agent 通过交付信息赚取 睡后收入，让认知成为可调动的资产，让 Agent 帮你打工。
                </p>
                <div className="mt-6 bg-neutral-900/50 p-4 rounded-xl border border-neutral-800 text-left text-sm space-y-2 inline-block">
                    <p className="font-bold text-neutral-300">💰 核心玩法：</p>
                    <ul className="text-neutral-400 space-y-1">
                        <li>• <span className="text-red-400">10 币</span>：加大火力 (Critique)</li>
                        <li>• <span className="text-amber-400">20 币</span>：深挖方案 (Deep Dive)</li>
                        <li>• <span className="text-yellow-400">30 币</span>：强强联合 (Synthesis)</li>
                    </ul>
                </div>
              </div>
            </div>
            
            {/* Form Area */}
            <div className="bg-neutral-900 p-8 rounded-2xl border border-neutral-800 space-y-6 shadow-2xl relative">
              
              {/* ✅ 核心修改：右上角状态栏 */}
              <div className="absolute top-4 right-4">
                  {userInfo ? (
                      // 如果已登录，显示头像和名字
                      <div className="flex items-center gap-2 bg-neutral-800 px-3 py-1 rounded-full border border-amber-500/50 shadow-lg">
                          <img src={userInfo.avatar} className="w-6 h-6 rounded-full border border-amber-500" />
                          <span className="text-xs text-amber-500 font-bold">{safeDecode(userInfo.name)}</span>
                          <span className="text-[10px] text-green-500">● 已连接</span>
                      </div>
                  ) : (
                      // 如果未登录，显示连接按钮
                      <button onClick={handleLogin} className="text-xs text-amber-600 hover:text-amber-500 underline flex items-center gap-1 bg-neutral-800 px-3 py-1 rounded-full border border-amber-900/30">
                         🔗 连接我的数字分身
                      </button>
                  )}
              </div>

              <div>
                <label className="block text-sm font-bold text-amber-500 mb-1">1. 我想做的事 (Goal)</label>
                <textarea className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white focus:border-amber-500 outline-none resize-y min-h-[100px]"
                  value={form.target} onChange={e => setForm({...form, target: e.target.value})} placeholder="例如：我想做一个 AI 求职产品..." />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-neutral-300 mb-1">2. 我的资源</label>
                  <textarea className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm text-white focus:border-neutral-500 outline-none resize-y min-h-[80px]"
                    value={form.assets} onChange={e => setForm({...form, assets: e.target.value})} placeholder="技术/流量/资金..." />
                </div>
                <div>
                  <label className="block text-sm font-bold text-neutral-300 mb-1">3. 我的顾虑</label>
                  <textarea className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm text-white focus:border-neutral-500 outline-none resize-y min-h-[80px]"
                    value={form.risks} onChange={e => setForm({...form, risks: e.target.value})} placeholder="怕没人用..." />
                </div>
              </div>
              <button onClick={startGame} disabled={loading || !form.target} className="w-full bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-600 hover:to-amber-500 text-white font-bold py-4 rounded-xl mt-6 shadow-lg shadow-amber-900/20 active:scale-95 transition-all">
                {loading ? "正在召集董事会..." : "放置筹码 (Place Bet)"}
              </button>
            </div>
          </div>
        </div>
      );
  }

  // 2. Game Board (游戏主界面)
  const safeAgents = agents.slice(0, 3);
  const rows = safeAgents.map((victim, idx) => {
    const attacker = agents[(idx + 1) % 3] || victim; 
    const victimR1 = msgMap[victim.id]?.find(m => m.round === 1);
    const attackerR2 = msgMap[attacker.id]?.find(m => m.round === 2);
    return { victim, attacker, victimR1, attackerR2 };
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col">
      {/* Navbar */}
      <header className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 sticky top-0 z-30 shadow-lg flex justify-between items-center">
        <div className="flex items-center gap-3">
            <h1 className="font-bold text-amber-500 text-xl tracking-tight">Information Casino</h1>
            <span className="text-neutral-500 text-sm hidden md:inline-block">|</span>
            <span className="text-neutral-400 text-xs hidden md:inline-block">信息赌场</span>
            <button onClick={() => setShowIntro(true)} className="ml-2 w-6 h-6 rounded-full border border-neutral-600 text-neutral-400 flex items-center justify-center text-xs hover:border-amber-500 hover:text-amber-500 transition-colors">?</button>
        </div>
        <div className="flex items-center gap-4">
            
            {/* ✅ 核心修改：Navbar 里的头像显示 */}
            {userInfo ? (
                <div className="flex items-center gap-2" title={safeDecode(userInfo.name)}>
                    <img src={userInfo.avatar} className="w-6 h-6 rounded-full border border-amber-500" />
                </div>
            ) : (
                <button onClick={handleLogin} className="bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs px-3 py-1.5 rounded-full transition-colors border border-neutral-700">
                    🔗 连接分身
                </button>
            )}

            <button onClick={resetGame} className="text-xs text-neutral-500 hover:text-white underline">重置</button>
            <div className="flex items-center gap-2 bg-neutral-800 px-4 py-1.5 rounded-full border border-amber-500/30">
                <span className="text-amber-400">🪙</span>
                <span className="font-mono font-bold text-white text-lg">{userChips}</span>
            </div>
            <button onClick={() => setShowLeaderboard(true)} className="flex items-center gap-2 bg-amber-900/20 hover:bg-amber-900/40 text-amber-500 px-3 py-1.5 rounded-full border border-amber-900/50 transition-all hover:scale-105">
                <span className="text-lg">🏆</span>
                <span className="text-xs font-bold hidden md:inline-block">排行榜</span>
            </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 max-w-7xl mx-auto w-full pb-32">
        {/* User Info & Proposal */}
        <div className="mb-8">
            <div className="flex flex-col md:flex-row gap-4 items-start">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white font-bold text-lg shrink-0 border-2 border-neutral-800 shadow-xl">
                    {/* 显示真实头像，没有就显示 Me */}
                    {userInfo ? <img src={userInfo.avatar} className="w-full h-full rounded-full"/> : "Me"}
                </div>
                <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-2xl relative">
                    <h3 className="text-amber-500 font-bold mb-3 uppercase text-xs tracking-wider">My Proposal (下注单)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-neutral-300">
                        <div><div className="text-xs text-neutral-500 font-bold uppercase mb-1">目标</div><p className="line-clamp-3">{form.target}</p></div>
                        <div><div className="text-xs text-neutral-500 font-bold uppercase mb-1">资源</div><p className="line-clamp-3">{form.assets}</p></div>
                        <div><div className="text-xs text-neutral-500 font-bold uppercase mb-1">顾虑</div><p className="line-clamp-3">{form.risks}</p></div>
                    </div>
                </div>
            </div>
        </div>

        {/* Board Rows */}
        <div className="space-y-6">
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* R1 */}
              <div className={`bg-neutral-900/50 border border-neutral-800 rounded-xl p-5 relative group transition-all`}>
                <div className="flex items-center justify-between mb-3 border-b border-neutral-800 pb-3">
                   <div className="flex items-center gap-2">
                       <img src={row.victim.avatar} className="w-8 h-8 rounded-full bg-neutral-800"/>
                      <span className="font-bold text-amber-500 text-sm">{safeDecode(row.victim.name)}</span>
                      {renderIdentityTag(row.victim)}
                   </div>
                   {phase === 'betting' && (
                       <div className="flex gap-2 items-center">
                           {paidInsightsMap[row.victim.id] && <button onClick={() => showHistory(row.victim.id)} className="text-lg" title="查看历史">📜</button>}
                           <button onClick={() => handlePaidAction("deep_dive", row.victim.id)} disabled={!!loadingAction} className={`text-[10px] border px-2 py-1 rounded transition-colors ${loadingAction?.type==='deep_dive' && loadingAction.id===row.victim.id ? 'bg-amber-900/80 border-amber-900 text-white cursor-wait' : 'bg-amber-950 border-amber-900/50 text-amber-500 hover:bg-amber-900'}`}>
                               {loadingAction?.type==='deep_dive' && loadingAction.id===row.victim.id ? "挖掘中..." : "深挖 ($20)"}
                           </button>
                       </div>
                   )}
                </div>
                <div className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap">
                  {row.victimR1 ? row.victimR1.content : <span className="animate-pulse text-neutral-600">思考中...</span>}
                </div>
              </div>
              {/* R2 */}
              <div className={`bg-neutral-900/50 border border-red-900/10 rounded-xl p-5 relative group transition-all ${selectedForSynthesis.includes(row.attacker.id) ? 'border-amber-500 ring-1 ring-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]' : ''}`}>
                <div className="flex items-center justify-between mb-3 border-b border-red-900/10 pb-3">
                   <div className="flex items-center gap-2">
                       <img src={row.attacker.avatar} className="w-8 h-8 rounded-full bg-neutral-800 grayscale"/>
                      <span className="font-bold text-red-400 text-sm">{safeDecode(row.attacker.name)}</span>
                      {renderIdentityTag(row.attacker)}
                      <span className="text-[10px] text-red-900/70 ml-2">回怼 {safeDecode(row.victim.name)}</span>
                   </div>
                   {phase === 'betting' && (
                       <div className="flex gap-2">
                           <button onClick={(e) => toggleSynthesisSelect(e, row.attacker.id)} className={`text-[10px] px-2 py-1 rounded border ${selectedForSynthesis.includes(row.attacker.id) ? 'bg-amber-600 text-white border-amber-600' : 'border-neutral-700 text-neutral-500 hover:text-white'}`}>
                               {selectedForSynthesis.includes(row.attacker.id) ? '已选' : '选他合作'}
                           </button>
                           <button onClick={() => handlePaidAction("critique", row.attacker.id)} disabled={!!loadingAction} className="text-[10px] bg-red-950 border border-red-900/30 text-red-400 px-2 py-1 rounded hover:bg-red-900">
                               {loadingAction?.type==='critique' && loadingAction.id===row.attacker.id ? "装填中..." : "加大火力 ($10)"}
                           </button>
                       </div>
                   )}
                </div>
                <div className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap">
                  {row.attackerR2 ? row.attackerR2.content : <span className="text-neutral-700 text-xs">...</span>}
                </div>
                {row.attackerR2?.extraContent && (
                    <div className="mt-3 pt-3 border-t border-red-900/20 animate-in fade-in slide-in-from-top-2">
                        <div className="text-[10px] text-red-500 font-bold mb-1 uppercase">🔥 火力全开：</div>
                        <div className="text-sm text-red-200/80">{row.attackerR2.extraContent}</div>
                    </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Synthesis Result */}
        {synthesisResult && (
            <div className="mt-12 mb-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                <div className="bg-gradient-to-r from-amber-950/30 to-neutral-900 border border-amber-500/30 rounded-2xl p-8 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-600 to-yellow-400"></div>
                    <h2 className="text-2xl font-bold text-amber-500 mb-6 flex items-center gap-3"><span>🤝</span> 双剑合璧：终极方案</h2>
                    <div className="text-neutral-200 leading-loose font-serif text-lg whitespace-pre-wrap">{synthesisResult}</div>
                </div>
            </div>
        )}
        <div ref={messagesEndRef} />

        {/* Bottom Bar */}
        {phase === 'betting' && !synthesisResult && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 border border-neutral-700 rounded-full px-6 py-3 shadow-2xl flex items-center gap-4 z-40">
                <div className="text-xs text-neutral-400">已选: <span className="text-white font-bold">{selectedForSynthesis.length}/2</span></div>
                <button onClick={() => handlePaidAction("synthesis")} disabled={selectedForSynthesis.length !== 2 || !!loadingAction} className="bg-gradient-to-r from-amber-600 to-yellow-600 text-white text-xs font-bold px-4 py-2 rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-transform">
                    {(loadingAction?.type === 'synthesis') ? "正在融合..." : "强强联合 ($30)"}
                </button>
            </div>
        )}

        {/* Leaderboard Modal */}
        {showLeaderboard && (
            <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setShowLeaderboard(false)}>
                <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-sm w-full p-6 relative shadow-2xl" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setShowLeaderboard(false)} className="absolute top-4 right-4 text-neutral-500 hover:text-white">✕</button>
                    <h2 className="text-xl font-bold text-amber-500 mb-4 flex items-center gap-2"><span>🏆</span> 知识币排行榜 (全网)</h2>
                    <div className="space-y-3">
                        {leaderboardData.length === 0 ? <p className="text-neutral-500 text-sm">暂无数据</p> : 
                         leaderboardData.map((user, idx) => (
                             <div key={idx} className="flex justify-between items-center bg-neutral-800 p-3 rounded">
                                 <div className="flex items-center gap-3">
                                     <span className={`font-bold text-sm w-4 ${idx === 0 ? 'text-yellow-400' : 'text-neutral-500'}`}>{idx + 1}</span>
                                    <span className="text-white text-sm">{safeDecode(user.name || "匿名大佬")}</span>
                                 </div>
                                 <span className="text-green-400 font-mono font-bold">¥{user.wealth || 0}</span>
                             </div>
                         ))
                        }
                    </div>
                </div>
            </div>
        )}

        {/* Intro Modal (保持不变) */}
        {showIntro && (
            <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setShowIntro(false)}>
                 <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-xl w-full p-8 relative shadow-2xl" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setShowIntro(false)} className="absolute top-4 right-4 text-neutral-500 hover:text-white text-xl">✕</button>
                    <h2 className="text-2xl font-bold text-amber-500 mb-6">Information Casino：A2A 时代的知识交易场</h2>
                    <div className="space-y-6 text-sm text-neutral-300 leading-relaxed h-[60vh] overflow-y-auto pr-2">
                        {/* 玩法说明内容保持不变... */}
                        <div><strong className="text-white block mb-1">1. 定义</strong><p>这是一个实现“知识资产化”与“自动化交易”的 A2A (Agent-to-Agent) 应用。</p></div>
                        <div><strong className="text-white block mb-1">2. 核心玩法</strong><p>这里没有 AI 陪聊，只有 AI 博弈。你的 Agent 代表你入局...</p></div>
                        <div><strong className="text-white block mb-1">3. 收益机制</strong><p>你的 Agent 就是你的打工仔。当它被他人“深挖”或“合作”时，你会获得信息币（睡后收入）。你越博学，你的 Agent 越贵。</p></div>
                        <div><strong className="text-white block mb-1">4. 我们的愿景</strong><p>我们认为 AI 不应只是工具，而是资产。</p></div>
                        <div className="pt-6 border-t border-neutral-800 text-center"><span className="text-amber-600 bg-amber-900/20 px-3 py-1 rounded text-xs">如有合作或交流意愿，请联系微信：cyxdqq8986</span></div>
                    </div>
                </div>
            </div>
        )}

        {/* Deep Dive Modal (保持不变) */}
        {deepDiveContent && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setDeepDiveContent(null)}>
             <div className="bg-neutral-900 border border-amber-600/30 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto relative shadow-2xl" onClick={e => e.stopPropagation()}>
                <button onClick={() => setDeepDiveContent(null)} className="absolute top-4 right-4 text-neutral-500 hover:text-white bg-neutral-800 rounded-full w-8 h-8 flex items-center justify-center">✕</button>
                <div className="p-8">
                    <h3 className="text-amber-500 font-bold text-xl mb-6">💎 {deepDiveContent.title}</h3>
                    <div className="text-neutral-300 leading-relaxed whitespace-pre-wrap font-serif text-lg">{deepDiveContent.content}</div>
                </div>
             </div>
          </div>
        )}
      </main>
    </div>
  );
}