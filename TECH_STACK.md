# PUPSJ HUB — System Architecture & Tech Stack

This document provides a comprehensive overview of the programming languages, AI/ML models, frameworks, database architectures, and libraries used across the **PUPSJ HUB** Progressive Web Application.

---

## 1. Programming & Markup Languages

| Language | Primary Role in System |
| :--- | :--- |
| **JavaScript (ES6+ / Node.js & Vanilla JS)** | • **Backend Server:** Express.js REST API, authentication, middleware, business logic, MySQL connection pooling, and email delivery (`src/`).<br>• **Frontend SPA:** Single-Page Application client logic, DOM rendering, client-side routing, state management, modal interactions, and theme controls (`public/js/app.js`). |
| **Python (3.10+)** | • **AI Microservice:** Asynchronous FastAPI microservice (`ai/api.py`).<br>• **Machine Learning:** Training pipelines (`ai/ml/`), handbook document ingestion & chunking (`ai/ingest.py`), sentiment classification, and vector embedding indexing. |
| **SQL (MySQL 8.0+ Dialect)** | • InnoDB database schema definitions, relational constraints, foreign keys, cascade triggers, and performance indexes (`database/schema.sql`). |
| **HTML5** | • Root Single Page Application shell, PWA metadata, mobile viewport meta configurations, and service worker registration (`public/index.html`). |
| **CSS3 (Vanilla CSS)** | • Custom styling architecture, CSS custom properties (variables), light/dark mode theming, glassmorphism UI elements, transitions, and responsive mobile drawers (`public/css/app.css`). |
| **TypeScript (Typings)** | • Development-time type definitions (`@types/*`) for Node, Express, Multer, JWT, and build verification (`tsconfig.json`). |
| **Batch Scripting (.bat)** | • Windows automation scripts for server lifecycle management, port cleanup, and daemon autostart (`start.bat`, `stop.bat`, `setup-autostart.bat`). |

---

## 2. Artificial Intelligence & Machine Learning Stack

### A. Large Language Models (Generative AI)
* **Primary Cloud LLM Engine**
  * **Role:** Primary Generative AI engine for the campus assistant (**PUPBot**).
  * **Capabilities:** Generates context-grounded answers combining handbook vector context, live announcements, upcoming events, documents, and real-time database knowledge.
* **High-Throughput Cloud Inference Engine**
  * **Role:** Low-latency inference provider with automatic fallback cascading across high-throughput models.
* **Local Offline Fallback Micro-Model**
  * **Role:** Runs locally as an offline circuit-breaker fallback when remote cloud APIs are unreachable.

---

### B. Deep Learning & Embedding Models (NLP & Vision)
* **Multilingual Dense Semantic Embedding Model**
  * **Role:** Multilingual text embedding model running locally on CPU.
  * **Capabilities:** Transforms handbook chunks into dense vectors to power semantic search for **English, Tagalog, and Taglish** user queries.
* **Multimodal Vision-Language Transformer**
  * **Role:** Multimodal feature extraction for the **Lost & Found** system.
  * **Capabilities:** Extracts visual embeddings from uploaded item photos to compare image-to-image similarity and cross-match text descriptions with images.

---

### C. Classical Machine Learning Models & Pipelines (Scikit-Learn)
* **Sentiment Analysis Model (`sentiment_model.pkl`)**
  * **Pipeline:** Scikit-learn Pipeline utilizing FeatureUnion (Character n-grams + Word n-grams for Tagalog morphology) with **Logistic Regression**.
  * **Features:** Filipino vernacular detection, negation-window analysis, and gibberish filtering.
* **Global Feedback TF-IDF Model (`global_feedback_tfidf.pkl`)**
  * **Role:** Global vocabulary TF-IDF vectorizer used to extract event feedback themes even from small comment samples.
* **Unsupervised Topic Clustering (KMeans)**
  * **Role:** Clusters negative feedback comments using `sklearn.cluster.KMeans` and cosine similarity to automatically synthesize student complaints into actionable suggestions.
* **Hybrid RAG Retriever (Reciprocal Rank Fusion)**
  * **Role:** Fuses dense semantic vector retrieval with sparse lexical search (BM25 + TF-IDF) using **Reciprocal Rank Fusion (RRF)**.
* **Lost & Found Heuristic Matcher (`lostfound_matcher.pkl` / `lostfound_model.py`)**
  * **Role:** Weighted rule-based & NLP matcher calculating match confidence across brand, color palettes, item categories, date proximity, and location.

---

## 3. Core Frameworks & Runtimes

* **Node.js (v18+)** — Core backend runtime environment.
* **Express.js (v5.2.1)** — Primary REST API server, routing layer, and static asset server.
* **Python (v3.10+)** — AI sidecar and machine learning runtime.
* **FastAPI (v0.115.5) & Uvicorn (v0.32.1)** — Asynchronous high-concurrency microservice running on port 8001.
* **MySQL (v8.0+)** — Relational database engine utilizing InnoDB, relational constraints, and indexes.

---

## 4. Key Libraries & Dependencies

### Node.js Backend Ecosystem
* `mysql2` (v3.13+) — High-performance MySQL connection pool and Promise-based query execution.
* `uuid` (v11.1+) — RFC4122 UUID generation.
* `bcryptjs` (v3.0.3) — Password hashing and salt generation.
* `jsonwebtoken` (v9.0.3) — Stateless JWT authentication and verification.
* `multer` (v2.1.1) — Multipart form handling for file uploads.
* `nodemailer` (v8.0.7) — SMTP email delivery for verification, password resets, and notifications.
* `helmet` (v8.1.0) & `hpp` (v0.2.3) — HTTP security headers and Parameter Pollution protection.
* `express-rate-limit` (v8.3.2) — Rate limiting and DDoS protection.
* `cors` (v2.8.6) & `cookie-parser` (v1.4.7) — Cross-Origin Resource Sharing and cookie management.
* `concurrently` (v9.2.1) & `tsx` (v4.21.0) — Multi-process runner and TypeScript execution.

### Python AI / ML Ecosystem
* `scikit-learn` (v1.5.2) — ML classification pipelines, TF-IDF vectorization, Logistic Regression, KMeans.
* `numpy` (v2.1.3) — Vector arithmetic and matrix operations.
* `joblib` (v1.4.2) — Model serialization and `.pkl` persistence.
* `rank-bm25` (v0.2.2) — BM25 probabilistic relevance ranking.
* `sentence-transformers` (>=2.7.0) — Deep learning dense vector embeddings.
* `pymupdf` (v1.25.5) — PDF text and layout extraction from handbooks.
* `Pillow` (>=10.4.0) — Image processing for vision inference.
* `httpx` (v0.27.2) — Async HTTP client for external API communications.
* `pydantic` (v2.10.3) — Strict type validation and JSON serialization.

---

## 5. Security & Architecture Principles

* **Least-Privilege RBAC:** Strict Role-Based Access Control enforcing student, faculty, admin, superadmin, and guest boundaries.
* **Prepared SQL Statements:** Parameterized queries across all database access layers to prevent SQL injection.
* **Stateless Token Authentication:** Dual-layer authentication via HTTP-only Cookies and Bearer Authorization headers.
* **Microservice Isolation:** Decoupled AI processing enabling independent scaling and CPU/GPU offloading without impacting core web services.
