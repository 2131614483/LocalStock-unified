# LocalStock Unified

<img src="docs/_shots/desktop-watchlist.png" width="900">

> A fully local quantitative workstation: Electron desktop app + JoinQuant-compatible backtesting service + unified market database + Price Action AI. No cloud, no login, no data leaves your machine.

## Demo Video

English narration: [`docs/项目讲解_EN.mp4`](docs/项目讲解_EN.mp4) (2:00)
中文解说：[`docs/项目讲解.mp4`](docs/项目讲解.mp4)（1:42）

## Overview

LocalStock Unified consolidates a desktop charting client, a local research/backtesting service, a unified market database, and a strategy knowledge base into one workspace. Three components:

- **Desktop app** `apps/desktop`: Electron + React — watchlist, A-share market, multi-period K-lines, backtest editor, alerts, drawing tools, AI assistant
- **JoinQuant service** `services/joinquant-local`: Node Express + Python on port 3000 — factor computation and strategy backtesting (based on the open-source JoinQuant package under the MIT license)
- **Price Action AI** `apps/desktop/python/pa-agent`: Al Brooks two-stage reasoning, launched automatically by the desktop app

The single authoritative market database is `data/market/stock_data.db` (~6.7 GB, 5973 A-share stocks, ~18.84 million daily bars from 1991-06-01 to today).

## Quick Start

```powershell
cd D:\pythonpro\LocalStock-unified
npm run install:all
npm run verify:workspace
powershell -ExecutionPolicy Bypass -File .\tools\start-all.ps1
```

Or start components individually:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\start-quant.ps1
powershell -ExecutionPolicy Bypass -File .\tools\start-desktop.ps1
```

## Features

### Market Browsing

<img src="docs/_shots/desktop-watchlist.png" width="900">
*Watchlist: red-up/green-down, real-time refresh*

<img src="docs/_shots/desktop-market.png" width="900">
*Full A-share market: 5973 stocks*

<img src="docs/_shots/desktop-minute.png" width="900">
*Intraday chart: price + VWAP + previous close*

### Multi-period K-lines

<img src="docs/_shots/desktop-dayk.png" width="900">
*Daily: candles + MA + Level-2 order book + drawing + news feed*

<img src="docs/_shots/desktop-weekk.png" width="900">
*Weekly: aggregated from local daily data*

<img src="docs/_shots/desktop-monthk.png" width="900">
*Monthly: long-term positioning*

Timeframes go from 1-minute up to quarterly: 1, 5, 15, 30, 60, 120 minutes, plus daily, weekly, monthly, quarterly. Overlaid with MA, MACD, KDJ, Bollinger Bands, Level-2 order book, and all indicator parameters are fully customizable.

### Tools

<img src="docs/_shots/desktop-backtest.png" width="900">
*Backtest editor: strategy templates + CodeMirror Python*

<img src="docs/_shots/desktop-alert.png" width="900">
*Alerts: MA golden cross / death cross, instant scan across the whole market*

<img src="docs/_shots/desktop-drawing.png" width="900">
*Drawing: six tool types — trend line, ray, horizontal, rectangle, Fibonacci, channel. Draw by hand, or let AI draw for you.*

### AI & Settings

<img src="docs/_shots/desktop-ai-page.png" width="900">
*AI assistant standalone page: read market data / write strategies / screen stocks*

<img src="docs/_shots/desktop-pa.png" width="900">
*Price Action AI: Kweichow Moutai 600519 daily + EMA20 + multi-stage analysis*

<img src="docs/_shots/desktop-settings.png" width="900">
*Global settings: market refresh / chart hotkeys / AI backend configuration*

Model backend supports DeepSeek, OpenCode, Anthropic, and local Ollama. API keys stay in runtime memory only, never written to disk.

### JoinQuant Service

<img src="docs/_shots/jq-algorithms.png" width="900">
*Strategy list: 12 factor strategies*

<img src="docs/_shots/jq-home.png" width="900">
*Turtle multi-factor backtest: total return 49.53% / annualized 23.20% / Sharpe 0.65*

## Design Philosophy

The entire product is **AI-first**: the AI reads all market, K-line, intraday and order book data, and can analyze, draw, run backtests and screen stocks. Write operations are limited to three categories, fully audited and one-click rollbackable.

Market data is sourced redundantly from Eastmoney, Tencent and Sina, with support for independent monitoring windows, always-on-top dashboards, and detachable floating views.

## Roadmap

- **Strategy knowledge base** built in, accumulating historical conversations and validated strategies
- **Knowledge graph** for self-evolving algorithms
- **Networked platform** integration for extended capabilities
- **Automated factor mining**

## Core Directories

| Directory | Purpose |
|---|---|
| `apps/desktop` | LocalStock Electron/React desktop app |
| `services/joinquant-local` | JoinQuant-compatible data, factor and backtest service |
| `data/market` | Single authoritative market database |
| `data/runtime` | Desktop config, backtest results, runtime data |
| `knowledge/strategy-library` | AI strategy knowledge base |
| `knowledge/conversations` | Accumulated historical conversations |
| `docs/migration` | Architecture, migration checklist, verification records |
| `tools` | Unified environment, startup and verification scripts |

## License

The JoinQuant-compatible backtesting service is based on the open-source [JoinQuant](https://github.com/joinquant/joinquant) package under the **MIT License**.
