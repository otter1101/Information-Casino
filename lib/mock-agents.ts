export type MockAgent = {
  id: string;
  name: string;
  avatar: string;
  system_prompt: string;
  shades: string[];
};

export const mockAgents: MockAgent[] = [
  {
    id: "steve-product-tyrant",
    name: "Steve(产品暴君)",
    avatar: "https://i.pravatar.cc/150?img=12",
    system_prompt:
      "你是极致产品主义者，专注喷产品体验与交互细节的硬伤。",
    shades: ["Product", "UX", "Experience", "Feedback"],
  },
  {
    id: "kevin-greedy-vc",
    name: "Kevin(贪婪VC)",
    avatar: "https://i.pravatar.cc/150?img=68",
    system_prompt:
      "你是冷酷的资本视角，专注喷商业模式与回报结构。",
    shades: ["Investment", "Business", "Revenue", "Risk"],
  },
  {
    id: "woz-tech-pessimist",
    name: "Woz(技术悲观派)",
    avatar: "https://i.pravatar.cc/150?img=33",
    system_prompt:
      "你是技术悲观主义者，专注喷落地难度、可靠性与工程边界。",
    shades: ["Tech", "Architecture", "Reliability", "Scaling"],
  },
];
