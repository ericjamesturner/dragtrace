import { useEffect, useRef, useState } from "react";
import { Check, Copy, Printer, Trophy } from "lucide-react";
import {
  negotiationAfterCuts,
  RACE_ROUNDS,
  settleRace,
  wagerBounds,
} from "../lib/race-rules";
import "./RacePage.css";

const money = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);

function WagerExample() {
  const [roundIndex, setRoundIndex] = useState(0);
  const [wager, setWager] = useState<number>(600);
  const [winner, setWinner] = useState<"A" | "B">("A");
  const round = RACE_ROUNDS[roundIndex];
  const bounds = wagerBounds(round.id, round.a, round.b);
  const result = settleRace(
    winner === "A" ? round.a : round.b,
    winner === "A" ? round.b : round.a,
    wager,
  );
  const loser = winner === "A" ? "B" : "A";

  return (
    <div className="race-example">
      <div className="race-example-heading">
        <span className="race-eyebrow">Wager and payout example</span>
        <span className="race-example-hint">Interactive example</span>
      </div>
      <div
        className="race-round-picker"
        role="group"
        aria-label="Example round"
      >
        {RACE_ROUNDS.map((r, i) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={roundIndex === i}
            onClick={() => {
              setRoundIndex(i);
              setWager(r.wager);
            }}
          >
            <span className="race-picker-number">0{i + 1}</span>
            {r.shortName}
          </button>
        ))}
      </div>
      <div className="race-example-body">
        <div className="race-example-controls">
          <p className="race-example-context">
            {round.name} example · bankrolls before the bet
          </p>
          <div className="race-stack-comparison">
            {(["A", "B"] as const).map((racer) => {
              const stack = racer === "A" ? round.a : round.b;
              return (
                <div className="race-stack" key={racer}>
                  <div className="race-stack-label">
                    <span>Racer {racer}</span>
                    <strong>{money(stack)}</strong>
                  </div>
                  <div className="race-stack-track" aria-hidden="true">
                    <div
                      className="race-stack-fill"
                      style={{
                        width: `${(stack / Math.max(round.a, round.b)) * 100}%`,
                      }}
                    >
                      <span
                        className="race-stack-bet"
                        style={{ width: `${(wager / stack) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="race-stack-caption">
                    {round.a === round.b
                      ? "Equal starting stacks"
                      : stack === bounds.maximum
                        ? "Short stack · sets the limit"
                        : "Larger stack"}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="race-legend">
            <span>
              <i className="race-legend-bet" />
              Wagered
            </span>
            <span>
              <i className="race-legend-held" />
              Not wagered
            </span>
          </div>
          <div className="race-wager-label">
            <label htmlFor="race-wager">
              {round.id === "final"
                ? "Required wager, each"
                : "Choose the wager, each"}
            </label>
            <output htmlFor="race-wager">{money(wager)}</output>
          </div>
          <input
            id="race-wager"
            type="range"
            min={bounds.minimum}
            max={bounds.maximum}
            step={1}
            value={wager}
            disabled={round.id === "final"}
            onChange={(e) => setWager(Number(e.target.value))}
            aria-valuetext={`${money(wager)} per racer`}
          />
          <div className="race-range-labels">
            <span>
              Minimum <strong>{money(bounds.minimum)}</strong>
            </span>
            <span>
              Maximum <strong>{money(bounds.maximum)}</strong>
            </span>
          </div>
          <p className="race-example-note">
            {round.id === "final"
              ? "No deal to make. Both racers wager the full short stack."
              : "Slide to try a legal wager. Both racers always put up the same amount."}
          </p>
          <div
            className="race-winner-picker"
            role="group"
            aria-label="Choose the example winner"
          >
            <span>Who wins?</span>
            {(["A", "B"] as const).map((racer) => (
              <button
                key={racer}
                type="button"
                aria-pressed={winner === racer}
                onClick={() => setWinner(racer)}
              >
                Racer {racer}
                {winner === racer && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
        <div
          className="race-example-result"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="race-pot">
            <span>Total on this race</span>
            <strong>{money(wager * 2)}</strong>
            <small>{money(wager)} from each racer</small>
          </div>
          <div className="race-result-win">
            <span>
              <Trophy size={17} aria-hidden="true" />
              Racer {winner}{" "}
              {round.id === "final" ? "wins the event" : "advances"}
            </span>
            <strong>{money(result.winner)}</strong>
            <small>
              Bankroll after winning · includes their own wager back
            </small>
          </div>
          <div className="race-result-loss">
            <span>Racer {loser} is eliminated</span>
            <dl>
              <div>
                <dt>Left after losing the wager</dt>
                <dd>{money(result.remaining)}</dd>
              </div>
              <div>
                <dt>20% exit cut to the crew</dt>
                <dd>−{money(result.crew)}</dd>
              </div>
              <div className="race-take-home">
                <dt>Racer {loser} takes home</dt>
                <dd>{money(result.takeHome)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
      <div className="race-example-footnote">
        <span aria-hidden="true">↳</span> Examples are separate matchups, not
        one racer’s path through the event. No negotiation cuts are included
        here.
      </div>
    </div>
  );
}

function NegotiationExample() {
  const [cuts, setCuts] = useState(0);
  const state = negotiationAfterCuts("semifinal", 6000, 2000, cuts);
  return (
    <div className="race-clock-example">
      <div className="race-example-heading">
        <span className="race-eyebrow">Negotiation example</span>
        <span className="race-example-hint">Semifinal example</span>
      </div>
      <p className="race-clock-setup">
        Starting bankrolls: <strong>A: $6,000</strong> /{" "}
        <strong>B: $2,000.</strong>
        <br />
        Every haircut takes <strong>$600 from A</strong> and{" "}
        <strong>$200 from B.</strong>
      </p>
      <div
        className="race-clock-steps"
        role="group"
        aria-label="Number of negotiation crew cuts"
      >
        {[0, 1, 2, 3, 4, 5].map((step) => (
          <button
            key={step}
            type="button"
            aria-pressed={cuts === step}
            onClick={() => setCuts(step)}
          >
            <span>{step === 0 ? "0–5:00" : `${5 + step}:00`}</span>
            <i aria-hidden="true">{step === 0 ? "—" : step}</i>
            <small>
              {step === 0 ? "No cuts" : step === 5 ? "All-in" : `Cut ${step}`}
            </small>
          </button>
        ))}
      </div>
      <div className="race-clock-state" aria-live="polite" aria-atomic="true">
        <div className="race-clock-stacks">
          {[
            { name: "Racer A", value: state.a, original: 6000 },
            { name: "Racer B", value: state.b, original: 2000 },
          ].map((racer) => (
            <div key={racer.name}>
              <div className="race-stack-label">
                <span>{racer.name}</span>
                <strong>{money(racer.value)}</strong>
              </div>
              <div className="race-clock-track" aria-hidden="true">
                <span
                  style={{ width: `${(racer.value / racer.original) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="race-clock-totals">
          <div>
            <span>
              {cuts === 5 ? "Automatic wager, each" : "Legal wager, each"}
            </span>
            <strong>
              {cuts === 5
                ? money(state.maximum)
                : `${money(state.minimum)}–${money(state.maximum)}`}
            </strong>
          </div>
          <div>
            <span>Sent to the Crew Pool so far</span>
            <strong>{money(state.crew)}</strong>
          </div>
        </div>
        <p className="race-clock-verdict">
          {cuts === 5
            ? "Five cuts. Half of each starting bankroll is gone. Both racers must now wager $1,000. Negotiations are over."
            : cuts === 0
              ? "Five minutes to make a deal. Tell the official the agreed amount. The first cut hits at 6:00 if there is still no agreement."
              : `Cut ${cuts}: another $800 goes to the crew. The wager range is recalculated from the new short stack.`}
        </p>
      </div>
      <p className="race-example-footnote">
        Example timeline: minutes elapsed since the matchup was given. Each cut
        is 10% of the original bankroll, not 10% of what remains.
      </p>
    </div>
  );
}

export default function RacePage() {
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareUrl = new URL("/race", window.location.origin).href;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Race rules | DragTrace";
    return () => {
      document.title = previousTitle;
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function copyLink() {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareState("copied");
      resetTimer.current = setTimeout(() => setShareState("idle"), 3000);
    } catch {
      setShareState("manual");
    }
  }

  return (
    <div className="race-page">
      <a className="race-skip-link" href="#race-main">
        Skip to race rules
      </a>
      <header className="race-header">
        <div className="race-shell race-header-inner">
          <a className="race-brand" href="/">
            DragTrace<span>/</span>
            <span>Race rules</span>
          </a>
          <div className="race-header-actions">
            <button
              className="race-print"
              type="button"
              onClick={() => window.print()}
            >
              <Printer size={16} aria-hidden="true" />
              Print rules
            </button>
            <button className="race-share" type="button" onClick={copyLink}>
              {shareState === "copied" ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              <span aria-live="polite">
                {shareState === "copied" ? "Link copied" : "Copy rules link"}
              </span>
            </button>
          </div>
        </div>
        {shareState === "manual" && (
          <div className="race-shell race-manual-share">
            <label htmlFor="race-share-url">
              Copy this link to share the rules:
            </label>
            <input
              id="race-share-url"
              readOnly
              value={shareUrl}
              onFocus={(event) => event.target.select()}
              autoFocus
            />
          </div>
        )}
      </header>

      <main id="race-main" className="race-shell">
        <header className="race-document-title">
          <h1 id="race-title">Race rules</h1>
          <p>16 cars · $1,000 starting bankroll each · Single elimination</p>
        </header>

        <section
          id="spirit"
          className="race-spirit"
          aria-labelledby="race-spirit-title"
        >
          <h2 id="race-spirit-title">The spirit of the race</h2>
          <p>
            This is a race where you manage your own bankroll. Winning grows
            your stack, and negotiating lets you decide how much to risk within
            each round’s limits. Keep winning until you’re the last racer left.
          </p>
          <p>
            A loss ends your event, but it does <strong>not</strong>{" "}
            automatically cost you your whole bankroll. The minimum bets rise as
            the field gets smaller. Make your deals promptly: the Crew Cuts keep
            negotiations moving and support the people running the event.
          </p>
        </section>

        <nav className="race-document-nav" aria-label="On this page">
          <a href="#rules">Rules</a>
          <a href="#examples">Examples</a>
        </nav>

        <section
          id="rules"
          className="race-rules"
          aria-labelledby="race-rules-title"
        >
          <h2 id="race-rules-title">Rules</h2>
          <ol className="race-rules-list">
            <li>
              <h3>The field and starting bankroll</h3>
              <p>
                <strong>16 cars. $1,000 per racer.</strong> Every race has money
                on it. One loss eliminates you from the event.
              </p>
            </li>
            <li>
              <h3>Both racers wager the same amount</h3>
              <p>
                The racer with less money is the <strong>short stack</strong>.
                Neither racer can wager more than the short stack can cover. A
                larger bankroll cannot force the other racer to cover money they
                do not have.
              </p>
            </li>
            <li>
              <h3>Round of 16: at least $250 each</h3>
              <p>
                With the starting $1,000 bankrolls, agree on any wager from{" "}
                <strong>$250 to $1,000 each</strong>. $250 is the minimum, not a
                required fixed bet.
              </p>
            </li>
            <li>
              <h3>Quarterfinals: at least 50% of the short stack</h3>
              <p>
                Agree on any wager from{" "}
                <strong>50% to 100% of the short stack, each</strong>. The
                percentage is the minimum; you can agree to bet more.
              </p>
            </li>
            <li>
              <h3>Semifinals: at least 75% of the short stack</h3>
              <p>
                Agree on any wager from{" "}
                <strong>75% to 100% of the short stack, each</strong>. Again,
                the percentage is the minimum, not a fixed bet.
              </p>
            </li>
            <li>
              <h3>Final: the short stack is all-in</h3>
              <p>
                <strong>Both racers wager 100% of the short stack.</strong>{" "}
                There is no negotiation. Any extra money in the larger bankroll
                stays outside the wager. The winner of this race wins
                the event.
              </p>
            </li>
            <li>
              <h3>You have 5 minutes to agree</h3>
              <p>
                The clock starts when you receive your matchup. Negotiate
                however you want, as long as the agreed wager is within that
                round’s legal range.{" "}
                <strong>Tell the official the amount</strong> when you make a
                deal.
              </p>
            </li>
            <li>
              <h3>No deal? Both racers pay a Negotiation Crew Cut</h3>
              <p>
                After the first 5 minutes,{" "}
                <strong>every additional 60 seconds</strong> without an
                agreement costs each racer{" "}
                <strong>
                  10% of the bankroll they had when that negotiation started
                </strong>
                . Each cut is the same dollar amount; it is not 10% of the
                shrinking balance.
              </p>
              <p>
                The money goes directly to the Event Crew Pool. It is not part
                of the wager and is not returned if you win. After each cut,{" "}
                <strong>
                  recalculate the legal wager using the new bankrolls
                </strong>
                .
              </p>
            </li>
            <li>
              <h3>After five cuts, negotiations end</h3>
              <p>
                <strong>
                  Both racers automatically wager the full remaining short
                  stack.
                </strong>{" "}
                No more negotiating.
              </p>
            </li>
            <li>
              <h3>If you win</h3>
              <p>
                You get your own wager back, take the other racer’s full wager,
                and advance. Your new bankroll is{" "}
                <strong>
                  your bankroll before the bet plus the opponent’s wager
                </strong>
                .
              </p>
            </li>
            <li>
              <h3>If you lose</h3>
              <p>
                You are eliminated and lose the amount you wagered.{" "}
                <strong>
                  Any money you did not wager remains yours, subject to the Exit
                  Crew Cut below.
                </strong>{" "}
                You do not automatically lose your entire bankroll.
              </p>
            </li>
            <li>
              <h3>Exit Crew Cut: 20% of what you have left</h3>
              <p>
                When you are eliminated,{" "}
                <strong>
                  20% of your remaining bankroll goes to the Event Crew Pool.
                  You keep the other 80%.
                </strong>{" "}
                This cut comes from the money left after losing your wager,
                never from the race pot. The winner receives the full wager.
              </p>
              <p>
                If you go all-in and lose, you have $0 left, so the Exit Crew
                Cut is $0.
              </p>
            </li>
            <li>
              <h3>Where the Crew Pool goes</h3>
              <p>
                The Event Crew Pool supports the starting line crew, track
                officials, and event staff. It receives the{" "}
                <strong>Negotiation Crew Cuts</strong> and the{" "}
                <strong>Exit Crew Cuts</strong>.
              </p>
            </li>
            <li>
              <h3>Breakdowns, forfeits, and withdrawals</h3>
              <p>
                <strong>A win is a win.</strong> If your car breaks after a win,
                the racer you beat stays eliminated. You still have to make your
                next race.
              </p>
              <p>
                If you cannot make that race, or choose to withdraw, you
                forfeit. Your scheduled opponent advances and receives the{" "}
                <strong>
                  minimum legal wager for that round from your bankroll
                </strong>
                . You are then eliminated, and the normal{" "}
                <strong>20% Exit Crew Cut</strong> applies to what you have
                left.
              </p>
              <p>
                You cannot build a bankroll and quit without settling your next
                matchup.
              </p>
            </li>
          </ol>
        </section>

        <section
          id="examples"
          className="race-examples"
          aria-labelledby="race-examples-title"
        >
          <h2 id="race-examples-title">Examples</h2>
          <p className="race-examples-intro">
            These illustrate the rules above. All amounts are per racer unless
            marked as the total on the race.
          </p>
          <section
            className="race-worked-example"
            aria-labelledby="race-wager-example-title"
          >
            <h3 id="race-wager-example-title">
              1. Choosing a wager and settling the race
            </h3>
            <p>
              In the first round, both racers have $1,000 and agree to wager
              $600 each. The winner now has $1,600. The loser has $400 left,
              pays an $80 Exit Crew Cut, and leaves with $320.
            </p>
            <p>
              Change the round, wager, or winner below to try other outcomes.
            </p>
            <WagerExample />
          </section>
          <section
            className="race-worked-example"
            aria-labelledby="race-final-example-title"
          >
            <h3 id="race-final-example-title">
              2. Unequal bankrolls in the final
            </h3>
            <p>
              Racer A has $8,000. Racer B has $4,000. Both must wager $4,000, so
              there is $8,000 on the race.
            </p>
            <ul>
              <li>
                <strong>If A wins:</strong> A finishes with $12,000. B has $0
                left.
              </li>
              <li>
                <strong>If B wins:</strong> B wins the event with $8,000. A has
                $4,000 left, pays an $800 Exit Crew Cut, and takes home $3,200.
              </li>
            </ul>
          </section>
          <section
            className="race-worked-example"
            aria-labelledby="race-clock-example-title"
          >
            <h3 id="race-clock-example-title">
              3. Negotiation cuts and the forced all-in
            </h3>
            <p>
              In this semifinal example, A starts negotiations with $6,000 and B
              with $2,000. Each cut takes $600 from A and $200 from B. Select a
              time to see the remaining bankrolls and recalculated wager.
            </p>
            <NegotiationExample />
          </section>
          <section
            className="race-worked-example"
            aria-labelledby="race-exit-example-title"
          >
            <h3 id="race-exit-example-title">4. The Exit Crew Cut</h3>
            <p>You have $5,000, wager $1,500, and lose.</p>
            <dl className="race-exit-calculation">
              <div>
                <dt>Bankroll before the race</dt>
                <dd>$5,000</dd>
              </div>
              <div>
                <dt>Wager lost to the winner</dt>
                <dd>−$1,500</dd>
              </div>
              <div>
                <dt>Remaining bankroll</dt>
                <dd>$3,500</dd>
              </div>
              <div>
                <dt>Exit Crew Cut: 20% of $3,500</dt>
                <dd>−$700</dd>
              </div>
              <div>
                <dt>You take home</dt>
                <dd>$2,800</dd>
              </div>
            </dl>
          </section>
        </section>
      </main>
      <footer className="race-footer">
        <div className="race-shell">
          <span>DragTrace · Race rules</span>
          <a href="#race-title">Back to top ↑</a>
        </div>
      </footer>
    </div>
  );
}
