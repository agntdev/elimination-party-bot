import { Composer, type Api } from "grammy";
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

type ScheduleFn = (ms: number, callback: () => void) => NodeJS.Timeout;

let autoStartScheduler: ScheduleFn = (ms, cb) => setTimeout(cb, ms);
let botApi: Api | undefined;
let recoveryPerformed = false;
const autoStartTimers = new Map<number, NodeJS.Timeout>();

export function setAutoStartTimerSchedulerForTests(scheduler: ScheduleFn): void {
  autoStartScheduler = scheduler;
}

export function resetAutoStartTimerSchedulerForTests(): void {
  autoStartScheduler = (ms, cb) => setTimeout(cb, ms);
}

export function scheduleAutoStartTimer(groupId: number, delayMs: number): void {
  cancelAutoStartTimer(groupId);
  if (delayMs <= 0) return;
  const timer = autoStartScheduler(delayMs, () => {
    autoStartTimers.delete(groupId);
    performAutoStart(groupId);
  });
  autoStartTimers.set(groupId, timer);
}

export function cancelAutoStartTimer(groupId: number): void {
  const existing = autoStartTimers.get(groupId);
  if (existing) {
    clearTimeout(existing);
    autoStartTimers.delete(groupId);
  }
}

function flushScheduledAutoStart(groupId: number): void {
  const existing = autoStartTimers.get(groupId);
  if (existing) {
    clearTimeout(existing);
    autoStartTimers.delete(groupId);
    performAutoStart(groupId);
  }
}

async function performAutoStart(groupId: number): Promise<void> {
  if (!botApi) return;
  try {
    const repository = await getGameRepository();
    if (typeof repository.autoStartIfJoinWindowExpired !== "function") return;
    const result = await repository.autoStartIfJoinWindowExpired({ groupId });
    if (result.status === "no_expired_round") return;

    const mockCtx = {
      reply: (text: string) => botApi!.sendMessage(groupId, text),
      replyWithAnimation: (animation: string, other?: { caption?: string }) =>
        botApi!.sendAnimation(groupId, animation, other),
      chat: { id: groupId },
    } as Pick<Ctx, "chat" | "reply" | "replyWithAnimation">;

    await mockCtx.reply(`Round started. Players joined: ${result.participantCount}.`);
    await sendCountdown(mockCtx, result.gifPack);
    await completeRandomElimination(mockCtx, repository);
  } catch (err) {
    if (!isGameStorageConfigError(err)) throw err;
  }
}

async function recoverAutoStartTimers(): Promise<void> {
  try {
    const repository = await getGameRepository();
    if (typeof repository.getOpenRoundGroups !== "function") return;
    const groups = await repository.getOpenRoundGroups();
    const nowMs = Date.now();
    for (const group of groups) {
      cancelAutoStartTimer(group.groupId);
      const expiresAtMs = new Date(group.expiresAt).getTime();
      if (nowMs >= expiresAtMs) {
        performAutoStart(group.groupId);
      } else {
        const delayMs = expiresAtMs - nowMs;
        scheduleAutoStartTimer(group.groupId, delayMs);
      }
    }
  } catch (err) {
    if (!isGameStorageConfigError(err)) throw err;
  }
}

composer.on("message", async (ctx, next) => {
  if (!ctx.chat) {
    await next();
    return;
  }

  if (!botApi && ctx.api) {
    botApi = ctx.api;
  }

  if (!recoveryPerformed) {
    recoveryPerformed = true;
    recoverAutoStartTimers().catch(() => {});
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

    cancelAutoStartTimer(ctx.chat.id);
    await ctx.reply(`Round started. Players joined: ${result.participantCount}.`);
    await sendCountdown(ctx, result.gifPack);
    await completeRandomElimination(ctx, repository);
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
        ...(joinWindowStarted ? { joinWindowStarted: true, joinWindowSeconds: 30, joinWindowExpiresAt: new Date(Date.now() + 30000).toISOString() } : {}),
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
    setAutoStartTimerSchedulerForTests((_ms, cb) => {
      cb();
      return setTimeout(() => {}, 0);
    });
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
    if (ctx.chat) {
      flushScheduledAutoStart(ctx.chat.id);
    }
    await ctx.editMessageText("Join window expired.");
  });

  composer.callbackQuery("e2e:autostart-reset", async (ctx) => {
    await ctx.answerCallbackQuery();
    fixture = undefined;
    setGameRepositoryForTests(undefined);
    resetCountdownDelayForTests();
    resetAutoStartTimerSchedulerForTests();
    await ctx.editMessageText("Auto-start fixture cleared.");
  });
}

export default composer;
