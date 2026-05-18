# ResearchAI — Topic Generator

An AI-powered research assistant that guides you through every stage of a systematic literature review: from defining a research topic to synthesising papers, identifying gaps, and generating a final research question.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite, served by Nginx |
| Backend | Python FastAPI + Uvicorn |
| AI | OpenAI API (GPT-4o) |
| Deployment | Docker + Docker Compose |

---

## Quick Start (Docker)

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed
- An **OpenAI API key** — get one at [platform.openai.com](https://platform.openai.com)

### 1 — Clone the repository

```bash
git clone https://github.com/TPP-PROJECTS/topic-generator.git
cd topic-generator
```

### 2 — Create your environment file

Copy the example and add your API key:

```bash
cp .env.example .env
```

Open `.env` and fill in your key:

```env
OPENAI_API_KEY=sk-...your-key-here...
```

> **Never commit `.env` to git.** It is already listed in `.gitignore`.

### 3 — Build and start

```bash
docker compose up --build -d
```

This builds both images and starts two containers:

| Container | Role |
|-----------|------|
| `frontend` | Nginx — serves the React app on port **80** and proxies `/api/` to the backend |
| `backend` | FastAPI — runs on internal port 8000 (not exposed to the host) |

### 4 — Open the app

```
http://localhost
```

If you're running on a remote server, replace `localhost` with the server's IP address:

```
http://<your-server-ip>
```

---

## Stopping and restarting

```bash
# Stop containers (data is preserved)
docker compose down

# Start again (no rebuild needed)
docker compose up -d

# Rebuild after a code change
docker compose up --build -d
```

## Viewing logs

```bash
# All containers
docker compose logs -f

# Backend only
docker compose logs -f backend

# Frontend (Nginx) only
docker compose logs -f frontend
```

---

## Deploying to a remote server (e.g. Ubuntu on AWS / DigitalOcean)

```bash
# 1. SSH into the server
ssh -i /path/to/key.pem ubuntu@<server-ip>

# 2. Install Docker (if not already installed)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker          # apply group change without logout

# 3. Clone the repo
git clone https://github.com/TPP-PROJECTS/topic-generator.git
cd topic-generator

# 4. Set up env
cp .env.example .env
nano .env              # paste your OPENAI_API_KEY

# 5. Build and run
docker compose up --build -d
```

The app will be available at `http://<server-ip>`.

---

## Project structure

```
topic-generator/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── routers/             # API route handlers
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── screens/         # Step 1–8 screen components
│   │   ├── components/      # Shared UI components
│   │   ├── store/           # Global state (AppContext / useReducer)
│   │   ├── lib/             # Utilities (API client, export, session storage)
│   │   └── types/           # TypeScript types
│   ├── nginx.conf           # Nginx config (SPA routing + API proxy)
│   └── Dockerfile
├── docker-compose.yml
├── .env.example             # Template — copy to .env and fill in your key
└── README.md
```

## Workflow steps

| Step | Screen | Description |
|------|--------|-------------|
| 1 | Chat & Define | Conversational topic definition, builds a Research Profile |
| 2 | System Review | Select databases and AI tools to search |
| 3 | Explore & Search | AI-recommended topics and search queries |
| 4 | Select Papers | Screen search results, build a review list |
| 5 | Matrix | Literature and system comparison matrices |
| 6 | Synthesis | Theme-based synthesis with AI-generated analysis blocks |
| 7 | Gap & Statement | Identify research gaps, draft a gap statement |
| 8 | Final Question | AI-generated research questions and study design |

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | ✅ | Your OpenAI API key |
| `CORS_ORIGINS` | ❌ | Comma-separated allowed origins (dev only — leave unset in Docker) |
