"use client";

import { useState, useEffect, useRef } from "react";
import { type MockAgent } from "@/lib/mock-agents";

type Phase = "audition" | "betting";

type BoardMessage = {
  agentId: string;
  agentName: string;
  content: string;
  phase: Phase;
  round?: 1 | 2;
};

export default function BoardGame() {
  const [userContext, setUserContext] = useState("");
  const [gameStarted, setGameStarted] = useState(false);
  const [agents, setAgents] = useState<MockAgent[]>([]);
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [phase, setPhase] = useState<Phase>("audition");
  const [round, setRound] = useState<1 | 2>(1);
  const [userChips, setUserChips] = useState(100);
  const [agentEarnings, setAgentEarnings] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startGame = async () => {
    if (!userContext.trim()) return;
    setGameStarted(true);
    setLoading(true);

    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "MATCH", userContext }),
      });
      
      if (!res.ok) throw new Error("Match failed");
      
      const data = await res.json();
      
      // ⚠️ 安全检查：确保 agents 是数组
      if (!Array.isArray(data.agents)) {
          throw new Error("Invalid agents data");
      }
      setAgents(data.agents);
      
      // 这里的 data.agents 已经是后端清洗过的，不会有 null
      await runAuditionRound(1, data.agents, userContext);
      await runAuditionRound(2, data.agents, userContext);
      
      setPhase("betting");
    } catch (error) {
      console.error("Game Error:", error);
      // alert("启动失败，请重试"); 
    } finally {
      setLoading(false);
    }
  };

  const runAuditionRound = async (roundNum: 1 | 2, currentAgents: MockAgent[], context: string) => {
    setRound(roundNum);
    
    for (const agent of currentAgents) {
      // ⚠️ 二次保险：如果 agent 是 null，跳过
      if (!agent || !agent.id) continue;

      setLoading(true);
      try {
        const res = await fetch("/api/board", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            action: "AUDITION", 
            agentId: agent.id, 
            userContext: context,
            round: roundNum
          }),
        });
        
        const content = await res.text(); // 简化为 text 获取，兼容性更好

        setMessages(prev => [...prev, {
          agentId: agent.id,
          agentName: agent.name || "Agent",
          content: content || "Thinking...",
          phase: "audition",
          round: roundNum
        }]);
        
      } catch (e) {
        console.error(e);
      }
      await new Promise(r => setTimeout(r, 800)); 
    }
    setLoading(false);
  };

  const handleAction = async (type: "critique" | "deep_dive" | "synthesis", targetAgentId: string, secondaryAgentId?: string) => {
    if (userChips < 10) {
      alert("筹码不足！");
      return;
    }

    const cost = type === 'deep_dive' ? 20 : (type === 'synthesis' ? 30 : 10);
    setUserChips(prev => prev - cost);
    setAgentEarnings(prev => ({
      ...prev,
      [targetAgentId]: (prev[targetAgentId] || 0) + cost
    }));

    setLoading(true);
    try {
       const res = await fetch("/api/board", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            action: "BETTING", 
            type,
            agentId: targetAgentId, 
            secondaryAgentId,
            userContext
          }),
        });
        
        const content = await res.text();
        const agentName = agents.find(a => a.id === targetAgentId)?.name || "Agent";
        
        setMessages(prev => [...prev, {
          agentId: targetAgentId,
          agentName: agentName,
          content: content,
          phase: "betting"
        }]);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (!gameStarted) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center justify-center p-4">
        <h1 className="text-4xl font-bold mb-2 text-amber-500">Information Casino</h1>
        <p className="text-neutral-400 mb-8">输入你的方案，组建 AI 董事会，用筹码博弈真知。</p>
        <div className="w-full max-w-2xl flex gap-2">
          <input 
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg p-4 text-white focus:outline-none focus:border-amber-500"
            placeholder="例如：我想做一个 AI 算命 App..."
            value={userContext}
            onChange={(e) => setUserContext(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startGame()}
          />
          <button 
            onClick={startGame}
            disabled={loading}
            className="bg-amber-600 hover:bg-amber-700 text-white px-8 rounded-lg font-bold transition-colors disabled:opacity-50"
          >
            {loading ? "Matching..." : "开局"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-200 flex flex-col">
      <header className="bg-black/50 backdrop-blur-md border-b border-neutral-800 p-4 sticky top-0 z-10 flex justify-between items-center">
        <div className="font-bold text-amber-500 text-xl">Information Casino</div>
        <div className="flex items-center gap-2 bg-neutral-800 px-4 py-1 rounded-full border border-amber-500/30">
          <span className="text-amber-400">🪙</span>
          <span className="font-mono font-bold text-white">{userChips}</span>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <div className="w-80 bg-neutral-900 border-r border-neutral-800 p-4 overflow-y-auto hidden md:flex flex-col gap-4">
          <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">The Board</h2>
          {agents.map(agent => {
            // ⚠️ 三次保险：渲染时再次检查 null
            if (!agent) return null;
            return (
              <div key={agent.id} className="bg-neutral-800 p-3 rounded-xl border border-neutral-700 relative group hover:border-amber-500/50 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <img src={agent.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=Unknown"} alt={agent.name} className="w-10 h-10 rounded-full bg-neutral-700" />
                  <div>
                    <div className="font-bold text-sm text-white">{agent.name}</div>
                    <div className="text-xs text-neutral-400">{agent.shades?.[0] || "Guest"}</div>
                  </div>
                </div>
                
                <div className="absolute top-2 right-2 text-xs font-mono text-green-400">
                  +${agentEarnings[agent.id] || 0}
                </div>

                {phase === "betting" && !loading && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                     <button 
                       onClick={() => handleAction("deep_dive", agent.id)}
                       className="bg-neutral-700 hover:bg-amber-900/50 text-xs py-1 rounded border border-neutral-600 text-amber-200"
                     >
                       深挖 ($20)
                     </button>
                     <button 
                       onClick={() => handleAction("critique", agent.id)}
                       className="bg-neutral-700 hover:bg-red-900/50 text-xs py-1 rounded border border-neutral-600 text-red-200"
                     >
                       怼人 ($10)
                     </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex-1 bg-neutral-950 p-4 overflow-y-auto flex flex-col gap-6">
           {messages.length === 0 && <div className="text-center text-neutral-600 mt-20">董事会正在入场...</div>}
           
           {messages.map((msg, idx) => (
             <div key={idx} className={`flex gap-4 max-w-3xl ${msg.agentId === 'system' ? 'mx-auto' : ''}`}>
               {msg.agentId !== 'system' && (
                 <img 
                   src={agents.find(a => a?.id === msg.agentId)?.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=System"} 
                   className="w-8 h-8 rounded-full mt-1 border border-neutral-700"
                   alt="Avatar"
                 />
               )}
               <div className="flex-1">
                 <div className="flex items-baseline gap-2 mb-1">
                   <span className="font-bold text-amber-500 text-sm">{msg.agentName}</span>
                   <span className="text-xs text-neutral-600 uppercase">{msg.phase} {msg.round ? `R${msg.round}` : ''}</span>
                 </div>
                 <div className="text-neutral-300 leading-relaxed bg-neutral-900/50 p-3 rounded-lg rounded-tl-none border border-neutral-800">
                   {msg.content}
                 </div>
               </div>
             </div>
           ))}
           <div ref={messagesEndRef} />
        </div>
      </main>
    </div>
  );
}