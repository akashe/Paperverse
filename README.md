# 🎯 Paperverse.co
![Deploy status](https://github.com/akashe/ML-Papers-Citation-Analysis/actions/workflows/deploy.yml/badge.svg)


> Discover the evolution of AI/ML research through interactive citation networks

👉 **Try it now at [https://paperverse.co](https://paperverse.co)**

This tool helps you visualize and explore the interconnected world of Machine Learning research papers from the past decade, allowing you to:

🔍 **Discover** the most influential ideas in machine learning  
🏗️ **Trace** the stepping stones of current state-of-the-art research  
📈 **Identify** emerging trends in scholarly circles

## ✨ Features

### 1. Interactive Citation Graphs
Explore papers in a BFS (Breadth-First Search) manner to see how ideas evolve over time. Here's the citation graph starting from the landmark "Attention is all you need" paper:

<p align="center">
<img src="build_graph/pngs/graph.png" alt="Graph">  
</p>

### 2. Paper Insights at a Glance
Hover over any paper to get quick insights without diving deep:

<p align="center">
<img src="build_graph/pngs/paper_card.png" alt="Paper card" width="300" height="300"/>  
</p>

### 3. Personalized Reading Lists
Build your research roadmap by saving interesting papers for later:

<p align="center">
<img src="build_graph/pngs/reading_list.png" alt="Reading list" width="800" height="400"/>  
</p>

### 4. Deep Exploration
Click on any paper to discover its most influential derivatives. Perfect for:
- Tracking idea evolution
- Finding research gaps
- Understanding paper lineage

<p align="center">
<img src="build_graph/pngs/multi_level.png" alt="Multi level" width="900" height="500"/>  
</p>

## How it works

```
                    ┌────────────────────────────┐
                    │   Neo4j (Community + GDS)  │
                    │  shared with ResearchQuest  │
                    └──────────────┬──────────────┘
                                   │ Cypher, bolt+s
                    ┌──────────────┴──────────────┐
                    │  citation-network-backend    │
                    │  (FastAPI)                   │
                    └──────────────┬──────────────┘
                                   │ /api/*
                    ┌──────────────┴──────────────┐
                    │  citation-network-ui         │
                    │  (React, served by nginx)    │
                    │  Firebase — auth + reading    │
                    │  list only, not the graph      │
                    └─────────────────────────────┘
```

Paperverse and [ResearchQuest](https://github.com/akashe/ResearchQuest) both
explore the same underlying citation graph and now share one Neo4j instance
instead of each maintaining a separate copy of the data. The backend here
runs Cypher queries directly against it — no local database file, nothing
to download or keep in sync by hand.

Paper ids throughout are Semantic Scholar's own paper ids (opaque hash
strings), not sequential integers — this is a Neo4j-native identifier, a
change from this project's original SQLite-backed version.

## Repo layout

- `citation-network-backend/` — FastAPI backend, Cypher queries over Neo4j
- `citation-network-ui/` — React frontend (search, graph explorer, path
  finder, reading list); Firebase handles auth and the reading list only —
  none of the citation-graph data goes through Firebase
- `build_graph/` — the original arXiv → Semantic Scholar → graph-export
  pipeline this project was built around (see **Known constraints** below
  for where this is headed)
- `docker-compose.yml` / `docker-compose.prod.yml` / `docker/` — local dev
  and shared-VM deployment (see **Deployment**)

## Local setup

### Backend (FastAPI)

```bash
cd citation-network-backend
pip install -r requirements.txt
cp ../.env.example ../.env   # fill in NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

Point `NEO4J_URI` at any Neo4j instance that already has the `:Paper`
graph loaded — see ResearchQuest's `docker-compose.yml` for a self-hosted
Neo4j + GDS setup, or run your own via `build_graph/`.

### Frontend (React)

```bash
cd citation-network-ui
npm install
cp .env.example .env   # Firebase config — see below
npm start
```

Firebase (`REACT_APP_FIREBASE_*` in `.env`) is only used for login and the
reading-list feature. The app degrades gracefully without it — search,
graph exploration, and path finding all work with no Firebase config at
all (see `citation-network-ui/src/firebase.js`).

## Deployment

Runs alongside ResearchQuest on the same Hetzner VM, as a separate
`docker compose` project (`docker-compose.prod.yml`) — not its own server.
Two containers, `frontend` and `backend`, with no host ports published at
all: ResearchQuest's own nginx (already TLS-terminating Neo4j's bolt
connection for its Streamlit app) reaches Paperverse's `frontend` container
directly over a shared Docker network, and adds a second HTTPS server block
for `paperverse.co` alongside its existing one.

The domain itself is registered via AWS but its authoritative nameservers
are Cloudflare's — DNS changes happen in the Cloudflare dashboard, not
Route53 (a leftover, non-authoritative hosted zone exists there from an
earlier AWS-only deployment and can be ignored). TLS certificates are
issued by Let's Encrypt via `certbot --webroot`, auto-renewing through the
same mechanism ResearchQuest's own nip.io endpoint uses.

The VM's own address isn't published here — Neo4j's bolt endpoint has to
stay reachable from Streamlit Cloud's servers (which have no fixed egress
IPs to allowlist), so that port has to stay open to the internet, and
there's no reason to make it an easy target for scanners that scrape public
repos. Auth + TLS are the real protection either way.

## Known constraints

- Citation data originates from Semantic Scholar's API, which restricts
  bulk redistribution of derived data. A meaningful fraction of papers in
  the graph — specifically ones that entered it only through citation
  expansion, rather than being one of the originally-fetched arXiv papers —
  don't have a title/abstract/publish-date match in Semantic Scholar's
  arXiv metadata, so fields like TL;DR and published date show as
  unavailable for them. A migration to [OpenAlex](https://openalex.org)
  (CC0-licensed, indexes arXiv ids natively, ships as a bulk downloadable
  snapshot rather than a rate-limited API) is the leading candidate to
  close this gap and also enable publishing a derived dataset publicly —
  not yet done.
- Very recent papers naturally have few incoming citation edges yet — a
  property of citation graphs generally, not a data quality bug.

## 🛠️ Graph Building Pipeline

The `build_graph` directory contains tools to create citation networks through these steps:

1. **Data Collection**: Fetch ML papers from Arxiv (last 10 years)
2. **Citation Analysis**: Gather citation data from Semantic Scholar
3. **Graph Generation**: Create DOT files with papers as nodes and citations as edges
4. **Ranking**: Apply PageRank to identify influential papers
5. **Database Integration**: Process and export graph data for Neo4j
