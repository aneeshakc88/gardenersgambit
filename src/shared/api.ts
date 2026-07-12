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
  { metric: "streak", value: 7, label: "Reach a 7-day streak" },
  { metric: "published", value: 3, label: "Publish 3 levels" },
];

export const FOX_UNLOCKS: (SkinUnlock | null)[] = [
  null,
  { metric: "completions", value: 5, label: "Solve 5 puzzles" },
  { metric: "completions", value: 20, label: "Solve 20 puzzles" },
  { metric: "streak", value: 14, label: "Reach a 14-day streak" },
  { metric: "published", value: 5, label: "Publish 5 levels" },
];

export function unlockedIndices(unlocks: (SkinUnlock | null)[], stats: UnlockStats): number[] {
  const out: number[] = [];
  unlocks.forEach((u, i) => {
    if (u === null || stats[u.metric] >= u.value) out.push(i);
  });
  return out;
}
