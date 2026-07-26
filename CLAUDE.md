# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CogniLink — A local-first intelligent knowledge management and learning assistant with RAG, multi-model LLM support, memory extraction, and knowledge graph-based learning. The platform covers six CS domains: programming (Python), data structures & algorithms, OOP & architecture, OS & concurrency, networking, and databases.

## Commands

### Frontend (from `frontend/`)
```bash
npm run dev          # Development server (http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
```

### Backend (from `backend/`)
```bash
python main.py                    # Development server (http://localhost:8000)
uvicorn main:app --reload         # Alternative with hot reload
python seed_data.py               # Seed knowledge graph + agents + labs
pytest tests/ -q                  # Run all backend tests
pytest tests/test_x.py -q         # Single test file
pytest tests/test_x.py::test_name -q  # Single test function
```

### Docker
```bash
docker-compose up -d              # Start PostgreSQL 16 + pgvector
docker-compose down               # Stop services
```

## Environment Setup

### System Dependencies for RAG (unstructured)

The `unstructured` library requires these system packages:

```bash
# Ubuntu/Debian
sudo apt install poppler-utils tesseract-ocr libmagic1

# macOS
brew install poppler tesseract libmagic

# Windows
# 1. poppler — download binaries from GitHub releases (oschwartz10612/poppler-windows)
#    Extract to C:\poppler-24.08.0\ and add C:\poppler-24.08.0\Library\bin to PATH
# 2. tesseract — winget install UB-Mannheim.TesseractOCR
#    (Chinese OCR handled by RapidOCR/pymupdf4llm; tesseract is a fallback)
# 3. libmagic — pip install python-magic-bin (provides the Windows DLL)
```

### BGE-M3 Local Embedding (Ollama)

Deploy BGE-M3 to Ollama for offline embedding generation:

```bash
# 1. Download BGE-M3 GGUF from ModelScope
pip install modelscope
modelscope download --model BAAI/bge-m3-gguf --local_dir ./bge-m3-gguf

# 2. Create Modelfile
cat > Modelfile << 'EOF'
FROM ./bge-m3-gguf/bge-m3-Q5_K_M.gguf
TEMPLATE "{{ .Prompt }}"
EOF

# 3. Create the model in Ollama
ollama create bge-m3 -f Modelfile

# 4. Verify
curl http://localhost:11434/api/embeddings -d '{"model":"bge-m3","prompt":"test"}'
```

After setup, enable the local embedding toggle in frontend settings — this routes embedding requests to `http://localhost:11434` instead of cloud API providers.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16 + React 19 + TypeScript 5 + TailwindCSS 4 + shadcn/ui + Zustand 5 |
| Backend | FastAPI + SQLAlchemy (async) + LiteLLM + pgvector |
| Database | PostgreSQL 16 + pgvector extension (via `pgvector/pgvector:pg16` Docker image) |
| Charts | ECharts 6 (radar charts, knowledge graph visualization) |
| Auth | JWT (PyJWT) + bcrypt (via passlib) |
| AI/Agent | LiteLLM + LangGraph (StateGraph multi-agent orchestration) |

## Architecture

### Backend Service Layer

Services are instantiated as module-level singletons (e.g., `llm_service = LLMService()`). Each API route depends on one or more services:

