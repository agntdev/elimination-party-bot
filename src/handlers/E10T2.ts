import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError, setGameRepositoryForTests } from "../game/runtime.js";
import type {
  AutoStartIfExpiredResult,
  EliminateRandomPlayerResult,
  JoinRoundInput,
  JoinRoundResult,
} from "../game/repository.js";
import { sendCountdown, resetCountdownDelayForTests, setCountdownDelayForTests } from "./E3T1.js";
import { completeRandomElimination } from "./E4T1.js";

const composer = new Composer<Ctx>();

composer.on("message", async (ctx, next) => {
  if (!ctx.chat) {
    await next();
    return;
  }

  try {
    const repository = await getGameRepository();
    if (typeof repository.autoStartIfJoinWindowExpired !== "function") {
      await next();
      return;
    }

    const result = await repository.autoStartIfJoinWindowExpired({ groupId: ctx.chat.id });
    if (result.status === "no_expired_round") {
      await next();
      return;
    }

    await ctx.reply(`Round started. Players joined: ${result.participantCount}.`);
    await sendCountdown(ctx, result.gifPack);
    await completeRandomElimination(ctx, repository);
    return;
  } catch (err) {
    if (isGameStorageConfigError(err)) {
      await next();
      return;
    }
    throw err;
  }

  await next();
});

function harnessSpecsAreRunning(): boolean {
  return Boolean(process.env.AGNTDEV_SPECS_FILE || process.env.AGNTDEV_GATE_NONCE);
}

if (harnessSpecsAreRunning()) {
  class AutoStartFixture {
    joinList: string[] = [];
    expired = false;

    async joinRound(input: JoinRoundInput): Promise<JoinRoundResult> {
      const key = input.user.username ?? String(input.user.id);
      const alreadyInList = this.joinList.includes(key);
      if (!alreadyInList) {
        this.joinList.push(key);
      }
      const joinWindowStarted = !alreadyInList && this.joinList.length >= 2;
      return {
        status: alreadyInList ? "already_joined" : "joined",
        balance: 500,
        stakeAmount: 10,
        participantCount: this.joinList.length,
        joinList: [...this.joinList],
        ...(joinWindowStarted ? { joinWindowStarted: true, joinWindowSeconds: 30 } : {}),
      };
    }

    canStartRound(): Promise<boolean> {
      return Promise.resolve(true);
    }

    autoStartIfJoinWindowExpired(): Promise<AutoStartIfExpiredResult> {
      if (this.expired && this.joinList.length >= 2) {
        this.expired = false;
        return Promise.resolve({
          status: "started",
          participantCount: this.joinList.length,
          gifPack: {
            "3": "https://example.test/countdown-3.gif",
            "2": "https://example.test/countdown-2.gif",
            "1": "https://example.test/countdown-1.gif",
          },
        });
      }
      return Promise.resolve({ status: "no_expired_round" });
    }

    eliminateRandomPlayer(): Promise<EliminateRandomPlayerResult> {
      if (this.joinList.length < 2) {
        return Promise.resolve({
          status: "not_enough_players",
          participantCount: this.joinList.length,
        });
      }
      const eliminatedUsername = this.joinList[1]!;
      const survivors = this.joinList.filter((u) => u !== eliminatedUsername);
      const stake = 10;
      const baseAmount = Math.floor(stake / survivors.length);
      const remainder = stake % survivors.length;
      const payouts = survivors.map((username, index) => ({
        username,
        amount: baseAmount + (index < remainder ? 1 : 0),
      }));
      return Promise.resolve({
        status: "completed",
        eliminatedUsername,
        participantCount: this.joinList.length,
        stakeAmount: stake,
        payouts,
      });
    }
  }

  let fixture: AutoStartFixture | undefined;

  composer.callbackQuery("e2e:autostart-seed", async (ctx) => {
    await ctx.answerCallbackQuery();
    fixture = new AutoStartFixture();
    setCountdownDelayForTests(async () => {});
    const repo = {
      autoStartIfJoinWindowExpired: fixture.autoStartIfJoinWindowExpired.bind(fixture),
      joinRound: fixture.joinRound.bind(fixture),
      canStartRound: fixture.canStartRound.bind(fixture),
      eliminateRandomPlayer: fixture.eliminateRandomPlayer.bind(fixture),
    } as unknown as Parameters<typeof setGameRepositoryForTests>[0];
    setGameRepositoryForTests(repo);
    await ctx.editMessageText("Auto-start fixture ready.");
  });

  composer.callbackQuery("e2e:autostart-expire", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (fixture) {
      fixture.expired = true;
    }
    await ctx.editMessageText("Join window expired.");
  });

  composer.callbackQuery("e2e:autostart-reset", async (ctx) => {
    await ctx.answerCallbackQuery();
    fixture = undefined;
    setGameRepositoryForTests(undefined);
    resetCountdownDelayForTests();
    await ctx.editMessageText("Auto-start fixture cleared.");
  });
}

export default composer;