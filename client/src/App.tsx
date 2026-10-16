import { useEffect, useRef, useState } from "react";
import "./styles.css";
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || ""
).replace(/\/+$/, "");
type Team = {
  id?: number;
  name?: string;
  shortName?: string;
  crest?: string;
};

type GoalEvent = {
  minute?: number | null;
  injuryTime?: number | null;
  type?: string | null;
  team?: Team | null;
  scorer?: {
    id?: number;
    name?: string;
  } | null;
  assist?: {
    id?: number;
    name?: string;
  } | null;
  score?: {
    home?: number | null;
    away?: number | null;
  } | null;
};

type Match = {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: Team;
  awayTeam: Team;
  competition?: {
    name?: string;
    code?: string;
  };
  score?: {
    winner?: string | null;
    duration?: string;
    fullTime?: {
      home?: number | null;
      away?: number | null;
    };
    halfTime?: {
      home?: number | null;
      away?: number | null;
    };
  };
  goals?: GoalEvent[] | null;
};

type MatchesResponse = {
  source?: string;
  count?: number;
  matches?: Match[];
  error?: string;
};

type AnalysisResponse = {
  answer?: string;
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      `The server returned an empty response (${response.status}).`
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `The server returned an invalid response (${response.status}).`
    );
  }
}

