
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
// Works in local development and compiled Render deployment.
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

dotenv.config({
  path: path.resolve(currentDir, "../.env"),
});

const app = express();
const PORT = Number(process.env.PORT || 4000);
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const gemini = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

app.use(cors());
app.use(express.json({ limit: "100kb" }));

// Root route
app.get("/", (_req, res) => {
  res.json({
    name: "TOUCHLINE AI API",
    status: "running",
    health: "/api/health",
    matches: "/api/matches?competition=PL",
    analysis: "/api/analysis",
  });
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "touchline-ai-api",
    tokenConfigured: Boolean(TOKEN),
  });
});

// Fetch competition fixtures and scores
app.get("/api/matches", async (req, res) => {
  const competition = String(req.query.competition || "PL");
  const allowedCompetitions = ["PL", "PD", "BL1", "SA", "FL1"];

  if (!allowedCompetitions.includes(competition)) {
    return res.status(400).json({
      error: "Unsupported competition code",
    });
  }

  if (!TOKEN) {
    console.error("FOOTBALL_DATA_TOKEN is not configured.");

    return res.status(500).json({
      error: "Football API token is not configured on the server.",
    });
  }

  try {
    const url =
      `https://api.football-data.org/v4/competitions/${competition}/matches`;

    const response = await fetch(url, {
      headers: {
        "X-Auth-Token": TOKEN,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const providerMessage = await response.text();

      console.error(
        "Football API error:",
        response.status,
        providerMessage.slice(0, 300)
      );

      return res.status(
        response.status === 429 ? 429 : 502
      ).json({
        error: "Football data provider request failed",
        providerStatus: response.status,
      });
    }

    const data = await response.json();

    const matches = Array.isArray(data.matches)
      ? data.matches
      : [];

    return res.json({
      source: "football-data.org",
      competition,
      count: matches.length,
      matches,
    });
  } catch (error) {
    console.error("Football API request error:", error);

    return res.status(502).json({
      error: "Could not reach the football data provider",
    });
  }
});

// Verified match details, if the provider makes them available
app.get("/api/matches/:id/details", async (req, res) => {
  const matchId = Number(req.params.id);

  if (!Number.isSafeInteger(matchId) || matchId <= 0) {
    return res.status(400).json({
      error: "A valid numeric match ID is required.",
    });
  }

  if (!TOKEN) {
    return res.status(500).json({
      error: "Football API token is not configured on the server.",
    });
  }

  try {
    const response = await fetch(
      `https://api.football-data.org/v4/matches/${matchId}`,
      {
        headers: {
          "X-Auth-Token": TOKEN,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      const providerMessage = await response.text();

      console.error(
        "Match details API error:",
        response.status,
        providerMessage.slice(0, 300)
      );

      return res.status(
        response.status === 429 ? 429 : 502
      ).json({
        error: "Match details are unavailable from the provider.",
        providerStatus: response.status,
      });
    }

    const match = await response.json();

    const homeStats = match.homeTeam?.statistics ?? null;
    const awayStats = match.awayTeam?.statistics ?? null;

    const statisticKeys = [
      ["shots", "Total shots"],
      ["shots_on_goal", "Shots on target"],
      ["shots_off_goal", "Shots off target"],
      ["ball_possession", "Possession"],
      ["corner_kicks", "Corners"],
      ["fouls", "Fouls"],
      ["saves", "Saves"],
      ["offsides", "Offsides"],
      ["yellow_cards", "Yellow cards"],
      ["red_cards", "Red cards"],
    ] as const;

    const statistics = statisticKeys.map(([key, label]) => {
      const homeValue = homeStats?.[key];
      const awayValue = awayStats?.[key];

      const available =
        typeof homeValue === "number" &&
        typeof awayValue === "number";

      return {
        key,
        label,
        home: available ? homeValue : null,
        away: available ? awayValue : null,
        available,
        unit: key === "ball_possession" ? "%" : "",
      };
    });

    return res.json({
      source: "football-data.org",
      matchId: match.id,
      status: match.status,
      homeTeam: match.homeTeam?.name ?? "Unknown",
      awayTeam: match.awayTeam?.name ?? "Unknown",
      score: match.score?.fullTime ?? null,
      goals: Array.isArray(match.goals) ? match.goals : [],
      statistics,
      note:
        "Only values returned by the provider are shown. " +
        "Null means unavailable, not zero.",
    });
  } catch (error) {
    console.error("Match details request failed:", error);

    return res.status(502).json({
      error: "Could not reach the football data provider.",
    });
  }
});

// Clearly labelled illustrative data
app.get("/api/analysis/demo", (_req, res) => {
  res.json({
    mode: "demo",
    label: "DEMO DATA — NOT LIVE MATCH STATISTICS",
    facts: [
      { metric: "Possession", teamA: 56, teamB: 44, unit: "%" },
      { metric: "Pass accuracy", teamA: 82, teamB: 76, unit: "%" },
    ],
    caveat:
      "These values are illustrative, not real match statistics.",
  });
});

async function generateTacticalAnalysis({
  home,
  away,
  status,
  homeScore,
  awayScore,
  hasScore,
  question,
  tacticalStyle,
  detailLevel,
}: {
  home: string;
  away: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  hasScore: boolean;
  question: string;
  tacticalStyle: string;
  detailLevel: string;
}): Promise<string | null> {
 console.log("Gemini helper called");
console.log("Gemini client available:", Boolean(gemini));

if (!gemini) return null;
  const styles: Record<string, string> = {
    klopp:
      "Pressing, counter-pressing, vertical attacks and transitions",
    pep:
      "Positional play, spacing, overloads and control",
    mourinho:
      "Defensive organisation, compactness and transitions",
    neutral:
      "Neutral, evidence-led tactical analysis",
  };

  const scoreText = hasScore
    ? `${home} ${homeScore}–${awayScore} ${away}`
    : "No confirmed score available";

  const prompt = `
You are TOUCHLINE AI, a football tactical analyst.

MATCH: ${home} vs ${away}
STATUS: ${status}
RECORDED SCORE: ${scoreText}
USER QUESTION: ${question}

TACTICAL STYLE:
${styles[tacticalStyle] ?? styles.neutral}

EXPLANATION DEPTH: ${detailLevel}

RULES:
- Never invent match events, line-ups, formations, statistics or xG.
- A score alone does not prove why a team won or lost.
- Explain possible tactical reasons as hypotheses, not verified facts.
- If requested statistics are unavailable, say so clearly.
- Do not pretend you watched the match or checked live sources.
- Explain tactical concepts clearly and answer the user's question.
`;

  
const delays = [1000, 2000, 4000];

for (let attempt = 0; attempt <= delays.length; attempt++) {
  try {
    const response = await gemini.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: detailLevel === "simple" ? 350 : 700,
      },
    });

    console.log("Gemini response received:", Boolean(response.text));
console.log("Gemini response length:", response.text?.length ?? 0);

return response.text?.trim() || null;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    const isTemporary =
      message.includes("503") ||
      message.includes("UNAVAILABLE") ||
      message.includes("429") ||
      message.includes("RESOURCE_EXHAUSTED");

    if (!isTemporary || attempt === delays.length) {
      console.error("Gemini analysis unavailable:", message);
      return null;
    }

    console.warn(
      `Gemini temporary error; retry ${attempt + 1}/${delays.length}`
    );

    await new Promise((resolve) =>
      setTimeout(resolve, delays[attempt])
    );
  }
}

return null;

}

// Rules-based analyst prototype
app.post("/api/analysis", async (req, res) => {
  const {
  matchId,
  competition = "PL",
  question,
  tacticalStyle = "klopp",
  detailLevel = "detailed",
} = req.body ?? {};

const allowedStyles = [
  "klopp",
  "pep",
  "mourinho",
  "neutral",
];

const allowedDetailLevels = [
  "simple",
  "detailed",
];

  const allowedCompetitions = ["PL", "PD", "BL1", "SA", "FL1"];

 if (
  !Number.isSafeInteger(matchId) ||
  matchId <= 0 ||
  typeof competition !== "string" ||
  !allowedCompetitions.includes(competition) ||
  typeof question !== "string" ||
  !question.trim() ||
  typeof tacticalStyle !== "string" ||
  !allowedStyles.includes(tacticalStyle) ||
  typeof detailLevel !== "string" ||
  !allowedDetailLevels.includes(detailLevel)
) {
  return res.status(400).json({
    error: "Invalid match, question or analysis preferences.",
  });
}

  if (!TOKEN) {
    return res.status(500).json({
      error: "Football API token is not configured on the server.",
    });
  }

  try {
    // Fetch fixtures directly from the provider.
    const response = await fetch(
      `https://api.football-data.org/v4/competitions/${competition}/matches`,
      {
        headers: {
          "X-Auth-Token": TOKEN,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      console.error("Analysis fixture verification failed:", response.status);

      return res.status(
        response.status === 429 ? 429 : 502
      ).json({
        error: "Could not verify this match with the football data provider.",
        providerStatus: response.status,
      });
    }

    const data = await response.json();
    const fixtures = Array.isArray(data.matches) ? data.matches : [];

    // Never trust the score or status submitted by the frontend.
    const match = fixtures.find(
      (item: { id?: number }) => item.id === matchId
    );

    if (!match) {
      return res.status(404).json({
        error:
          "This match was not found in the provider's returned fixtures. " +
          "It may be outside the available data range.",
      });
    }

    const home = match.homeTeam?.name ?? "Home team";
    const away = match.awayTeam?.name ?? "Away team";
    const status = String(match.status ?? "UNKNOWN").toUpperCase();
    const q = question.trim().toLowerCase();

    const homeScore = match.score?.fullTime?.home;
    const awayScore = match.score?.fullTime?.away;

    const hasScore =
      typeof homeScore === "number" &&
      Number.isFinite(homeScore) &&
      typeof awayScore === "number" &&
      Number.isFinite(awayScore);

    const isUpcoming =
      status === "SCHEDULED" || status === "TIMED";

    const isFinished = status === "FINISHED";

    const isLive = [
      "IN_PLAY",
      "PAUSED",
      "LIVE",
      "EXTRA_TIME",
      "PENALTY_SHOOTOUT",
    ].includes(status);

    let answer: string;

    if (isUpcoming) {
      answer =
        `${home} vs ${away} has not started yet. ` +
        "No match result is available from the fixture data.";
    
} else if (
  q.includes("possession") ||
  q.includes("shots") ||
  q.includes("statistics") ||
  q.includes("stats") ||
  q.includes("expected goals") ||
  q.includes("xg") ||
  q.includes("pass accuracy") ||
  q.includes("corners")
) {
  answer =
    "Detailed match statistics are not verified by this request. " +
    "Possession, shots and expected goals are unavailable here.";
} else if (
  q.includes("goal") ||
  q.includes("scorer") ||
  q.includes("scored") ||
  q.includes("assist")
) {
  const hasGoalEvents = Array.isArray(match.goals);
  const goals = hasGoalEvents ? match.goals : [];

  if (!hasGoalEvents) {
    answer =
      "Goal-event data is not included in the provider response " +
      "for this fixture.";
  } else if (goals.length === 0) {
    answer =
      "No goal events were returned for this fixture. " +
      "This does not by itself confirm a 0–0 result.";
  } else {
    const goalSummaries = goals.slice(0, 10).map((goal: {
      minute?: number | null;
      injuryTime?: number | null;
      scorer?: { name?: string } | null;
      team?: { name?: string } | null;
      assist?: { name?: string } | null;
    }) => {
      const minute =
        typeof goal.minute === "number"
          ? `${goal.minute}${
              typeof goal.injuryTime === "number" && goal.injuryTime > 0
                ? `+${goal.injuryTime}`
                : ""
            }'`
          : "Minute unavailable";

      const scorer = goal.scorer?.name ?? "Scorer unavailable";
      const team = goal.team?.name ?? "Team unavailable";
      const assist = goal.assist?.name;

      return `${minute}: ${scorer} (${team})${
        assist ? `, assisted by ${assist}` : ""
      }`;
    });

    answer =
      `Provider-recorded goal events for ${home} vs ${away}:\n` +
      goalSummaries.join("\n");
  }
} else if (!hasScore) {

      answer =
        `The selected fixture is ${home} vs ${away}. ` +
        "A confirmed score is unavailable, so a reliable result " +
        "cannot be provided.";
    } else {
      const scoreText = `${home} ${homeScore}–${awayScore} ${away}`;

      const winnerText =
        homeScore > awayScore
          ? `${home} ${isFinished ? "won" : "lead"} ${homeScore}–${awayScore}.`
          : awayScore > homeScore
            ? `${away} ${isFinished ? "won" : "lead"} ${awayScore}–${homeScore}.`
            : `The score is ${homeScore}–${awayScore}.`;

      if (
        q.includes("score") ||
        q.includes("result") ||
        q.includes("winner") ||
        q.includes("who won")
      ) {
        answer = isFinished
          ? `Final result: ${scoreText}. ${winnerText}`
          : isLive
            ? `Current recorded score: ${scoreText}. ${winnerText} This is not a final result.`
            : `Recorded score: ${scoreText}. The provider has not confirmed a final result.`;
      } else if (
        q.includes("why") ||
        q.includes("tactic") ||
        q.includes("formation")
      ) {
        answer =
          `${isFinished ? "Final score" : "Recorded score"}: ${scoreText}. ` +
          "The score alone cannot establish why the match ended this way. " +
          "Verified events and performance statistics are needed for a " +
          "reliable tactical explanation.";
      } else if (
        q.includes("player") ||
        q.includes("best") ||
        q.includes("man of the match")
      ) {
        answer =
          "Verified player-level performance data is not available " +
          "in this analysis request, so I cannot reliably name the best player.";
      } else {
        answer =
          `${isFinished ? "Final score" : "Recorded score"}: ${scoreText}. ` +
          `${winnerText} This is a rules-based analysis, not generative AI.`;
      }
    }



const asksForUnavailableStats =
  q.includes("possession") ||
  q.includes("shots") ||
  q.includes("statistics") ||
  q.includes("stats") ||
  q.includes("expected goals") ||
  q.includes("xg") ||
  q.includes("pass accuracy") ||
  q.includes("corners");

const asksForTactics =
  q.includes("why") ||
  q.includes("tactic") ||
  q.includes("formation") ||
  q.includes("press") ||
  q.includes("transition") ||
  q.includes("shape") ||
  q.includes("strategy") ||
  q.includes("how did");

let analysisType = "server-verified rules-based prototype";
console.log("Tactical request matched:", asksForTactics);
console.log("Stats-only question:", asksForUnavailableStats);
console.log("Gemini key loaded:", Boolean(GEMINI_API_KEY));
console.log("Gemini client ready:", Boolean(gemini));
console.log("Will call Gemini:", asksForTactics && !asksForUnavailableStats && Boolean(gemini));
if (
  asksForTactics &&
  !asksForUnavailableStats &&
  gemini
) {
  const aiAnswer = await generateTacticalAnalysis({
    home,
    away,
    status,
    homeScore,
    awayScore,
    hasScore,
    question: question.trim(),
    tacticalStyle,
    detailLevel,
  });

  if (aiAnswer) {
    answer = aiAnswer;
    analysisType = "Gemini-generated tactical explanation";
  }
}

    return res.json({
  matchId: match.id,
  match: `${home} vs ${away}`,
  status,
  score: hasScore
    ? { home: homeScore, away: awayScore }
    : null,
  question: question.trim(),
  tacticalStyle,
  detailLevel,
  answer,
  source: "football-data.org",
 analysisType,
  limitations: [
    "The match ID and score are checked against provider fixtures.",
    "Detailed performance statistics are not verified by this route.",
    "No generative AI model is connected to this endpoint.",
  ],
});
  } catch (error) {
    console.error("Analysis request failed:", error);

    return res.status(502).json({
      error: "Could not verify and analyse this match.",
    });
  }
});
// Start server
app.listen(PORT, () => {
  console.log(`Touchline AI API listening on port ${PORT}`);
  console.log(`Football API token configured: ${Boolean(TOKEN)}`);
});
