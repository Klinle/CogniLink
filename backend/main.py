from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from api.chat import router as chat_router
from api.documents import router as documents_router
from api.memories import router as memories_router
from api.conversations import router as conversations_router
from api.auth import router as auth_router
from api.knowledge import router as knowledge_router
from api.labs import router as labs_router
from api.profile import router as profile_router
from api.admin import router as admin_router
from api.collections import router as collections_router
from api.reviews import router as reviews_router
from api.onboarding import router as onboarding_router
from core.database import init_db
from core.config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    if not settings.SECRET_KEY:
        raise RuntimeError(
            "SECRET_KEY is empty. Set SECRET_KEY in backend/.env before starting the server, "
            "otherwise JWT tokens could be forged."
        )
    await init_db()
    try:
        from seed_data import seed_all_data
        await seed_all_data()
    except Exception as e:
        print(f"[Error] Failed to inject seed data: {e}")
    yield
    # Shutdown

app = FastAPI(title="CogniLink API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)

app.include_router(chat_router)
app.include_router(documents_router)
app.include_router(memories_router)
app.include_router(conversations_router)
app.include_router(auth_router)
app.include_router(knowledge_router)
app.include_router(labs_router)
app.include_router(profile_router)
app.include_router(admin_router)
app.include_router(collections_router)
app.include_router(reviews_router)
app.include_router(onboarding_router)

@app.get("/")
async def root():
    return {"message": "CogniLink API"}

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
