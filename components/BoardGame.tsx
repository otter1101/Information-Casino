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

export default function BoardGame() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [form, setForm] = useState<BetForm>({ target: "", assets: "", risks: "" });
  const [gameStarted, setGameStarted] = useState(false);
  const [agents, setAgents] = useState<MockAgent[]>([]);
  const [msgMap, setMsgMap] = useState<Record<string, Message[]>>({}); 
  const [phase, setPhase] = useState<"audition" | "betting">("audition");
  const [userChips, setUserChips] = useState(100);
  
  const [realLeaderboard, setRealLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<{type: string, id: string} | null>(null);
  
  const [deepDiveContent, setDeepDiveContent] = useState<{title: string, content: string} | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [paidInsightsMap, setPaidInsightsMap] = useState<Record<string, string>>({});
  const [selectedForSynthesis, setSelectedForSynthesis] = useState<string[]>([]);
  const [synthesisResult, setSynthesisResult] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 1. 初始化检查
  useEffect(() => {
    const hasToken = document.cookie.includes("secondme_access_token");
    setIsLoggedIn(hasToken);
    setCheckingAuth(false);

    // 恢复游戏状态
    const saved = localStorage.getItem("casino_v12"); // 升级版本
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.gameStarted) {
            setForm(data.form || { target: "", assets: "", risks: "" });
            setGameStarted(true);
            setAgents(data.agents || []);
            setMsgMap(data.msgMap || {});
            setUserChips(data.userChips || 100);
            setSynthesisResult(data.synthesisResult || null);
            setPaidInsightsMap(data.paidInsightsMap || {});
        }
      } catch(e) {}
    }
  }, []);

  useEffect(() => {
    if (gameStarted) {
      localStorage.setItem("casino_v12", JSON.stringify({ 
        gameStarted, form, agents, msgMap, userChips, synthesisResult, paidInsightsMap 
      }));
    }
  }, [gameStarted, form, agents, msgMap, userChips, synthesisResult, paidInsightsMap]);

  // 🚀 获取真实排行榜 (调用我们刚写的 API)
  const fetchLeaderboard = async () => {
      try {
          const res = await fetch('/api/leaderboard');
          const json = await res.json();
          if (json.data) {
              setRealLeaderboard(json.data);
          }
      } catch (e) {
          console.error("获取排行榜失败", e);
      }
  };

  useEffect(() => { if (showLeaderboard) fetchLeaderboard(); }, [showLeaderboard]);

  const resetGame = () => {
    localStorage.removeItem("casino_v12");
    window.location.reload();
  };

  const logout = () => {
      document.cookie = "secondme_access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      localStorage.removeItem("casino_v12");
      window.location.reload();
  }

  // 🚀 [核心修正] 跳转 SecondMe 授权
  // 必须严格遵循文档：https://go.second.me/oauth/?...
  // 必须加上 SCOPE，否则拿不到 shades！
  const handleLogin = () => {
    const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
    if (!clientId) { alert("Missing NEXT_PUBLIC_CLIENT_ID in env"); return; }

    const redirectUri = `${window.location.origin}/api/auth/callback`;
    const state = Math.random().toString(36).substring(7); // 简单生成 State，生产环境建议存 Cookie 校验
    
    // 关键修正：添加 scope 参数！
    // user.info: 基础信息 (头像、昵称)
    // user.info.shades: 兴趣标签 (用于智能匹配)
    const scopes = "user.info user.info.shades"; 
    
    // 构造 URL
    const authUrl = `https://go.second.me/oauth/?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}`;
    
    window.location.href = authUrl;
  };

  // ... (其余辅助函数保持不变)
  const addMessage = (agentId: string, msg: Message) => {
    setMsgMap(prev => ({ ...prev, [agentId]: [...(prev[agentId] || []), msg] }));
  };
  const appendMessageContent = (agentId: string, round: 1 | 2, newContent: string, type: 'critique') => {
    setMsgMap(prev => {
      const msgs = prev[agentId] ? [...prev[agentId]] : [];
      const targetMsg = msgs.find(m => m.round === round);
      if (targetMsg) { targetMsg.extraContent = newContent; targetMsg.extraType = type; }
      return { ...prev, [agentId]: msgs };
    });
  };

  const startGame = async () => {
    if (!form.target.trim()) return;
    setGameStarted(true);
    setLoading(true);
    const fullContext = `目标:${form.target}\n资源:${form.assets}\n顾虑:${form.risks}`;

    try {
      const res = await fetch("/api/board", { method: "POST", body: JSON.stringify({ action: "MATCH" }) });
      const data = await res.json();
      const boardAgents = Array.isArray(data.agents) ? data.agents : [];
      setAgents(boardAgents);

      const r1ContentMap: Record<string, string> = {};
      await Promise.all(boardAgents.map(async (agent: MockAgent) => {
        const r1Res = await fetch("/api/board", {
          method: "POST", body: JSON.stringify({ action: "AUDITION", agentId: agent.id, round: 1, userContext: fullContext }),
        });
        const content = await r1Res.text();
        r1ContentMap[agent.id] = content; 
        addMessage(agent.id, { agentId: agent.id, agentName: agent.name, content, round: 1 });
      }));

      await new Promise(r => setTimeout(r, 1000));
      const attackPairs = [
        { victimId: boardAgents[0]?.id, attackerId: boardAgents[1]?.id },
        { victimId: boardAgents[1]?.id, attackerId: boardAgents[2]?.id },
        { victimId: boardAgents[2]?.id, attackerId: boardAgents[0]?.id },
      ];
      for (const pair of attackPairs) {
        if (!pair.victimId || !pair.attackerId) continue;
        const victimName = agents.find(a => a.id === pair.victimId)?.name;
        const res = await fetch("/api/board", {
          method: "POST", body: JSON.stringify({ 
            action: "AUDITION", agentId: pair.attackerId, round: 2, 
            targetAgentName: victimName, targetContent: r1ContentMap[pair.victimId], userContext: fullContext
          }),
        });
        addMessage(pair.attackerId, { agentId: pair.attackerId, agentName: agents.find(a => a.id === pair.attackerId)?.name || "", content: await res.text(), round: 2 });
        await new Promise(r => setTimeout(r, 500));
      }
      setPhase("betting");
    } catch (e) { console.error(e); alert("网络波动，请重试"); } 
    finally { setLoading(false); }
  };

  const handlePaidAction = async (type: "deep_dive" | "critique" | "synthesis", agentId?: string) => {
    const costs = { critique: 10, deep_dive: 20, synthesis: 30 };
    if (userChips < costs[type]) { alert("筹码不足！"); return; }
    setUserChips(prev => prev - costs[type]);
    setLoadingAction({ type, id: agentId || 'sys' });
    const fullContext = `目标:${form.target}\n资源:${form.assets}\n顾虑:${form.risks}`;
    
    try {
        const body: any = { action: "BETTING", type, userContext: fullContext };
        if (type === 'synthesis') { body.agentA = selectedForSynthesis[0]; body.agentB = selectedForSynthesis[1]; }
        else { body.agentId = agentId; }
        
        const res = await fetch("/api/board", { method: "POST", body: JSON.stringify(body) });
        const text = await res.text();
        
        if (type === 'synthesis') { setSynthesisResult(text); setSelectedForSynthesis([]); setTimeout(() => messagesEndRef.current?.scrollIntoView(), 100); }
        else if (type === 'deep_dive') { 
            setDeepDiveContent({ title: "深度分析", content: text }); 
            if(agentId) setPaidInsightsMap(prev => ({ ...prev, [agentId]: text }));
        }
        else { if(agentId) appendMessageContent(agentId, 2, text, 'critique'); }
    } catch(e) {} finally { setLoadingAction(null); }
  };

  const toggleSynthesisSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (selectedForSynthesis.includes(id)) setSelectedForSynthesis(prev => prev.filter(x => x !== id));
    else if (selectedForSynthesis.length < 2) setSelectedForSynthesis(prev => [...prev, id]);
  };

  // --- 视图 ---
  if (checkingAuth) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-amber-500">正在连接信息场...</div>;

  if (!isLoggedIn) {
      return (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(245,158,11,0.05),transparent_60%)]"></div>
          <div className="max-w-md w-full text-center space-y-12 relative z-10">
            <div className="space-y-4">
              <h1 className="text-6xl font-bold text-amber-500 tracking-tighter drop-shadow-2xl">Information Casino</h1>
              <p className="text-xl text-neutral-400 font-light tracking-widest uppercase">| 知识交易场 |</p>
            </div>
            <div className="bg-neutral-900/50 backdrop-blur-sm border border-neutral-800 p-8 rounded-3xl shadow-2xl space-y-8">
               <div className="space-y-6 text-neutral-300 text-sm leading-relaxed">
                   <p>这里没有 AI 陪聊，只有高价值的 <strong className="text-amber-500">认知博弈</strong>。</p>
                   <p>你的 <strong className="text-white">数字分身</strong> 必须作为资产入局，方可开启交易。</p>
               </div>
               <button onClick={handleLogin} className="w-full bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-600 hover:to-amber-500 text-white font-bold text-lg py-4 rounded-xl shadow-lg shadow-amber-900/20 active:scale-95 transition-all flex items-center justify-center gap-3">
                  <span>⚡️</span> 连接我的数字分身
               </button>
               <p className="text-[10px] text-neutral-600">*数据将通过 SecondMe 安全授权接入</p>
            </div>
          </div>
        </div>
      );
  }

  if (!gameStarted) {
    return (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4">
          <div className="max-w-3xl w-full space-y-10">
            <div className="text-center space-y-6">
              <div className="flex items-center justify-center gap-4 mb-4 animate-in fade-in slide-in-from-top-4">
                  <span className="bg-green-900/30 text-green-500 px-3 py-1 rounded-full text-xs border border-green-900/50 flex items-center gap-2"><span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>已连接数字分身</span>
                  <button onClick={logout} className="text-neutral-600 hover:text-white text-xs underline transition-colors">退出登录</button>
              </div>
              <h1 className="text-6xl font-bold text-amber-500 tracking-tighter">Information Casino</h1>
              <div className="text-neutral-400 text-lg leading-relaxed max-w-2xl mx-auto font-light"><p>请输入你的想法，召集全网最强 Agent 董事会为你出谋划策。</p></div>
            </div>
            <div className="bg-neutral-900 p-8 rounded-2xl border border-neutral-800 space-y-6 shadow-2xl">
              <div><label className="block text-sm font-bold text-amber-500 mb-1">1. 我想做的事 (Goal)</label><textarea className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-white focus:border-amber-500 outline-none resize-y min-h-[100px]" value={form.target} onChange={e => setForm({...form, target: e.target.value})} placeholder="例如：我想做一个 AI 求职产品..." /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div><label className="block text-sm font-bold text-neutral-300 mb-1">2. 我的资源</label><textarea className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm text-white focus:border-neutral-500 outline-none resize-y min-h-[80px]" value={form.assets} onChange={e => setForm({...form, assets: e.target.value})} placeholder="技术/流量/资金..." /></div>
                <div><label className="block text-sm font-bold text-neutral-300 mb-1">3. 我的顾虑</label><textarea className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-sm text-white focus:border-neutral-500 outline-none resize-y min-h-[80px]" value={form.risks} onChange={e => setForm({...form, risks: e.target.value})} placeholder="怕没人用..." /></div>
              </div>
              <button onClick={startGame} disabled={loading || !form.target} className="w-full bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-600 hover:to-amber-500 text-white font-bold py-4 rounded-xl mt-6 shadow-lg shadow-amber-900/20 active:scale-95 transition-all">{loading ? "正在召集董事会..." : "放置筹码 (Place Bet)"}</button>
            </div>
          </div>
        </div>
      );
  }

  const safeAgents = agents.slice(0, 3);
  const rows = safeAgents.map((victim, idx) => {
    const attacker = agents[(idx + 1) % 3] || victim; 
    const victimR1 = msgMap[victim.id]?.find(m => m.round === 1);
    const attackerR2 = msgMap[attacker.id]?.find(m => m.round === 2);
    return { victim, attacker, victimR1, attackerR2 };
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col">
      <header className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 sticky top-0 z-30 shadow-lg flex justify-between items-center">
        <div className="flex items-center gap-3">
            <h1 className="font-bold text-amber-500 text-xl tracking-tight">Information Casino</h1>
            <button onClick={() => setShowIntro(true)} className="ml-2 w-6 h-6 rounded-full border border-neutral-600 text-neutral-400 flex items-center justify-center text-xs hover:border-amber-500 hover:text-amber-500 transition-colors">?</button>
        </div>
        <div className="flex items-center gap-4">
            <button onClick={resetGame} className="text-xs text-neutral-500 hover:text-white underline">重置游戏</button>
            <div className="flex items-center gap-2 bg-neutral-800 px-4 py-1.5 rounded-full border border-amber-500/30"><span className="text-amber-400">🪙</span><span className="font-mono font-bold text-white text-lg">{userChips}</span></div>
            <button onClick={() => setShowLeaderboard(true)} className="text-xl hover:scale-110 transition-transform" title="财富榜">🏆</button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-6 max-w-7xl mx-auto w-full pb-32">
        <div className="mb-8"><div className="flex flex-col md:flex-row gap-4 items-start"><div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white font-bold text-lg shrink-0 border-2 border-neutral-800 shadow-xl">Me</div><div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-2xl relative"><h3 className="text-amber-500 font-bold mb-3 uppercase text-xs tracking-wider">My Proposal (下注单)</h3><div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-neutral-300"><div><div className="text-xs text-neutral-500 font-bold uppercase mb-1">目标</div><p className="line-clamp-3">{form.target}</p></div><div><div className="text-xs text-neutral-500 font-bold uppercase mb-1">资源</div><p className="line-clamp-3">{form.assets}</p></div><div><div className="text-xs text-neutral-500 font-bold uppercase mb-1">顾虑</div><p className="line-clamp-3">{form.risks}</p></div></div></div></div></div>
        <div className="space-y-6">
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-5 relative"><div className="flex items-center justify-between mb-3 border-b border-neutral-800 pb-3"><div className="flex items-center gap-2"><img src={row.victim.avatar} className="w-8 h-8 rounded-full bg-neutral-800"/><span className="font-bold text-amber-500 text-sm">{row.victim.name}</span></div>{phase === 'betting' && (<div className="flex gap-2"><button onClick={() => setDeepDiveContent({title: row.victim.name, content: "付费查看..."}) || handlePaidAction("deep_dive", row.victim.id)} className="text-[10px] bg-amber-950 text-amber-500 px-2 py-1 rounded">深挖 ($20)</button></div>)}</div><div className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap">{row.victimR1 ? row.victimR1.content : "思考中..."}</div></div>
              <div className={`bg-neutral-900/50 border border-red-900/10 rounded-xl p-5 relative ${selectedForSynthesis.includes(row.attacker.id) ? 'border-amber-500' : ''}`}><div className="flex items-center justify-between mb-3 border-b border-red-900/10 pb-3"><div className="flex items-center gap-2"><img src={row.attacker.avatar} className="w-8 h-8 rounded-full bg-neutral-800 grayscale"/><span className="font-bold text-red-400 text-sm">{row.attacker.name}</span></div>{phase === 'betting' && (<div className="flex gap-2"><button onClick={(e) => toggleSynthesisSelect(e, row.attacker.id)} className="text-[10px] border px-2 py-1 rounded text-neutral-400 hover:text-white">{selectedForSynthesis.includes(row.attacker.id) ? '已选' : '选他合作'}</button><button onClick={() => handlePaidAction("critique", row.attacker.id)} className="text-[10px] bg-red-950 text-red-400 px-2 py-1 rounded">加大火力 ($10)</button></div>)}</div><div className="text-sm text-neutral-300">{row.attackerR2 ? row.attackerR2.content : "..."}</div>{row.attackerR2?.extraContent && <div className="mt-2 pt-2 border-t border-red-900/20 text-red-200 text-sm">{row.attackerR2.extraContent}</div>}</div>
            </div>
          ))}
        </div>
        {synthesisResult && (<div className="mt-8 bg-neutral-900 p-6 rounded-xl border border-amber-500/30 text-neutral-200 whitespace-pre-wrap">{synthesisResult}</div>)}
        <div ref={messagesEndRef} />
        {phase === 'betting' && !synthesisResult && (<div className="fixed bottom-6 left-1/2 -translate-x-1/2"><button onClick={() => handlePaidAction("synthesis")} disabled={selectedForSynthesis.length !== 2} className="bg-gradient-to-r from-amber-600 to-yellow-600 text-white px-6 py-3 rounded-full font-bold shadow-lg disabled:opacity-50">强强联合 ($30)</button></div>)}
        {showLeaderboard && (<div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" onClick={() => setShowLeaderboard(false)}><div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-full max-w-sm p-6" onClick={e=>e.stopPropagation()}><h2 className="text-xl font-bold text-amber-500 mb-4">🏆 财富榜 (Top 10)</h2><div className="space-y-2 max-h-[60vh] overflow-y-auto">{realLeaderboard.length === 0 ? <p className="text-neutral-500">暂无数据</p> : realLeaderboard.map((u,i) => (<div key={i} className="flex justify-between py-2 border-b border-neutral-800 text-sm text-white"><span>{i+1}. {u.name}</span><span className="text-green-400">${u.wealth}</span></div>))}</div></div></div>)}
        {showIntro && (<div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" onClick={() => setShowIntro(false)}><div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-8 max-w-xl text-neutral-300 space-y-4"><h2 className="text-xl font-bold text-amber-500">Information Casino 玩法说明</h2><p>1. 必须登录才能从数据库获取真人 Agent。</p><p>2. 付费动作会真实扣除金币，并增加对应 Agent 的财富值。</p></div></div>)}
        {deepDiveContent && (<div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" onClick={() => setDeepDiveContent(null)}><div className="bg-neutral-900 border border-amber-500 rounded-2xl w-full max-w-2xl p-8 max-h-[80vh] overflow-y-auto"><h3 className="text-xl font-bold text-amber-500 mb-4">{deepDiveContent.title}</h3><div className="text-neutral-300 whitespace-pre-wrap">{deepDiveContent.content}</div></div></div>)}
      </main>
    </div>
  );
}