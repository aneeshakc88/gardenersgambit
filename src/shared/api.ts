export type InitResponse = {
  type: "init";
  postId: string;
  count: number;
  username: string;
  puzzleNumber?: number;
  snoovatarUrl?: string;
  userRank?: number;
  userScore?: number;
  totalPlayers?: number;
  topPlayer?: { username: string; score: number; snoovatarUrl?: string };
  streak?: number;
  globalRank?: number;
  globalScore?: number;
  globalTotalPlayers?: number;
  unlockedGardener?: number[];
  unlockedFox?: number[];
  customMap?: {
    title: string;
    author: string;
    authorSnoovatarUrl?: string;
    grid?: number[][];
    cols?: number;
    rows?: number;
    gardenerSkin?: number;
    foxSkin?: number;
  } | null;
};

export type IncrementResponse = {
  type: "increment";
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: "decrement";
  postId: string;
  count: number;
};

export type PostScoreResponse = {
  type: "postScore";
  username: string;
  score: number;
};

export type PublishMapResponse = {
  type: "publishMap";
  postId: string;
  postUrl: string;
  author: string;
};

export type ScoreBucket = { min: number; count: number; overflow?: boolean };

export type SubmitScoreResponse = {
  type: "submitScore";
  submitted: boolean;
  yourScore: number;
  rank: number;
  total: number;
  buckets: ScoreBucket[];
  streak?: number;
  globalRank?: number;
  globalScore?: number;
};

export type LeaderboardEntry = {
  rank: number;
  username: string;
  score: number;
  snoovatarUrl?: string;
};

export type LeaderboardResponse = {
  type: "leaderboard";
  scope: "puzzle" | "global";
  entries: LeaderboardEntry[];
};

// ── Skin unlocks ────────────────────────────────────────────────────────────
// Index 0 of each skin list is always free (null). Others unlock on a milestone.
export type SkinUnlock = { metric: "completions" | "streak" | "published"; value: number; label: string };
export type UnlockStats = { completions: number; streak: number; published: number };

export const GARDENER_UNLOCKS: (SkinUnlock | null)[] = [
  null,
  { metric: "completions", value: 3, label: "Solve 3 puzzles" },
  { metric: "completions", value: 10, label: "Solve 10 puzzles" },
];

export const FOX_UNLOCKS: (SkinUnlock | null)[] = [
  null,
  { metric: "completions", value: 5, label: "Solve 5 puzzles" },
  { metric: "completions", value: 20, label: "Solve 20 puzzles" },
];

export function unlockedIndices(unlocks: (SkinUnlock | null)[], stats: UnlockStats): number[] {
  const out: number[] = [];
  unlocks.forEach((u, i) => {
    if (u === null || stats[u.metric] >= u.value) out.push(i);
  });
  return out;
}

// ── Completion tiers (drives user flair) ────────────────────────────────────
export type Tier = { name: string; icon: string; min: number };

export const TIERS: Tier[] = [
  { name: "Novice", icon: "🪿", min: 0 },
  { name: "Bronze", icon: "🥉", min: 5 },
  { name: "Silver", icon: "🥈", min: 15 },
  { name: "Gold", icon: "🥇", min: 30 },
  { name: "Diamond", icon: "💎", min: 50 },
  { name: "Legend", icon: "👑", min: 100 },
];

export function tierFor(completions: number): Tier {
  let tier = TIERS[0]!;
  for (const t of TIERS) if (completions >= t.min) tier = t;
  return tier;
}
