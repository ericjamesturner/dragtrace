export const RACE_ROUNDS = [
  {
    id: "round16",
    name: "Round of 16",
    shortName: "Round of 16",
    cars: 16,
    minimum: "$250",
    range: "$250–$1,000",
    description:
      "Both racers start with $1,000. Agree on any wager in this range.",
    a: 1000,
    b: 1000,
    wager: 600,
  },
  {
    id: "quarterfinal",
    name: "Quarterfinals",
    shortName: "Quarters",
    cars: 8,
    minimum: "50%",
    range: "50–100%",
    description: "At least half of the short stack. You can agree to bet more.",
    a: 2000,
    b: 1400,
    wager: 900,
  },
  {
    id: "semifinal",
    name: "Semifinals",
    shortName: "Semis",
    cars: 4,
    minimum: "75%",
    range: "75–100%",
    description:
      "At least three quarters of the short stack. The stakes go up.",
    a: 4000,
    b: 2000,
    wager: 1500,
  },
  {
    id: "final",
    name: "The final",
    shortName: "Final",
    cars: 2,
    minimum: "100%",
    range: "100%",
    description:
      "The short stack is all-in. Both racers match it. No negotiation.",
    a: 8000,
    b: 4000,
    wager: 4000,
  },
] as const;

export type RaceRound = (typeof RACE_ROUNDS)[number]["id"];

export function wagerBounds(round: RaceRound, a: number, b: number) {
  const maximum = Math.min(a, b);
  const minimum =
    round === "round16"
      ? 250
      : maximum *
        (round === "quarterfinal" ? 0.5 : round === "semifinal" ? 0.75 : 1);
  return { minimum, maximum };
}

export function settleRace(
  winnerBankroll: number,
  loserBankroll: number,
  wager: number,
) {
  const remaining = loserBankroll - wager;
  const crew = remaining * 0.2;
  return {
    winner: winnerBankroll + wager,
    remaining,
    crew,
    takeHome: remaining - crew,
  };
}

/** Every cut uses the ORIGINAL negotiation bankroll, never the reduced balance. */
export function negotiationAfterCuts(
  round: RaceRound,
  a: number,
  b: number,
  cuts: number,
) {
  const remainingA = a - a * 0.1 * cuts;
  const remainingB = b - b * 0.1 * cuts;
  const bounds = wagerBounds(round, remainingA, remainingB);
  return {
    a: remainingA,
    b: remainingB,
    crew: (a + b) * 0.1 * cuts,
    minimum: cuts === 5 ? bounds.maximum : bounds.minimum,
    maximum: bounds.maximum,
  };
}
