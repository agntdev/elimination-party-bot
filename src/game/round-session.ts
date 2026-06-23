export type RoundSessionState = {
  groupId: number;
  stake: number;
  state: "open" | "countdown" | "complete" | "cancelled";
  joinList: number[];
  joinWindowStartedAt?: string;
  joinWindowExpiresAt?: string;
};

export interface RoundSessionContainer {
  currentRound?: RoundSessionState;
}

export function storeRoundSession(
  session: RoundSessionContainer,
  state: RoundSessionState,
): void {
  session.currentRound = {
    ...state,
    joinList: [...state.joinList],
  };
}
