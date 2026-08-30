from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from .routes import ai, contents, preferences, recommendations

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="EntertainmentAI API",
    version="1.0.0",
    description="Universal entertainment discovery and recommendation API.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(contents.router)
app.include_router(recommendations.router)
app.include_router(ai.router)
app.include_router(preferences.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "entertainment-api"}