| Service | Responsibility |
|---------|---------------|
| `llm_service` | Streaming chat via LiteLLM `acompletion`. Builds system prompt from RAG context + memory context + agent system prompt. Supports tool calling. |
| `rag_service` | Vector similarity search on `document_chunks` using cosine distance. Annotates chunks with `[source: doc_name, page N]`. |
| `embedding_service` | Embedding generation via local Ollama BGE-M3 only (1024-dim, `EMBEDDING_DIM`). Provider params kept for interface compat but unused. Raises a clear error when Ollama is unreachable. |
| `memory_service` | CRUD for memories + semantic search + auto-extraction from conversations via LLM with importance/whitelist/blacklist filtering. |
| `conversation_service` | Conversation persistence with smart context window management: token counting (tiktoken), auto-summary compression after ~20 messages or 100K tokens, message dedup via `is_summarized` flag. |
| `document_service` | Multi-format parsing with fallback chain for PDF (pymupdf4llm → pypdf → pymupdf → pdfplumber → ocrmac → RapidOCR). Semantic chunking via `unstructured` library. |
| `document_processor` | In-memory background job tracker for document processing progress (pending → processing → completed/failed). |
| `tools_service` | Agent tools: calculator, datetime, DuckDuckGo web search. Registered in OpenAI function-calling format. |
| `evaluation_service` | LLM-powered code evaluation + quiz scoring + dynamic exercise generation tailored to user weak points. Supports 6 exercise types: code, quiz, match, fill, arrange, judge. |
| `knowledge_service` | Knowledge node CRUD, user proficiency tracking, PageRank computation, adaptive learning path recommendations. |
| `knowledge_extraction_service` | Post-upload: LLM analyzes document chunks in batches → extracts key concepts → generates `KnowledgeNode` + `KnowledgeRelation` records + links chunks to nodes. |
| `graph_service` | RAG six-stage pipeline (`run_stream`, primary chat path): 1 memory load → 2 LLM query rewrite & split → 3 intent-tree classification (chitchat/knowledge_qa/practice_request/realtime_query + 6 CS domains + teaching style) → 4 ambiguity gate (asks clarifying question and short-circuits) → 5 parallel retrieval (multi-sub-query hybrid BM25+vector+RRF channel, web-search tool channel) → 6 prompt assembly + true streaming. Legacy LangGraph `StateGraph` (orchestrator → rag_bot) kept for `run()`. |
| `agent_service` | CRUD for AI mentors (agents table). Three default mentor archetypes: humor_mentor, academic_mentor, coach_mentor — each with domain-aware system prompts covering all 6 CS categories. |
| `lab_service` | Lab exercise CRUD, filtering by type/difficulty/node, user submission tracking. |
| `profile_service` | Aggregated user learning stats: lighted nodes, pass rate, study duration, memory count, 6-dimension radar chart data. |
| `collection_service` | User exercise collection/favorites with duplicate checking. |

### Database Models (key tables)

- **users** — with role field (student/teacher/admin), JWT auth via bcrypt password hashing
- **agents** — 3 seeded mentors (humor_mentor/academic_mentor/coach_mentor), each with domain-aware system prompts that adapt to whichever of the 6 CS categories is queried
- **knowledge_bases** — logical groupings of documents and their extracted knowledge nodes
- **documents** → **document_chunks** (with pgvector embedding + element_type + page_number + node_id FK)
- **conversations** → **messages** (with token counting, summary compression, soft delete; linked to users and agents)
- **memories** + **memory_settings** (per-user auto-extract config: whitelist/blacklist/min_importance; unique on (user_id, key))
- **knowledge_nodes** → **knowledge_relations** (directed graph with pagerank_weight; 6 categories: programming, dsa, organization, os, network, database; source field: learning_path | extraction)
- **user_knowledge_states** (proficiency, pagerank_score, is_lighted, study_duration per user per node)
- **labs** → **user_lab_submissions** (exercises with test_cases, lab_type: code/quiz, difficulty; submissions with ai_feedback and score)
- **user_collection_exercises** (user-saved exercises with full content/answer/explanation JSON)

### API Routes

| Prefix | File | Key Endpoints |
|--------|------|--------------|
| `/api` | `chat.py` | `POST /chat` (streaming), `POST /chat/rag` (RAG+memory+tools+agent), `GET /tools` |
| `/api/documents` | `documents.py` | Upload, list, search, content with pagination, reprocess, batch-delete, status polling, knowledge base CRUD |
| `/api/conversations` | `conversations.py` | CRUD, search by title/content, message history |
| `/api/memories` | `memories.py` | CRUD, semantic search, extract from text, settings management |
| `/api/auth` | `auth.py` | `POST /login`, `POST /register`, `GET /me` (JWT Bearer token) |
| `/api/knowledge` | `knowledge.py` | Graph data, node labs, PageRank compute, learning path recommendations |
| `/api/labs` | `labs.py` | Lab list (filterable), submit + evaluate, dynamic generation, instant evaluation |
| `/api/profile` | `profile.py` | User learning stats, 6-dimension radar data |
| `/api/admin` | `admin.py` | Dashboard stats, AI evaluation diagnosis, user/student/document/lab/agent/knowledge management |
| `/api/collections` | `collections.py` | Exercise collection CRUD, duplicate check |

