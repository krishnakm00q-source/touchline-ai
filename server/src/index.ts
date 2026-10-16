
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Works in local development and compiled Render deployment.
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

dotenv.config({
  path: path.resolve(currentDir, "../.env"),
});

const app = express();
const PORT = Number(process.env.PORT || 4000);
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

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

// Rules-based analyst prototype
app.post("/api/analysis", (req, res) => {
  const { match, question } = req.body ?? {};

  if (
    !match ||
    typeof match.homeTeam?.name !== "string" ||
    typeof match.awayTeam?.name !== "string" ||
    typeof question !== "string" ||
    !question.trim()
  ) {
    return res.status(400).json({
      error: "Please select a match and enter a question.",
    });
  }

  const home = match.homeTeam.name;
  const away = match.awayTeam.name;
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
    status === "SCHEDULED" ||
    status === "TIMED";

  const isFinished = status === "FINISHED";

  const isLive =
    status === "IN_PLAY" ||
    status === "PAUSED" ||
    status === "LIVE" ||
    status === "EXTRA_TIME" ||
    status === "PENALTY_SHOOTOUT";

  let answer: string;

  if (isUpcoming) {
    answer =
      `${home} vs ${away} has not started yet. ` +
      "No match result is available. Confirmed formations, " +
      "lineups and player availability cannot be established " +
      "from fixture data alone.";
  } else if (!hasScore) {
    answer =
      `The selected fixture is ${home} vs ${away}. ` +
      "A confirmed score is unavailable, so a reliable result " +
      "or detailed tactical explanation cannot be provided yet.";
  } else {
    const scoreText =
      `${home} ${homeScore}–${awayScore} ${away}`;

    const scoreDescription =
      homeScore > awayScore
        ? `${home} ${isFinished ? "won" : "lead"} ${homeScore}–${awayScore}.`
        : awayScore > homeScore
          ? `${away} ${isFinished ? "won" : "lead"} ${awayScore}–${homeScore}.`
          : `The score is level at ${homeScore}–${awayScore}.`;

    const finalResult =
      homeScore > awayScore
        ? `${home} won ${homeScore}–${awayScore}.`
        : awayScore > homeScore
          ? `${away} won ${awayScore}–${homeScore}.`
          : `The match finished ${homeScore}–${awayScore}.`;

    const asksForStatistics =
      q.includes("possession") ||
      q.includes("shots") ||
      q.includes("expected goals") ||
      q.includes("xg") ||
      q.includes("statistics") ||
      q.includes("stats") ||
      q.includes("pass accuracy") ||
      q.includes("corners");

    const asksForResult =
      q.includes("score") ||
      q.includes("result") ||
      q.includes("won") ||
      q.includes("winner");

    const asksForTactics =
      q.includes("why") ||
      q.includes("tactic") ||
      q.includes("tactical") ||
      q.includes("formation");

    const asksForPlayer =
      q.includes("player") ||
      q.includes("best") ||
      q.includes("man of the match");

    if (asksForStatistics) {
      answer =
        "Detailed possession, shots, expected-goals and other " +
        "performance statistics are not included in the data " +
        "supplied to this analysis request. They are unavailable, " +
        "not zero.";
    } else if (asksForResult) {
      if (isFinished) {
        answer = `Final result: ${scoreText}. ${finalResult}`;
      } else if (isLive) {
        answer =
          `Current recorded score: ${scoreText}. ` +
          `${scoreDescription} This is not a confirmed final result.`;
      } else {
        answer =
          `Recorded score: ${scoreText}. ${scoreDescription} ` +
          "The match status does not confirm a final result.";
      }
    } else if (asksForTactics) {
      answer =
        `${isFinished ? "Final score" : "Recorded score"}: ${scoreText}. ` +
        "The score alone does not establish why the match ended " +
        "this way. Verified match events, formations and performance " +
        "statistics are needed for a reliable tactical explanation.";
    } else if (asksForPlayer) {
      answer =
        "Player-level performance data is not available in this " +
        "analysis request, so I cannot reliably name the best player.";
    } else {
      answer =
        `${isFinished ? "Final score" : "Recorded score"}: ${scoreText}. ` +
        `${scoreDescription} This rules-based prototype uses fixture ` +
        "and score data; it does not provide generative AI analysis " +
        "or detailed statistics.";
    }
  }

  return res.json({
    match: `${home} vs ${away}`,
    question: question.trim(),
    answer,
    source: "football-data.org fixture data supplied by the client",
    analysisType: "rules-based prototype",
    limitations: [
      "The analysis uses the match object submitted by the frontend.",
      "Possession, shots and expected-goals statistics are not verified by this route.",
      "Confirmed formations and player-level statistics are not supplied.",
      "No generative AI model is connected to this endpoint.",
    ],
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Touchline AI API listening on port ${PORT}`);
  console.log(`Football API token configured: ${Boolean(TOKEN)}`);
});
