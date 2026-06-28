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

export type ScoreBucket = { min: number; count: number };

export type SubmitScoreResponse = {
  type: "submitScore";
  submitted: boolean;
  yourScore: number;
  rank: number;
  total: number;
  buckets: ScoreBucket[];
};

export type LeaderboardEntry = {
  rank: number;
  username: string;
  score: number;
  snoovatarUrl?: string;
};

export type LeaderboardResponse = {
  type: "leaderboard";
  entries: LeaderboardEntry[];
};
