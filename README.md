# Transcript Viewer

A web app for viewing and annotating AI conversation transcripts.

![Demo](static/demo.gif)

## Quick Start

```bash
git clone git@github.com:aengusl/transcript-viewer.git
cd transcript-viewer
npm install
cp .env.example .env
# Set TRANSCRIPT_DIR in .env to point to your transcripts folder
npm run dev
```

Open http://localhost:5173

## Features

**Beautiful UI** — Dark mode, bold message tiles, full-width transcript view

**Keyboard shortcuts** — `Cmd+U` comment, `Cmd+I` highlight, `Cmd+J` sidebar, `Cmd+K` search

**Comments** — Sign in as guest or user, leave feedback on specific messages

**Slideshow view** — Highlight text, add descriptions, flick through key moments

**Summary regeneration** — Include comments, highlights, custom instructions. Summaries cite specific messages.

**Filtering** — Search transcripts, filter by system prompt, tool calls, or messages with comments

**Branches** — View different conversation branches the auditor took before rollbacks

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `TRANSCRIPT_DIR` | Yes | Directory containing transcript JSON files |
| `ANTHROPIC_API_KEY` | No | Only needed for summary regeneration feature |

## License

MIT