### Auth Flow

- All non-auth endpoints require `Authorization: Bearer <jwt_token>` header
- Dependency chain: `get_current_user` (parses JWT, loads User) → `get_admin_user` (role check) or `get_teacher_or_admin_user`
- Frontend stores token in `localStorage` under key `cognilink_token`; `getAuthHeaders()` reads it for every request
- Default admin account: username `Kleinle`, password from `ADMIN_INITIAL_PASSWORD` in backend/.env (defaults to `123456` for local dev; startup warns if unchanged)
- Server refuses to start when `SECRET_KEY` is empty

### Chat Data Flow

```
User sends message → POST /api/chat/rag
  → get_current_user (JWT auth)
  → conversation_service.get_optimized_context() (summary + recent messages)
  → llm_service.stream_chat()
    → [optional] rag_service.get_context_for_query() → embedding_service.get_single_embedding() → pgvector cosine_distance
    → [optional] memory_service.get_memory_context() → embedding + cosine_distance
    → [optional] tools_service for function calling (calculator, datetime, web search)
    → [optional] agent_service for mentor system prompt injection
    → LiteLLM acompletion (streaming) with OpenAI-compatible base URL
  → conversation_service.add_message() (both user + assistant)
  → [background] generate_summary() if token/message threshold exceeded
  → [background] _extract_memories_background() if use_memory enabled
```

### Document Processing Flow

```
Upload → save file → create Document record (status: "processing")
  → background asyncio.create_task(_process_document_async)
    → parse_document_structured() → unstructured.partition
    → chunk_text_structured() → unstructured.chunk_by_title (semantic)
    → embedding_service.get_embeddings() → batch embed all chunks
    → insert DocumentChunk rows with embeddings
    → [if use_extraction] knowledge_extraction_service.extract_nodes_from_document()
      → LLM batch-analyzes chunks → creates KnowledgeNode + KnowledgeRelation → links chunks to nodes
    → status: "completed"
```

### LangGraph Multi-Agent Workflow

Triggered from the practice/graph pages for domain-aware tutoring:

1. **Orchestrator** — classifies the user's question into 1 of 6 CS domains (programming/dsa/organization/os/network/database)
2. **RagBot** — performs hybrid retrieval: BM25 keyword search + pgvector cosine similarity, fused via Reciprocal Rank Fusion (RRF)
3. **Reviewer** — receives domain-specific teaching persona (game/tool metaphors per domain) + retrieved context, generates the final pedagogical response

### Exercise System

Six exercise types across two lab categories:
- **code** — Python coding with test case evaluation
- **quiz** — multiple-choice with LLM explanation
- **match, fill, arrange, judge** — gamified interactive formats

Exercises can be seeded, dynamically generated by AI (targeting user weak spots), or collected/favorited by users. Dynamic generation with `POST /api/labs/generate` optionally auto-selects the user's weakest knowledge node.

## Key Implementation Details

### LLM Integration
- Uses **LiteLLM** `acompletion` with `openai/{model}` prefix when custom base_url is provided — this routes through LiteLLM's OpenAI-compatible adapter
- Model and API key are passed **per-request** from the frontend (not from server config) for chat and lab endpoints; admin document processing uses server-configured defaults
- Default model is `deepseek-v4-flash` with a hardcoded default API key in both frontend settings store and backend config

### Embedding Providers
- Embedding service **bypasses LiteLLM** — uses direct `openai.AsyncOpenAI` client for most providers
- Zhipu has special handling: uses native `zhipuai` SDK with JWT auth for real API, falls back to `AsyncOpenAI` for proxy setups
- Local embedding via Ollama's `/api/embeddings` endpoint with `bge-m3` model, concurrent requests with semaphore (max 10)

