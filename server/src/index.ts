import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Works in local development and in the compiled Render deployment.
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

dotenv.config({
  path: path.resolve(currentDir, "../.env"),
});

// Render supplies environment variables through process.env.
// The .env file is only needed for local development.
const app = express();
const PORT = Number(process.env.PORT || 4000);
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

app.use(cors());
app.use(express.json());

// Root route
app.get("/", (_req, res) => {
  res.json({
    name: "TOUCHLINE AI API",
    status: "running",
    health: "/api/health",
    matches: "/api/matches?competition=PL",
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

      return res.status(response.status === 429 ? 429 : 502).json({
        error: "Football data provider request failed",
        providerStatus: response.status,
      });
    }

    const data = await response.json();

    return res.json({
      source: "football-data.org",
      competition,
      count: Array.isArray(data.matches) ? data.matches.length : 0,
      matches: Array.isArray(data.matches) ? data.matches : [],
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
      const message = await response.text();

      console.error(
        "Match details API error:",
        response.status,
        message.slice(0, 300)
      );

      return res.status(response.status === 429 ? 429 : 502).json({
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
  const status = String(match.status ?? "UNKNOWN");
  const q = question.trim().toLowerCase();

  const homeScore = match.score?.fullTime?.home;
  const awayScore = match.score?.fullTime?.away;

  const hasScore =
    typeof homeScore === "number" &&
    typeof awayScore === "number";

  let answer: string;

  if (status === "SCHEDULED" || status === "TIMED") {
    answer =
      `${home} vs ${away} has not started yet. ` +
      "Confirmed formations, lineups and player availability " +
      "are not established by the fixture data alone.";
  } else if (!hasScore) {
    answer =
      `The selected fixture is ${home} vs ${away}. ` +
      "A confirmed score is unavailable, so a reliable result " +
      "or tactical explanation cannot be provided yet.";
  } else {
    const scoreText =
      `${home} ${homeScore}–${awayScore} ${away}`;

    const result =
      homeScore > awayScore
        ? `${home} won ${homeScore}–${awayScore}.`
        : awayScore > homeScore
          ? `${away} won ${awayScore}–${homeScore}.`
          : `The match finished ${homeScore}–${awayScore}.`;

    if (q.includes("score") || q.includes("result")) {
      answer = `Match result: ${scoreText}. ${result}`;
    } else if (
      q.includes("why") ||
      q.includes("tactic") ||
      q.includes("tactical")
    ) {
      answer =
        `${scoreText}. ${result} ` +
        "The score alone does not establish why the match ended " +
        "this way. Verified match events and performance statistics " +
        "are needed for a tactical explanation.";
    } else if (q.includes("player") || q.includes("best")) {
      answer =
        `${scoreText}. Player-level performance data is not available ` +
        "in this analysis request, so I cannot reliably name the best player.";
    } else {
      answer =
        `${scoreText}. ${result} ` +
        "This prototype uses fixture and score data; it does not " +
        "yet provide generative AI analysis or detailed match statistics.";
    }
  }

  return res.json({
    match: `${home} vs ${away}`,
    question: question.trim(),
    answer,
    source: "football-data.org fixture data",
    analysisType: "rules-based prototype",
    limitations: [
      "No verified possession or expected-goals data supplied",
      "No confirmed formations or player-level statistics supplied",
      "No generative AI model is connected to this endpoint",
    ],
  });
});

app.listen(PORT, () => {
  console.log(`Touchline AI API listening on port ${PORT}`);
  console.log(`Football API token configured: ${Boolean(TOKEN)}`);
});
