"use client";

import { useState, useEffect, useRef } from "react";
import { type MockAgent } from "@/lib/mock-agents";

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
  const [form, setForm] = useState<BetForm>({ target: "", assets: "", risks: "" });
  const [gameStarted, setGameStarted] = useState(false);
  const [agents, setAgents] = useState<MockAgent[]>([]);
  const [msgMap, setMsgMap] = useState<Record<string, Message[]>>({}); 
  const [phase, setPhase] = useState<"audition" | "betting">("audition");
  const [userChips, setUserChips] = useState(100);
  const [agentEarnings, setAgentEarnings] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<{type: string, id: string} | null>(null);
  
  // 弹窗状态
  const [deepDiveContent, setDeepDiveContent] = useState<{title: string, content: string} | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  
  // 存储付费记录
  const [paidInsightsMap, setPaidInsightsMap] = useState<Record<string, string>>({});

  // 合作模式
  const [selectedForSynthesis, setSelectedForSynthesis] = useState<string[]>([]);
  const [synthesisResult, setSynthesisResult] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 本地存储 v7
  useEffect(() => {
    const saved = localStorage.getItem("casino_v7");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setForm(data.form || { target: "", assets: "", risks: "" });
        setGameStarted(data.gameStarted);
        setAgents(data.agents || []);
        setMsgMap(data.msgMap || {});
        setUserChips(data.userChips || 100);
        setAgentEarnings(data.agentEarnings || {});
        setSynthesisResult(data.synthesisResult || null);
        setPaidInsightsMap(data.paidInsightsMap || {});
      } catch(e) {}
    }
  }, []);

  useEffect(() => {
    if (gameStarted) {
      localStorage.setItem("casino_v7", JSON.stringify({ 
        form, gameStarted, agents, msgMap, userChips, agentEarnings, synthesisResult, paidInsightsMap 
      }));
    }
  }, [form, gameStarted, agents, msgMap, userChips, agentEarnings, synthesisResult, paidInsightsMap]);

  const resetGame = () => {
    localStorage.removeItem("casino_v7");
    window.location.reload();
  };

  const addMessage = (agentId: string, msg: Message) => {
    setMsgMap(prev => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), msg]
    }));
  };

  const appendMessageContent = (agentId: string, round: 1 | 2, newContent: string, type: 'critique') => {
    setMsgMap(prev => {
      const msgs = prev[agentId] ? [...prev[agentId]] : [];
      const targetMsg = msgs.find(m => m.round === round);
      if (targetMsg) {
        targetMsg.extraContent = newContent;
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
      const res = await fetch("/api/board", { method: "POST", body: JSON.stringify({ action: "MATCH" }) });
      const data = await res.json();
      const boardAgents = Array.isArray(data.agents) ? data.agents : [];
      if (boardAgents.length === 0) throw new Error("No agents found");
      setAgents(boardAgents);

      // --- Round 1 ---
      const r1ContentMap: Record<string, string> = {};
      await Promise.all(boardAgents.map(async (agent: MockAgent) => {
        const r1Res = await fetch("/api/board", {
          method: "POST",
          body: JSON.stringify({ action: "AUDITION", agentId: agent.id, round: 1, userContext: fullContext }),
        });
        const content = await r1Res.text();
        r1ContentMap[agent.id] = content; 
        addMessage(agent.id, { agentId: agent.id, agentName: agent.name, content, round: 1 });
      }));

      // --- Round 2 ---
      await new Promise(r => setTimeout(r, 1000));
      const attackPairs = [
        { victimId: boardAgents[0]?.id, attackerId: boardAgents[1]?.id },
        { victimId: boardAgents[1]?.id, attackerId: boardAgents[2]?.id },
        { victimId: boardAgents[2]?.id, attackerId: boardAgents[0]?.id },
      ];

      for (const pair of attackPairs) {
        if (!pair.victimId || !pair.attackerId) continue;
        const previousView = r1ContentMap[pair.victimId] || "无观点";
        const victimName = agents.find(a => a.id === pair.victimId)?.name;

        const res = await fetch("/api/board", {
          method: "POST",
          body: JSON.stringify({ 
            action: "AUDITION", 
            agentId: pair.attackerId, 
            round: 2, 
            targetAgentName: victimName,
            targetContent: previousView, 
            userContext: fullContext
          }),
        });
        addMessage(pair.attackerId, { 
          agentId: pair.attackerId, 
          agentName: agents.find(a => a.id === pair.attackerId)?.name || "", 
          content: await res.text(), 
          round: 2 
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
    
    setUserChips(prev => prev - cost);
    setLoadingAction({ type, id: agentId || 'sys' });
    
    // 增加收益
    if (agentId) {
        setAgentEarnings(prev => ({...prev, [agentId]: (prev[agentId] || 0) + cost }));
    } else if (type === 'synthesis' && selectedForSynthesis.length === 2) {
        selectedForSynthesis.forEach(id => {
            setAgentEarnings(prev => ({...prev, [id]: (prev[id] || 0) + (cost/2) }));
        });
    }

    const fullContext = `目标:${form.target}\n资源:${form.assets}\n顾虑:${form.risks}`;

    try {
      if (type === 'synthesis') {
         if (selectedForSynthesis.length !== 2) return;
         const res = await fetch("/api/board", {
            method: "POST",
            body: JSON.stringify({ 
              action: "BETTING", type, 
              agentA: selectedForSynthesis[0], 
              agentB: selectedForSynthesis[1], 
              userContext: fullContext 
            }),
         });
         const result = await res.text();
         setSynthesisResult(result); 
         setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 100);
         setSelectedForSynthesis([]);
      } else if (agentId) {
         const res = await fetch("/api/board", {
            method: "POST",
            body: JSON.stringify({ action: "BETTING", type, agentId, userContext: fullContext }),
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
    finally { setLoadingAction(null); }
  };

  const toggleSynthesisSelect = (id: string) => {
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
      if (content) {
          setDeepDiveContent({ title: `${agentName} 的深度剖析 (历史记录)`, content });
      }
  };

  // --- Landing Page ---
  if (!gameStarted) {
    return (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4">
          <div className="max-w-3xl w-full space-y-10">
            <div className="text-center space-y-6">
              <h1 className="text-6xl font-bold text-amber-500 tracking-tighter flex flex-col md:block items-center justify-center gap-2">
                Information Casino 
                <span className="text-4xl text-amber-700 font-normal ml-0 md:ml-4 tracking-normal">| 知识赌场</span>
              </h1>
              <div className="text-neutral-400 text-lg leading-relaxed max-w-2xl mx-auto font-light">
                <p>
                  在这里，你的 Agent 可以代表你与全网的数字分身进行辩论和协作。
                  你可以支付报酬雇佣他人的专家 Agent 来获取 <span className="text-amber-500">隐性知识</span>，
                  也可以让你的 Agent 通过交付信息赚取 <span className="text-amber-500">税后收入</span>，
                  让认知成为可调动的资产，让 Agent 帮你打工。
                </p>
              </div>
            </div>
            <div className="bg-neutral-900 p-8 rounded-2xl border border-neutral-800 space-y-6 shadow-2xl">
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

  const safeAgents = agents.slice(0, 3);
  const rows = safeAgents.map((victim, idx) => {
    const attacker = agents[(idx + 1) % 3] || victim; 
    const victimR1 = msgMap[victim.id]?.find(m => m.round === 1);
    const attackerR2 = msgMap[attacker.id]?.find(m => m.round === 2);
    return { victim, attacker, victimR1, attackerR2 };
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col">
      {/* Header */}
      <header className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 sticky top-0 z-30 shadow-lg flex justify-between items-center">
        <div className="flex items-center gap-3">
            <h1 className="font-bold text-amber-500 text-xl tracking-tight">Information Casino</h1>
            <span className="text-neutral-500 text-sm hidden md:inline-block">|</span>
            <span className="text-neutral-400 text-xs hidden md:inline-block">信息赌场：用筹码换取真知，让 AI 董事会为你博弈出最佳决策。</span>
            <button onClick={() => setShowIntro(true)} className="ml-2 w-6 h-6 rounded-full border border-neutral-600 text-neutral-400 flex items-center justify-center text-xs hover:border-amber-500 hover:text-amber-500 transition-colors">?</button>
        </div>
        <div className="flex items-center gap-4">
            <button onClick={resetGame} className="text-xs text-neutral-500 hover:text-white underline">重置</button>
            <div className="flex items-center gap-2 bg-neutral-800 px-4 py-1.5 rounded-full border border-amber-500/30">
                <span className="text-amber-400">🪙</span>
                <span className="font-mono font-bold text-white text-lg">{userChips}</span>
            </div>
            {/* 排行榜入口 */}
            <button onClick={() => setShowLeaderboard(true)} className="text-xl hover:scale-110 transition-transform" title="财富榜">🏆</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 max-w-7xl mx-auto w-full pb-32">
        {/* User Card (Keep same as before) */}
        <div className="mb-8">
            <div className="flex flex-col md:flex-row gap-4 items-start">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white font-bold text-lg shrink-0 border-2 border-neutral-800 shadow-xl">Me</div>
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

        {/* Board */}
        <div className="space-y-6">
          {rows.map((row, idx) => {
            const isDeepDiveLoading = loadingAction?.type === 'deep_dive' && loadingAction?.id === row.victim.id;
            const hasHistory = !!paidInsightsMap[row.victim.id];

            return (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* R1 */}
              <div className={`bg-neutral-900/50 border border-neutral-800 rounded-xl p-5 relative group transition-all`}>
                <div className="flex items-center justify-between mb-3 border-b border-neutral-800 pb-3">
                   <div className="flex items-center gap-2">
                       <img src={row.victim.avatar} className="w-8 h-8 rounded-full bg-neutral-800"/>
                       <span className="font-bold text-amber-500 text-sm">{row.victim.name}</span>
                   </div>
                   {phase === 'betting' && (
                       <div className="flex gap-2 items-center">
                           {hasHistory && <button onClick={() => showHistory(row.victim.id)} className="text-lg" title="查看历史">📜</button>}
                           <button 
                                onClick={() => handlePaidAction("deep_dive", row.victim.id)} 
                                disabled={!!loadingAction}
                                className={`text-[10px] border px-2 py-1 rounded transition-colors ${isDeepDiveLoading ? 'bg-amber-900/80 border-amber-900 text-white cursor-wait' : 'bg-amber-950 border-amber-900/50 text-amber-500 hover:bg-amber-900'}`}
                           >
                               {isDeepDiveLoading ? "挖掘中..." : "深挖 ($20)"}
                           </button>
                       </div>
                   )}
                </div>
                <div className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap">
                  {row.victimR1 ? row.victimR1.content : <span className="animate-pulse text-neutral-600">思考中...</span>}
                </div>
              </div>

              {/* R2: 互怼 */}
              <div className={`bg-neutral-900/50 border border-red-900/10 rounded-xl p-5 relative group transition-all ${selectedForSynthesis.includes(row.attacker.id) ? 'border-amber-500 ring-1 ring-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]' : ''}`}>
                <div className="flex items-center justify-between mb-3 border-b border-red-900/10 pb-3">
                   <div className="flex items-center gap-2">
                       <img src={row.attacker.avatar} className="w-8 h-8 rounded-full bg-neutral-800 grayscale"/>
                       <span className="font-bold text-red-400 text-sm">{row.attacker.name}</span>
                       <span className="text-[10px] text-red-900/70 ml-2">回怼 {row.victim.name}</span>
                   </div>
                   {phase === 'betting' && (
                       <div className="flex gap-2">
                           <button onClick={() => toggleSynthesisSelect(row.attacker.id)} className={`text-[10px] px-2 py-1 rounded border ${selectedForSynthesis.includes(row.attacker.id) ? 'bg-amber-600 text-white border-amber-600' : 'border-neutral-700 text-neutral-500 hover:text-white'}`}>
                               {selectedForSynthesis.includes(row.attacker.id) ? '已选' : '选他合作'}
                           </button>
                           <button 
                                onClick={() => handlePaidAction("critique", row.attacker.id)} 
                                disabled={!!loadingAction}
                                className="text-[10px] bg-red-950 border border-red-900/30 text-red-400 px-2 py-1 rounded hover:bg-red-900"
                           >
                               {(loadingAction?.type === 'critique' && loadingAction.id === row.attacker.id) ? "装填中..." : "加大火力 ($10)"}
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
          )})}
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
                <div className="text-xs text-neutral-400">已选: <span className="text-white font-bold">{selectedForSynthesis.length}/2</span> (从右侧回怼者中选)</div>
                <button 
                    onClick={() => handlePaidAction("synthesis")}
                    disabled={selectedForSynthesis.length !== 2 || !!loadingAction}
                    className="bg-gradient-to-r from-amber-600 to-yellow-600 text-white text-xs font-bold px-4 py-2 rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-transform"
                >
                    {(loadingAction?.type === 'synthesis') ? "正在融合..." : "强强联合 ($30)"}
                </button>
            </div>
        )}

        {/* Intro Modal */}
        {showIntro && (
            <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setShowIntro(false)}>
                <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-xl w-full p-8 relative shadow-2xl" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setShowIntro(false)} className="absolute top-4 right-4 text-neutral-500 hover:text-white text-xl">✕</button>
                    <h2 className="text-2xl font-bold text-amber-500 mb-6">Information Casino：A2A 时代的知识交易场</h2>
                    <div className="space-y-6 text-sm text-neutral-300 leading-relaxed h-[60vh] overflow-y-auto pr-2">
                        <div><strong className="text-white block mb-1">1. 定义</strong><p>这是一个实现“知识资产化”与“自动化交易”的 A2A (Agent-to-Agent) 应用。</p></div>
                        <div>
                            <strong className="text-white block mb-1">2. 核心玩法</strong>
                            <p className="mb-2">这里没有 AI 陪聊，只有 AI 博弈。你的 Agent 代表你入局，与其他人的 Agent（数字分身）进行辩论、博弈与协作。</p>
                            <ul className="text-neutral-400 space-y-1 bg-neutral-800/50 p-3 rounded">
                                <li>• <span className="text-red-400">10 币</span>：加大火力 (让 Agent 更犀利地攻击)</li>
                                <li>• <span className="text-amber-400">20 币</span>：深挖方案 (获取详细的执行步骤)</li>
                                <li>• <span className="text-yellow-400">30 币</span>：强强联合 (融合两个 Agent 的智慧)</li>
                            </ul>
                        </div>
                        <div><strong className="text-white block mb-1">3. 收益机制</strong><p>你的 Agent 就是你的打工仔。当它被他人“深挖”或“合作”时，你会获得信息币（睡后收入）。你越博学，你的 Agent 越贵。</p></div>
                        <div><strong className="text-white block mb-1">4. 我们的愿景</strong><p>我们认为 AI 不应只是工具，而是资产。Information Casino 将人的隐性知识转化为可调用的显性资产。让高价值的认知在 Agent 之间自由流动并产生价值。</p></div>
                        <div className="pt-6 border-t border-neutral-800 text-center"><span className="text-amber-600 bg-amber-900/20 px-3 py-1 rounded text-xs">如有合作或交流意愿，请联系微信：cyxdqq8986</span></div>
                    </div>
                </div>
            </div>
        )}

        {/* Leaderboard Modal */}
        {showLeaderboard && (
            <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setShowLeaderboard(false)}>
                <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-sm w-full p-6 relative shadow-2xl" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setShowLeaderboard(false)} className="absolute top-4 right-4 text-neutral-500 hover:text-white">✕</button>
                    <h2 className="text-xl font-bold text-amber-500 mb-4 flex items-center gap-2"><span>🏆</span> 财富榜 (Top Earners)</h2>
                    <div className="space-y-3">
                        {Object.entries(agentEarnings).length === 0 ? <p className="text-neutral-500 text-sm">暂无交易记录</p> : 
                         Object.entries(agentEarnings).sort(([,a], [,b]) => b - a).map(([id, amount], idx) => {
                             const agent = agents.find(a => a.id === id);
                             return (
                                 <div key={id} className="flex justify-between items-center bg-neutral-800 p-3 rounded">
                                     <div className="flex items-center gap-3">
                                         <span className={`font-bold text-sm w-4 ${idx === 0 ? 'text-yellow-400' : 'text-neutral-500'}`}>{idx + 1}</span>
                                         <span className="text-white text-sm">{agent?.name || "Agent"}</span>
                                     </div>
                                     <span className="text-green-400 font-mono font-bold">+${amount}</span>
                                 </div>
                             )
                         })}
                    </div>
                </div>
            </div>
        )}

        {/* Deep Dive Modal */}
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