### Conversation Context Management
- Token counting via `tiktoken`; falls back to `len(text)//4` estimation
- When messages exceed 20 or tokens exceed 100K, the service auto-generates a summary of the first half of messages and marks them `is_summarized=1`
- `get_optimized_context()` returns: summary as system message + most recent unsummarized messages (newest first, up to 120K token budget)

### Database
- Async SQLAlchemy with `asyncpg` driver (URL rewritten from `postgresql://` to `postgresql+asyncpg://`)
- `init_db()` enables pgvector extension and creates all tables on startup
- Ad-hoc column additions via `ALTER TABLE ADD COLUMN IF NOT EXISTS` for schema evolution (no Alembic migrations in use)

### Frontend State
- Zustand stores: `settings.ts` (persisted to localStorage: API keys, model selection, feature toggles) and `chat-assistant.ts` (floating chat assistant state)
- Multi-provider API key management (OpenAI, Anthropic, Google, DeepSeek, Alibaba, Zhipu, Moonshot, Cohere, Mistral)
- Feature toggles: `useRAG`, `useMemory`, `useLocalEmbedding` (defaults to true for local BGE-M3)
- Supported models: Gemini 3.1/3 series, DeepSeek V4 series, GLM-4.7/5 series

### Seed Data
- Auto-runs on startup via `lifespan` handler in `main.py`
- **Cleanup-first approach**: detects and removes old `learning_path` nodes, then re-seeds
- Seeds 3 AI mentors (humor_mentor, academic_mentor, coach_mentor) with domain-aware system prompts
- Seeds 41 knowledge graph nodes across 6 CS domains (programming, dsa, organization, os, network, database) with prerequisite dependency relations
- Seeds coding labs with test cases
- Idempotent: skips if nodes already exist (unless old-format nodes are detected, which triggers cleanup)

### PDF Parsing Fallback Chain
Order of attempt for PDF extraction:
1. `pymupdf4llm` (best — markdown output with structure)
2. `pypdf` (reliable text extraction)
3. `pymupdf` (fitz)
4. `pdfplumber` (good for tables)
5. `ocrmac` (macOS native OCR, zh-Hans + en-US)
6. `RapidOCR` (cross-platform ONNX-based OCR)

First extractor producing ≥60 meaningful alphanumeric chars terminates the chain. If no extractor reaches the threshold, the first non-empty result is returned.

### Frontend Pages
- `/` — Landing page
- `/login` — JWT login/register
- `/dashboard` — Learning dashboard with stats overview
- `/knowledge` — Document upload, list, search, preview; knowledge base management
- `/graph` — Knowledge graph visualization (ECharts) with LangGraph-powered domain tutoring
- `/practice` — Lab exercises with dynamic AI generation and instant evaluation
- `/memories` — Memory management and settings
- `/settings` — API key configuration, model selection
- `/profile` — User profile, learning stats, 6-dimension radar chart
- `/admin` — Admin dashboard with AI evaluation diagnosis
- `/admin/students` — Student management with mock data
- `/admin/users` — User management
- `/admin/knowledge` — Knowledge node management
- `/admin/labs` — Lab/question bank management with batch AI generation
- `/admin/agents` — Agent/mentor management

### Branch Strategy
| Branch | Purpose |
|--------|---------|
| `main` | Stable releases, merge from develop only |
| `develop` | Daily development, all features iterate here |
| `feature/xxx` | Feature branches, merge back to develop |
| `hotfix/xxx` | Emergency fixes, sync to both main and develop |

## Behavioral Rules

- **No emojis or decorative icons** in code comments, commit messages, PR descriptions, or chat responses.
- **Keep descriptions minimal, specific, and functional** — no filler phrases like "Let's do it!" or "No emojis. Only clean code."
- **Prefer small, surgical diffs** over large stylistic rewrites. Mirror local patterns in the target file.
- **Verify executable commands** against real config files (package.json, requirements.txt) before running or documenting — prose docs may have drifted.
- **Validate changed surface area**: run `npm run lint` for frontend changes, `pytest` for backend changes.
