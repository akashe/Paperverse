import os
import random
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(root_path="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://paperverse.co", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.mount("/templates", StaticFiles(directory="templates"), name="templates")

driver = GraphDatabase.driver(
    os.getenv("NEO4J_URI"),
    auth=(os.getenv("NEO4J_USER"), os.getenv("NEO4J_PASSWORD")),
    connection_timeout=300,
)


def run_query(query, params=None):
    with driver.session() as session:
        return [record.data() for record in session.run(query, params or {})]


# Paper ids are Semantic Scholar paper ids (opaque hash strings), not the
# sequential ints the old SQLite-backed Nodes table used.
class PaperSearchRequest(BaseModel):
    query: str


class TreeRequest(BaseModel):
    paper_id: str
    depth: int


class PaperRequest(BaseModel):
    paper_id: str


class ChildrenRequest(BaseModel):
    paper_id: str
    root_id: str
    depth: int
    num_papers: int
    selection_criteria: str


class PathRequest(BaseModel):
    start_id: str
    end_id: str


@app.get("/")
async def read_root():
    return FileResponse('templates/index.html')


@app.get("/path")
async def get_path_finder():
    return FileResponse('templates/path_finder.html')


@app.post("/search_papers/")
async def search_papers(request: PaperSearchRequest):
    results = run_query(
        """
        CALL db.index.fulltext.queryNodes('paperAbstractIndex', $query) YIELD node, score
        RETURN node.id AS id, node.label AS label
        ORDER BY node.pageRank DESC
        LIMIT 10
        """,
        {"query": request.query},
    )
    return [{"id": r["id"], "label": (r["label"] or "").replace(r"\n", "")} for r in results]


@app.post("/generate_tree/")
async def generate_tree(request: TreeRequest, background_tasks: BackgroundTasks):
    return {"message": "Tree generation started"}


@app.post("/get_root_info/")
async def get_root_info(request: TreeRequest):
    results = run_query(
        """
        MATCH (p:Paper {id: $paper_id})
        RETURN p.id AS id, p.label AS label, p.year AS year,
               p.citationCount AS citationCount, p.url AS url, p.pageRank AS pageRank
        """,
        {"paper_id": request.paper_id},
    )
    if not results:
        raise HTTPException(status_code=404, detail="Paper not found")
    paper_info = results[0]
    return {
        'id': paper_info["id"],
        'label': (paper_info["label"] or "").replace(r"\n", ""),
        'year': paper_info["year"],
        'citationCount': paper_info["citationCount"],
        'url': paper_info["url"],
        'pageRank': paper_info["pageRank"],
    }


@app.post("/get_paper_info/")
async def get_paper_info(request: PaperRequest):
    results = run_query(
        """
        MATCH (p:Paper {id: $paper_id})
        RETURN p.id AS id, p.label AS label, p.year AS year, p.citationCount AS citationCount,
               p.url AS url, p.abstract AS abstract, p.arxiv_id AS arxiv_id,
               p.published_date AS published_date, p.tldr AS tldr
        """,
        {"paper_id": request.paper_id},
    )
    if not results:
        raise HTTPException(status_code=404, detail="Paper not found in Nodes table")
    p = results[0]
    # arxiv_id/published_date/tldr only exist for papers that were in the
    # original arXiv-sourced set (enriched from arxiv_papers_with_semantic_scholar_ids.csv) -
    # papers pulled in only via citation expansion won't have them.
    if p["arxiv_id"] is None:
        return {
            "arxiv_id": "No information available",
            "citationCount": p["citationCount"],
            "year": p["year"],
            "semantic_id": p["id"],
            "url": p["url"],
            "title": (p["label"] or "").replace(r"\n", ""),
            "published_date": "N/A",
            "tldr": "No information available",
        }
    return {
        "arxiv_id": p["arxiv_id"],
        "citationCount": p["citationCount"],
        "year": p["year"],
        "semantic_id": p["id"],
        "url": p["url"],
        "title": (p["label"] or "").replace(r"\n", ""),
        "published_date": p["published_date"] or "N/A",
        "tldr": p["tldr"] or "No information available",
    }


@app.post("/get_children/")
async def get_children(request: ChildrenRequest):
    # Influential derivatives: papers that cite this one, i.e. incoming CITES edges.
    results = run_query(
        """
        MATCH (p:Paper)-[:CITES]->(:Paper {id: $paper_id})
        RETURN p.id AS id, p.label AS label, p.citationCount AS citationCount,
               p.url AS url, p.pageRank AS pageRank
        """,
        {"paper_id": request.paper_id},
    )

    children_info = [
        {
            'id': r["id"],
            'label': (r["label"] or "").replace(r"\n", ""),
            'citationCount': r["citationCount"],
            'url': r["url"],
            'pageRank': r["pageRank"],
        }
        for r in results
    ]

    if request.selection_criteria == 'citationCount':
        children_info.sort(key=lambda x: x['citationCount'], reverse=True)
    elif request.selection_criteria == 'pageRank':
        children_info.sort(key=lambda x: x['pageRank'], reverse=True)
    elif request.selection_criteria == 'random':
        random.shuffle(children_info)

    if request.num_papers > 0:
        children_info = children_info[:request.num_papers]

    return children_info


@app.post("/find_paths/")
async def find_path(request: PathRequest):
    results = run_query(
        """
        MATCH (start:Paper {id: $start_id}), (end:Paper {id: $end_id})
        MATCH path = shortestPath((start)-[:CITES*..15]-(end))
        RETURN [n IN nodes(path) | {
            id: n.id, label: n.label, year: n.year,
            citationCount: n.citationCount, pageRank: n.pageRank
        }] AS path
        """,
        {"start_id": request.start_id, "end_id": request.end_id},
    )

    if not results or not results[0]["path"]:
        raise HTTPException(status_code=404, detail="No path found")

    path_details = [
        {
            'id': n["id"],
            'label': n["label"],
            'year': n["year"],
            'citationCount': n["citationCount"],
            'pageRank': n["pageRank"],
        }
        for n in results[0]["path"]
    ]
    return {'path': path_details}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
