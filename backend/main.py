import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import topics, chat, reasoning, queries, search, recognise, matrix, systems, synthesis, gaps, final_question, prompts, assistant, bridge, projects
from reporter import OrchestrationReporter
from analytics.middleware import AnalyticsMiddleware
from analytics.router import router as analytics_router
from analytics import db as analytics_db

app = FastAPI(title="Topic Generator API", version="1.0.0")

# Pre-open the analytics DB connection at startup
analytics_db.init()

_origins_env = os.getenv("CORS_ORIGINS", "")
_origins = (
    [o.strip() for o in _origins_env.split(",") if o.strip()]
    if _origins_env
    else ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:5176"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Analytics must be added before OrchestrationReporter so it captures
# the request before the body is consumed by the reporter middleware.
app.add_middleware(AnalyticsMiddleware)
app.add_middleware(OrchestrationReporter)

app.include_router(analytics_router)
app.include_router(topics.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(reasoning.router, prefix="/api")
app.include_router(queries.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(recognise.router, prefix="/api")
app.include_router(matrix.router, prefix="/api")
app.include_router(systems.router, prefix="/api")
app.include_router(synthesis.router, prefix="/api")
app.include_router(gaps.router, prefix="/api")
app.include_router(final_question.router, prefix="/api")
app.include_router(prompts.router, prefix="/api")
app.include_router(assistant.router, prefix="/api")
app.include_router(bridge.router, prefix="/api")
app.include_router(projects.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
