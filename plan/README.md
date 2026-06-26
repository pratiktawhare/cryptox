# CryptoX — Project Plan Index

> AI-Powered Crypto Trading Intelligence Platform  
> Phases 1–3 are **COMPLETE**. Phases 4–10 are the new roadmap.

---

## Completed Phases

| Phase | Plan File | Status |
|---|---|---|
| **1** | [Foundation & Auth](01-foundation-auth.md) | ✅ Done |
| **2** | [Profile & Budget](02-profile-budget.md) | ✅ Done |
| **3** | [Data Pipeline & Charts](03-data-pipeline-charts.md) | ✅ Done |

## New Roadmap (Phases 4–10)

| Phase | Plan File | Description |
|---|---|---|
| **4** | [Multi-Coin Market Explorer](04-multi-coin-market-explorer.md) | All 50+ Delta coins with live prices, search, sparklines, charts |
| **5** | [Technical Analysis Engine](05-technical-analysis-engine.md) | 35+ patterns, 20+ indicators, S/R, Smart Money, confluence |
| **6** | [Gemini AI Signal Engine](06-gemini-ai-signal-engine.md) | 5-min AI scan cycles, structured signals, position sizing |
| **7** | [One-Click Trading & Orders](07-one-click-trading-orders.md) | Trade execution, confirm/edit dialogs, positions, history |
| **8** | [Paper Trading (Dummy Mode)](08-paper-trading-dummy-mode.md) | Virtual wallet, simulated trades, separate analytics |
| **9** | [Risk, Analytics & Self-Learning](09-risk-analytics-self-learning.md) | Signal tracking, AI corrections, budget enforcement, dashboards |
| **10** | [Notifications, Polish & Deploy](10-notifications-polish-deployment.md) | Sound alerts, mobile responsive, VPS deployment |

## Architecture

- [Master Plan](00-master-plan.md) — Full technical spec, schemas, indicators, patterns

## Key Design Decisions

- **No coin selection step** — ALL coins are always available for charting, analysis, and trading
- **AI pre-screens all coins** — 2-stage scan: fast ticker filter → deep analysis on top candidates
- **Two account modes** — LIVE (real money) and PAPER (virtual wallet) with identical UX
- **Self-learning AI** — Tracks its own accuracy, learns from mistakes, improves prompts over time
- **Safety-first trading** — Code-enforced limits on leverage, position size, risk %, daily loss
