from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import topics, chat, reasoning, queries, search, recognise, matrix, systems, synthesis, gaps, final_question, prompts, assistant

app = FastAPI(title="Topic Generator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:5176"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


@app.get("/api/health")
def health():
    return {"status": "ok"}
