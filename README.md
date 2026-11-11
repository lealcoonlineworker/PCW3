# PathwayConnect W03 Live Q&A

Self-hosted English live quiz for the PC 101 Week 3 gathering. Students join with a session code, answer on their phones, and see immediate feedback and their score. The facilitator sees live totals, correct/incorrect counts per question, and a session scoreboard.

## Features

- Five English-language questions based on the devotional and Week 3 goals topic.
- Anonymous participant IDs; the app does not ask for a name or email address.
- Immediate right/wrong feedback and explanation after each scored answer.
- Participant score shown as correct answers out of four scored questions. The final reflection question is not graded.
- Facilitator dashboard with live answer distribution, correct/incorrect totals, and per-question results.
- Nine embedded gathering slides, synchronized live for the facilitator and participants. The facilitator advances the shared slide, and learners can switch between slides and Q&A during breakout rooms.
- Real-time dashboard and slide updates with Socket.IO, plus automatic refresh as a fallback.
- SQLite database stored on a persistent Docker volume.

## Deploy with Coolify

1. Extract this ZIP file and put its contents at the root of a Git repository. Push it to GitHub, GitLab, or another Git provider that Coolify can access.
2. In Coolify, create a Git-based application and select the Docker Compose build method. Set the Base Directory to `/` and the Compose file location to `/docker-compose.yml`.
3. Add a domain to the `pathway-live-qa` service and set its internal port to `3000`. The Compose file exposes port 3000 and includes a health check.
4. Deploy. Once the health check passes, open the assigned domain.

The `pathway-live-data` Docker volume stores the SQLite database at `/data/pathway-live.sqlite`. Keep this volume attached when redeploying; it contains sessions and anonymous answers. The app is designed to run as one service instance using SQLite.

## Run locally with Docker Compose

From the folder containing `docker-compose.yml`:

```bash
docker compose up --build -d
```

Open `http://localhost:3000`. To stop the app without deleting its saved quiz data:

```bash
docker compose down
```

Do not add `-v` to the `down` command unless you intend to delete the quiz database volume.

## Use the app

- **Facilitator:** open the app, choose “Facilitator? Start a session,” create a session, and share the code or join link.
- **Students:** open the app link and enter the session code. Their answers are anonymous; each browser keeps a random participant ID so it can calculate that student’s score.
- **Facilitator:** advance each question from the dashboard and use the Shared slides tab to control the slide shown to everyone.
- **Students:** use the Shared slides tab to follow the gathering and breakout instructions. The displayed slide changes when the facilitator advances it.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `/data/pathway-live.sqlite` | SQLite database path |

No API keys or third-party accounts are required.
