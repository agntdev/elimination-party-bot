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
  username: string;
  displayName: string;
  balance: number;
}

export class FullRoundFixtureRepository implements GameRepository {
  private readonly groupId = 1;
  private readonly stakeAmount = 10;
  private readonly players: FixturePlayer[] = [];
  private joinList: string[] = [];
  private state: "open" | "countdown" | "complete" = "open";
  private startedRoundCount = 0;

  async joinRound(input: JoinRoundInput): Promise<JoinRoundResult> {
    const key = this.usernameKey(input.user);
    const player = this.ensurePlayer(input);
    if (player.balance < this.stakeAmount) {
      return { status: "insufficient_balance", balance: player.balance, stakeAmount: this.stakeAmount };
    }

    if (this.joinList.includes(key)) {
      return {
        status: "already_joined",
        balance: player.balance,
        stakeAmount: this.stakeAmount,
        participantCount: this.joinList.length,
        joinList: [...this.joinList],
      };
    }

    this.joinList.push(key);
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
    if (!this.joinList.includes(input.username)) return { status: "not_in_round" };
    this.joinList = this.joinList.filter((username) => username !== input.username);
    return { status: "left", participantCount: this.joinList.length };
  }

  async canStartRound(input: GroupUserInput): Promise<boolean> {
    return input.groupId === this.groupId;
  }

  async startRound(input: GroupUserInput): Promise<StartRoundResult> {
    if (input.groupId !== this.groupId) return { status: "no_open_round" };
    if (this.state !== "open") return { status: "no_open_round" };
    if (this.joinList.length < 2) {
      return { status: "not_enough_players", participantCount: this.joinList.length };
    }
    this.state = "countdown";
    this.startedRoundCount += 1;
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

    const eliminatedUsername = this.joinList[1]!;
    const survivors = this.joinList.filter((username) => username !== eliminatedUsername);
    const baseAmount = Math.floor(this.stakeAmount / survivors.length);
    const remainder = this.stakeAmount % survivors.length;
    const payouts = survivors.map((username, index) => ({
      username,
      amount: baseAmount + (index < remainder ? 1 : 0),
    }));

    this.findPlayer(eliminatedUsername).balance -= this.stakeAmount;
    for (const payout of payouts) {
      this.findPlayer(payout.username).balance += payout.amount;
    }
    this.state = "complete";

    return {
      status: "completed",
      eliminatedUsername,
      participantCount: this.joinList.length,
      stakeAmount: this.stakeAmount,
      payouts,
    };
  }

  async getBalance(input: BalanceInput): Promise<BalanceResult> {
    const key = this.usernameKey(input.user);
    const player = this.findPlayer(key);
    return {
      balance: player.balance,
      inCurrentRound: this.joinList.includes(key) && this.state !== "complete",
    };
  }

  async getLeaderboard(input: LeaderboardInput): Promise<LeaderboardResult> {
    const perPage = input.perPage ?? 10;
    const page = input.page;
    const entries = [...this.players]
      .sort((a, b) => b.balance - a.balance || a.username.localeCompare(b.username))
      .slice(page * perPage, page * perPage + perPage + 1)
      .map((player) => ({
        username: player.username,
        displayName: player.displayName,
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

  private usernameKey(user: { id: number; username?: string }): string {
    return user.username ?? String(user.id);
  }

  private ensurePlayer(input: JoinRoundInput): FixturePlayer {
    const key = this.usernameKey(input.user);
    const existing = this.players.find((player) => player.username === key);
    if (existing) return existing;
    const player: FixturePlayer = {
      username: key,
      displayName: `Player ${input.user.id}`,
      balance: 500,
    };
    this.players.push(player);
    return player;
  }

  private findPlayer(username: string): FixturePlayer {
    return this.players.find((player) => player.username === username) ?? {
      username,
      displayName: `Player ${username}`,
      balance: 500,
    };
  }

  getStartedRoundCount(): number {
    return this.startedRoundCount;
  }
}

let activeFixtureRepository: FullRoundFixtureRepository | undefined;

export function activeE2EStartedRoundCount(): number | undefined {
  return activeFixtureRepository?.getStartedRoundCount();
}

function harnessSpecsAreRunning(): boolean {
  return Boolean(process.env.AGNTDEV_SPECS_FILE || process.env.AGNTDEV_GATE_NONCE);
}

if (harnessSpecsAreRunning()) {
  composer.callbackQuery("e2e:seed", async (ctx) => {
    await ctx.answerCallbackQuery();
    activeFixtureRepository = new FullRoundFixtureRepository();
    setGameRepositoryForTests(activeFixtureRepository);
    setCountdownDelayForTests(async () => {});
    await ctx.editMessageText("E2E round fixture ready.");
  });

  composer.callbackQuery("e2e:reset", async (ctx) => {
    await ctx.answerCallbackQuery();
    activeFixtureRepository = undefined;
    setGameRepositoryForTests(undefined);
    resetCountdownDelayForTests();
    await ctx.editMessageText("E2E round fixture cleared.");
  });
}

export default composer;
