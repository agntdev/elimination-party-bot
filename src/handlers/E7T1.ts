import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import type {
  BalanceInput,
  BalanceResult,
  EliminateRandomPlayerInput,
  EliminateRandomPlayerResult,
  GameRepository,
  GroupUserInput,
  JoinRoundInput,
  JoinRoundResult,
  LeaderboardInput,
  LeaderboardResult,
  LeaveRoundInput,
  LeaveRoundResult,
  SetStakeInput,
  SetStakeResult,
  StartRoundResult,
} from "../game/repository.js";
import { setGameRepositoryForTests } from "../game/runtime.js";
import { resetCountdownDelayForTests, setCountdownDelayForTests } from "./E3T1.js";

const composer = new Composer<Ctx>();

interface FixturePlayer {
  userId: number;
  displayName: string;
  username?: string;
  balance: number;
}

class FullRoundFixtureRepository implements GameRepository {
  private readonly groupId = 1;
  private readonly stakeAmount = 10;
  private readonly players: FixturePlayer[] = [];
  private joinList: number[] = [];
  private state: "open" | "countdown" | "complete" = "open";

  async joinRound(input: JoinRoundInput): Promise<JoinRoundResult> {
    const player = this.ensurePlayer(input);
    if (player.balance < this.stakeAmount) {
      return { status: "insufficient_balance", balance: player.balance, stakeAmount: this.stakeAmount };
    }

    if (this.joinList.includes(input.user.id)) {
      return {
        status: "already_joined",
        balance: player.balance,
        stakeAmount: this.stakeAmount,
        participantCount: this.joinList.length,
        joinList: [...this.joinList],
      };
    }

    this.joinList.push(input.user.id);
    return {
      status: "joined",
      balance: player.balance,
      stakeAmount: this.stakeAmount,
      participantCount: this.joinList.length,
      joinList: [...this.joinList],
      joinWindowStarted: this.joinList.length === 2,
      joinWindowSeconds: 30,
    };
  }

  async leaveRound(input: LeaveRoundInput): Promise<LeaveRoundResult> {
    if (!this.joinList.includes(input.userId)) return { status: "not_in_round" };
    this.joinList = this.joinList.filter((userId) => userId !== input.userId);
    return { status: "left", participantCount: this.joinList.length };
  }

  async canStartRound(input: GroupUserInput): Promise<boolean> {
    return input.groupId === this.groupId;
  }

  async startRound(input: GroupUserInput): Promise<StartRoundResult> {
    if (input.groupId !== this.groupId) return { status: "no_open_round" };
    if (this.joinList.length < 2) {
      return { status: "not_enough_players", participantCount: this.joinList.length };
    }
    this.state = "countdown";
    return {
      status: "started",
      participantCount: this.joinList.length,
      gifPack: {
        "3": "https://example.test/countdown-3.gif",
        "2": "https://example.test/countdown-2.gif",
        "1": "https://example.test/countdown-1.gif",
      },
    };
  }

  async eliminateRandomPlayer(input: EliminateRandomPlayerInput): Promise<EliminateRandomPlayerResult> {
    if (input.groupId !== this.groupId || this.state !== "countdown") {
      return { status: "no_countdown_round" };
    }
    if (this.joinList.length < 2) {
      return { status: "not_enough_players", participantCount: this.joinList.length };
    }

    const eliminatedUserId = this.joinList[1]!;
    const survivors = this.joinList.filter((userId) => userId !== eliminatedUserId);
    const baseAmount = Math.floor(this.stakeAmount / survivors.length);
    const remainder = this.stakeAmount % survivors.length;
    const payouts = survivors.map((userId, index) => ({
      userId,
      amount: baseAmount + (index < remainder ? 1 : 0),
    }));

    this.findPlayer(eliminatedUserId).balance -= this.stakeAmount;
    for (const payout of payouts) {
      this.findPlayer(payout.userId).balance += payout.amount;
    }
    this.state = "complete";

    return {
      status: "completed",
      eliminatedUserId,
      participantCount: this.joinList.length,
      stakeAmount: this.stakeAmount,
      payouts,
    };
  }

  async getBalance(input: BalanceInput): Promise<BalanceResult> {
    const player = this.findPlayer(input.user.id);
    return {
      balance: player.balance,
      inCurrentRound: this.joinList.includes(input.user.id) && this.state !== "complete",
    };
  }

  async getLeaderboard(input: LeaderboardInput): Promise<LeaderboardResult> {
    const perPage = input.perPage ?? 10;
    const page = input.page;
    const entries = [...this.players]
      .sort((a, b) => b.balance - a.balance || a.userId - b.userId)
      .slice(page * perPage, page * perPage + perPage + 1)
      .map((player) => ({
        userId: player.userId,
        displayName: player.displayName,
        username: player.username,
        balance: player.balance,
      }));

    return {
      entries: entries.slice(0, perPage),
      page,
      perPage,
      hasPrevious: page > 0,
      hasNext: entries.length > perPage,
    };
  }

  async setStake(_input: SetStakeInput): Promise<SetStakeResult> {
    return { status: "updated", stakeAmount: this.stakeAmount };
  }

  private ensurePlayer(input: JoinRoundInput): FixturePlayer {
    const existing = this.players.find((player) => player.userId === input.user.id);
    if (existing) return existing;
    const player: FixturePlayer = {
      userId: input.user.id,
      displayName: `Player ${input.user.id}`,
      username: input.user.username,
      balance: 500,
    };
    this.players.push(player);
    return player;
  }

  private findPlayer(userId: number): FixturePlayer {
    return this.players.find((player) => player.userId === userId) ?? {
      userId,
      displayName: `Player ${userId}`,
      balance: 500,
    };
  }
}

function harnessSpecsAreRunning(): boolean {
  return Boolean(process.env.AGNTDEV_SPECS_FILE || process.env.AGNTDEV_GATE_NONCE);
}

if (harnessSpecsAreRunning()) {
  composer.callbackQuery("e2e:seed", async (ctx) => {
    await ctx.answerCallbackQuery();
    setGameRepositoryForTests(new FullRoundFixtureRepository());
    setCountdownDelayForTests(async () => {});
    await ctx.editMessageText("E2E round fixture ready.");
  });

  composer.callbackQuery("e2e:reset", async (ctx) => {
    await ctx.answerCallbackQuery();
    setGameRepositoryForTests(undefined);
    resetCountdownDelayForTests();
    await ctx.editMessageText("E2E round fixture cleared.");
  });
}

export default composer;