function App() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [selected, setSelected] = useState<Match | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [question, setQuestion] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  // Detect browser support for speech recognition and spoken responses.
  useEffect(() => {
    const browserWindow = window as any;
    const supported = Boolean(
      browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition
    );
    setVoiceSupported(supported);
  }, []);

  function startVoiceInput() {
    const browserWindow = window as any;
    const SpeechRecognition =
      browserWindow.SpeechRecognition ||
      browserWindow.webkitSpeechRecognition;

    setVoiceError("");

    if (!SpeechRecognition) {
      setVoiceSupported(false);
      setVoiceError(
        "Voice input is not supported in this browser. Try the latest Chrome browser, or type your question."
      );
      return;
    }

    try {
      // Stop an earlier recognition session before starting another.
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }

      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setVoiceError("");
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (typeof transcript === "string" && transcript.trim()) {
          setQuestion(transcript.trim());
        } else {
          setVoiceError("I couldn't hear a clear question. Please try again.");
        }
      };

      recognition.onerror = (event: any) => {
        const messages: Record<string, string> = {
          "not-allowed":
            "Microphone permission was blocked. Allow microphone access in your browser settings and try again.",
          "service-not-allowed":
            "This browser does not allow speech recognition. Try Chrome or type your question.",
          "no-speech": "No speech was detected. Tap the microphone and speak again.",
          "audio-capture":
            "No microphone was found. Check your microphone connection and permissions.",
          network:
            "Voice recognition needs a working network connection. Please try again.",
        };
        setVoiceError(
          messages[event.error] ||
            `Voice input failed (${event.error || "unknown error"}). You can type your question instead.`
        );
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceError(
        "Couldn't start the microphone. Check browser permissions and try again."
      );
    }
  }

  function stopVoiceInput() {
    try {
      recognitionRef.current?.stop();
    } catch {
      // The recognition session may already have stopped.
    }
    setIsListening(false);
  }

  function speakAnswer(text: string) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setVoiceError("Spoken answers are not supported in this browser. The answer is still shown on screen.");
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      } catch {
        // Ignore cleanup errors.
      }
    };
  }, []);

  // Load real football fixtures.
  useEffect(() => {
    const controller = new AbortController();

    async function loadMatches() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `${API_BASE_URL}/api/matches?competition=PL`,
          { signal: controller.signal }
        );

        const data = await readJson<MatchesResponse>(response);

        if (!response.ok) {
          throw new Error(
            data.error || `Request failed (${response.status})`
          );
        }

        const items = Array.isArray(data.matches)
          ? data.matches
          : [];

        setMatches(items);
        setSelected(items[0] ?? null);
      } catch (err) {
        if (controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "Could not load football fixtures."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadMatches();

    return () => controller.abort();
  }, []);

  // Ask the existing rules-based backend analyst.
  async function askAnalyst() {
    if (!selected || !question.trim() || analyzing) return;

    setAnalyzing(true);
    setAnalysis("");
    setAnalysisError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          match: selected,
          matchId: selected.id,
          competition: selected.competition?.code ?? "PL",
          question: question.trim(),
          tacticalStyle: "neutral",
          detailLevel: "detailed",
        }),
      });

      const data = await readJson<AnalysisResponse>(response);

      if (!response.ok) {
        throw new Error(
          data.error || `Analysis request failed (${response.status})`
        );
      }

      const answer = data.answer ?? "No analysis was returned.";
      setAnalysis(answer);
      speakAnswer(answer);
    } catch (err) {
      setAnalysisError(
        err instanceof Error
          ? err.message
          : "Could not analyse this match."
      );
    } finally {
      setAnalyzing(false);
    }
  }

  function formatDate(date: string) {
    const parsed = new Date(date);

    if (Number.isNaN(parsed.getTime())) {
      return "Date unavailable";
    }

    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(parsed);
  }

  function matchStatus(match: Match) {
    if (match.status === "FINISHED") return "FULL TIME";

    if (
      match.status === "IN_PLAY" ||
      match.status === "PAUSED" ||
      match.status === "LIVE"
    ) {
      return "LIVE";
    }

    if (
      match.status === "POSTPONED" ||
      match.status === "CANCELLED" ||
      match.status === "SUSPENDED"
    ) {
      return match.status.replace("_", " ");
    }

    return "UPCOMING";
  }

  function score(match: Match) {
    const home = match.score?.fullTime?.home;
    const away = match.score?.fullTime?.away;

    if (home == null || away == null) return "VS";

    return `${home} – ${away}`;
  }

  function selectMatch(match: Match) {
    setSelected(match);
    setAnalysis("");
    setAnalysisError("");
  }

  function formatGoalMinute(goal: GoalEvent) {
    if (typeof goal.minute !== "number") {
      return "Minute unavailable";
    }

    return goal.injuryTime
      ? `${goal.minute}+${goal.injuryTime}'`
      : `${goal.minute}'`;
  }

  const hasGoalData =
    selected && Array.isArray(selected.goals);

  const goalEvents = hasGoalData
    ? [...(selected?.goals ?? [])].sort((a, b) => {
        const minuteA = a.minute ?? Number.MAX_SAFE_INTEGER;
        const minuteB = b.minute ?? Number.MAX_SAFE_INTEGER;
        return minuteA - minuteB;
      })
    : [];

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Touchline AI home">
          <span className="brand-mark">T</span>
          <span>
            TOUCHLINE <b>AI</b>
          </span>
        </a>

        <span className="live-label">
          <span className="status-dot" />
          FOOTBALL INTELLIGENCE
        </span>
      </header>

      <section className="hero">
        <p className="eyebrow">YOUR PERSONAL TACTICAL ANALYST</p>

        <h1>
          See the game
          <br />
          beyond the score.
        </h1>

        <p className="hero-copy">
          Explore fixtures, review recorded goals and ask
          evidence-based questions about the game.
        </p>
      </section>

      {loading && (
        <p className="message">Loading football fixtures…</p>
      )}

      {error && (
        <section className="error-panel" role="alert">
          <h2>Fixtures unavailable</h2>
          <p>{error}</p>

          <button onClick={() => window.location.reload()}>
            Try again
          </button>
        </section>
      )}

      {!loading && !error && (
        <div className="dashboard">
          <section className="match-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MATCH CENTRE</p>
                <h2>Premier League</h2>
              </div>

              <span className="count">
                {matches.length} fixtures
              </span>
            </div>

            {matches.length === 0 && (
              <p className="message">
                No fixtures were returned for this competition.
              </p>
            )}

            <div
              className="match-list"
              onKeyDown={(event) => {
                const keys = [
                  "ArrowUp",
                  "ArrowDown",
                  "ArrowLeft",
                  "ArrowRight",
                ];

                if (!keys.includes(event.key)) return;

                const cards = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    ".match-card"
                  )
                );

                if (cards.length === 0) return;

                const currentIndex = cards.indexOf(
                  document.activeElement as HTMLButtonElement
                );

                const nextIndex =
                  currentIndex === -1
                    ? 0
                    : event.key === "ArrowUp" ||
                        event.key === "ArrowLeft"
                      ? (currentIndex - 1 + cards.length) % cards.length
                      : (currentIndex + 1) % cards.length;

                event.preventDefault();
                cards[nextIndex].focus();
              }}
            >
              {matches.map((match) => (
                <button
                  className={`match-card ${
                    selected?.id === match.id ? "selected" : ""
                  }`}
                  key={match.id}
                  onClick={() => selectMatch(match)}
                  aria-pressed={selected?.id === match.id}
                >
                  <span className="match-meta">
                    {matchStatus(match)} · {formatDate(match.utcDate)}
                  </span>

                  <span className="teams">
                    <span>
                      {match.homeTeam.name ?? "Home team"}
                    </span>

                    <strong>{score(match)}</strong>

                    <span>
                      {match.awayTeam.name ?? "Away team"}
                    </span>
                  </span>

                  <span className="select-hint">
                    {selected?.id === match.id
                      ? "SELECTED"
                      : "VIEW MATCH →"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside className="analysis-panel">
            <p className="eyebrow">TACTICAL DESK</p>
            <h2>Match briefing</h2>

            {selected ? (
              <>
                <div className="featured-score">
                  <div>
                    <span className="team-initial">
                      {(selected.homeTeam.name ?? "H").slice(0, 1)}
                    </span>

                    <p>{selected.homeTeam.name ?? "Home team"}</p>
                  </div>

                  <strong>{score(selected)}</strong>

                  <div>
                    <span className="team-initial">
                      {(selected.awayTeam.name ?? "A").slice(0, 1)}
                    </span>

                    <p>{selected.awayTeam.name ?? "Away team"}</p>
                  </div>
                </div>

                <div className="briefing-detail">
                  <span>STATUS</span>
                  <strong>{matchStatus(selected)}</strong>
                </div>

                <div className="briefing-detail">
                  <span>KICKOFF</span>
                  <strong>{formatDate(selected.utcDate)} IST</strong>
                </div>

                <div className="briefing-detail">
                  <span>COMPETITION</span>
                  <strong>
                    {selected.competition?.name ?? "Premier League"}
                  </strong>
                </div>

                <section className="goal-section">
                  <p className="eyebrow">RECORDED GOALS</p>

                  {hasGoalData && goalEvents.length > 0 ? (
                    <ul className="goal-list">
                      {goalEvents.map((goal, index) => (
                        <li
                          key={`${selected.id}-goal-${index}`}
                          className="goal-event"
                        >
                          <strong>{formatGoalMinute(goal)}</strong>

                          <span>
                            {goal.scorer?.name ??
                              "Scorer unavailable"}

                            {goal.type &&
                              goal.type !== "REGULAR" &&
                              ` (${goal.type.toLowerCase()})`}

                            <small>
                              {goal.team?.name ??
                                "Team unavailable"}
                            </small>

                            {goal.assist?.name && (
                              <small>
                                Assist: {goal.assist.name}
                              </small>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="message">
                      {hasGoalData
                        ? "No goal events were returned for this fixture."
                        : "Goal-event data is not available in this response."}
                    </p>
                  )}
                </section>

                <section className="stats-section">
                  <p className="eyebrow">DETAILED STATISTICS</p>

                  <p>
                    Possession: Not available from the current
                    fixture response.
                  </p>

                  <p>
                    Shots and expected goals (xG): Not available
                    from the current fixture response.
                  </p>

                  <small>
                    Missing statistics are not treated as zero.
                  </small>
                </section>

                <div className="analyst-note">
                  <span className="status-dot" />

                  <p>
                    Match data is loaded. Ask a question below
                    for an explanation based on the available
                    fixture and score information.
                  </p>
                </div>
              </>
            ) : (
              <p className="message">
                Select a fixture to inspect it.
              </p>
            )}

            <div className="analyst-form">
              <label htmlFor="analyst-question">
                ASK THE TACTICAL ANALYST
              </label>

              <div
                className="voice-controls"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                  margin: "12px 0",
                }}
              >
                <button
                  type="button"
                  onClick={isListening ? stopVoiceInput : startVoiceInput}
                  aria-label={isListening ? "Stop microphone" : "Ask Touchline using voice"}
                  aria-pressed={isListening}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    minHeight: "46px",
                    padding: "10px 16px",
                    border: isListening ? "1px solid #f87171" : "1px solid #64748b",
                    borderRadius: "12px",
                    background: isListening ? "#7f1d1d" : "#172033",
                    color: "#ffffff",
                    fontSize: "15px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <span aria-hidden="true">{isListening ? "⏹️" : "🎙️"}</span>
                  {isListening ? "Listening… tap to stop" : "Ask Touchline"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setVoiceError("");
                    if ("speechSynthesis" in window) {
                      window.speechSynthesis.cancel();
                    }
                  }}
                  style={{
                    minHeight: "46px",
                    padding: "10px 14px",
                    border: "1px solid #64748b",
                    borderRadius: "12px",
                    background: "transparent",
                    color: "inherit",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                >
                  Stop spoken answer
                </button>
              </div>

              {voiceError && (
                <p role="status" className="analysis-error">
                  {voiceError}
                </p>
              )}

              {!voiceSupported && (
                <p className="data-note">
                  Voice input may not work in this browser. You can still type a question below.
                </p>
              )}

              <textarea
                id="analyst-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void askAnalyst();
                  }
                }}
                placeholder="Tap Ask Touchline or type: Why did this team win?"
                rows={3}
              />

              <button
                className="ask-button"
                onClick={() => void askAnalyst()}
                disabled={!selected || !question.trim() || analyzing}
              >
                {analyzing ? "Analysing…" : "Analyse match →"}
              </button>

              {analysisError && (
                <p role="alert" className="analysis-error">
                  {analysisError}
                </p>
              )}

              {analysis && (
                <div className="analysis-result" aria-live="polite">
                  <p className="eyebrow">ANALYST RESPONSE</p>
                  <p>{analysis}</p>

                  <small>
                    Rules-based prototype. Detailed statistics
                    are not inferred when missing.
                  </small>
                </div>
              )}
            </div>

            <p className="data-note">
              Fixture data provided by football-data.org.
              Detailed statistics may not be included in your
              current API response.
            </p>
          </aside>
        </div>
      )}

      <footer>
        <span>TOUCHLINE AI © 2026</span>
        <span>BUILT FOR THE BIG SCREEN</span>
      </footer>
    </main>
  );
}

export default App;