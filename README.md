# Transcript Viewer

A web app for viewing, analyzing, and annotating AI conversation transcripts. Built with SvelteKit.

## Features

- View conversation transcripts with branching/rollback support
- Add comments and highlights to specific messages
- Filter transcripts by scores, models, tags
- Folder-based navigation
- Real-time file watching (auto-refreshes when transcripts change)

## Quick Start

```bash
# Clone the repo
git clone git@github.com:aengusl/transcript-viewer.git
cd transcript-viewer

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Edit .env to point to your transcripts folder
# TRANSCRIPT_DIR=/path/to/your/transcripts

# Start dev server
npm run dev
```

Open http://localhost:5173

## Example Transcript

An example transcript with comments is included in `outputs/`. Run the app and click on it to see how comments and highlights work.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSCRIPT_DIR` | `./outputs` | Directory containing transcript JSON files |
| `ANTHROPIC_API_KEY` | - | Optional. Only needed for "regenerate summary" feature |
| `CACHE_SIZE` | `50` | Max transcripts cached in memory |
| `CACHE_WATCH` | `true` | Auto-refresh when files change |

## Transcript Format

Transcripts are JSON files. See the example in `outputs/` for the expected structure. Key fields:

- `metadata.id` - Unique identifier
- `metadata.scenario_name` - Name of the scenario
- `metadata.judge_output.summary` - AI-generated summary
- `metadata.user_comments` - User annotations (added via UI)
- `events` - The conversation messages

## Development

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run preview  # Preview production build
npm run check    # Type check
```

## License

MIT
