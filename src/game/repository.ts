export interface TelegramUserRef {
  id: number;
  username?: string;
  displayName: string;
}

export interface JoinRoundInput {
  groupId: number;
  groupName?: string;
  user: TelegramUserRef;
}

export type BalanceInput = JoinRoundInput;

export interface BalanceResult {
  balance: number;
  inCurrentRound: boolean;
}

export interface LeaveRoundInput {
  groupId: number;
  userId: number;
}

export interface GroupUserInput {
  groupId: number;
  userId: number;
}

export interface LeaderboardInput {
  groupId: number;
  page: number;
  perPage?: number;
}

export interface LeaderboardEntry {
  userId: number;
  displayName: string;
  username?: string;
  balance: number;
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  page: number;
  perPage: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface SetStakeInput {
  groupId: number;
  groupName?: string;
  userId: number;
  amount: number;
}

export type SetStakeResult =
  | {
      status: "updated";
      stakeAmount: number;
    }
  | {
      status: "not_creator";
    };

export type CountdownGifPack = Record<string, string>;

export type JoinRoundResult =
  | {
      status: "joined" | "already_joined";
      balance: number;
      stakeAmount: number;
      participantCount: number;
      joinList: number[];
      joinWindowStarted?: boolean;
      joinWindowSeconds?: number;
      joinWindowStartedAt?: string;
      joinWindowExpiresAt?: string;
    }
  | {
      status: "insufficient_balance";
      balance: number;
      stakeAmount: number;
    };

export type LeaveRoundResult =
  | {
      status: "left";
      participantCount: number;
    }
  | {
      status: "not_in_round";
    };

export type StartRoundResult =
  | {
      status: "started";
      participantCount: number;
      gifPack: CountdownGifPack;
    }
  | {
      status: "not_creator";
    }
  | {
      status: "no_open_round";
    }
  | {
      status: "not_enough_players";
      participantCount: number;
    };

export interface EliminateRandomPlayerInput {
  groupId: number;
}

export interface StakePayout {
  userId: number;
  amount: number;
}

export type EliminateRandomPlayerResult =
  | {
      status: "completed";
      eliminatedUserId: number;
      participantCount: number;
      stakeAmount: number;
      payouts: StakePayout[];
    }
  | {
      status: "no_countdown_round";
    }
  | {
      status: "not_enough_players";
      participantCount: number;
    };

export interface GameRepository {
  joinRound(input: JoinRoundInput): Promise<JoinRoundResult>;
  leaveRound(input: LeaveRoundInput): Promise<LeaveRoundResult>;
  canStartRound(input: GroupUserInput): Promise<boolean>;
  startRound(input: GroupUserInput): Promise<StartRoundResult>;
  eliminateRandomPlayer(input: EliminateRandomPlayerInput): Promise<EliminateRandomPlayerResult>;
  getBalance(input: BalanceInput): Promise<BalanceResult>;
  getLeaderboard(input: LeaderboardInput): Promise<LeaderboardResult>;
  setStake(input: SetStakeInput): Promise<SetStakeResult>;
}
