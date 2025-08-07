import os
import random

import requests
import pandas as pd
from tqdm import tqdm
import time
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Semaphore

# Define your Semantic Scholar API key
SEMANTIC_SCHOLAR_API_KEY = "XQRDiSXgS59uq91YOLadF2You3c4XFvv3MmXKU4o"
SEMANTIC_SCHOLAR_API_URL = "https://api.semanticscholar.org/graph/v1"

# Define the fields to be retrieved
fields = "url,title,year,authors,citationCount,abstract"
citations_fields = "paperId,title,contexts,year,citationCount,abstract"
#citations_fields = "paperId,title,contexts,year,isInfluential,influentialCitationCount"

NUM_THREADS = 5
WAIT_PER_THREAD = 1
WAIT_FOR_FAILED_REQUEST = 2

semaphore = Semaphore(NUM_THREADS)

def append_to_json(new_ids, filepath):
    """Append new IDs to existing JSON file"""
    existing_ids = []
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            existing_ids = json.load(f)
    
    # Convert to sets to remove duplicates
    all_ids = list(set(existing_ids + new_ids))
    with open(filepath, 'w') as f:
        json.dump(all_ids, f)

def append_to_csv(df, filepath):
    """Append dataframe to existing CSV without writing headers"""
    if os.path.exists(filepath):
        df.to_csv(filepath, mode='a', header=False, index=False)
    else:
        df.to_csv(filepath, index=False)

def save_references_to_jsonl(citations, filename="data/references.jsonl", complete_data_dump_file_name="data/references_complete.jsonl"):
    with open(filename, 'a') as f:
        for citation in citations:
            if len(citation) != 0:
                f.write(json.dumps(citation) + '\n')
    
    with open(complete_data_dump_file_name, 'a') as f:
        for citation in citations:
            if len(citation) != 0:
                f.write(json.dumps(citation) + '\n')


def load_processed_paper_ids(filename="data/references_complete.jsonl"):
    if not os.path.exists(filename):
        return set()

    processed_paper_ids = set()
    with open(filename, 'r') as f:
        for line in f:
            citation = json.loads(line)
            processed_paper_id = citation['citingPaperId']
            if processed_paper_id not in processed_paper_ids:
                processed_paper_ids.add(processed_paper_id)

    return processed_paper_ids


def load_existing_citations(filename):
    # existing_citations = []
    existing_citations = set()
    if os.path.exists(filename):
        with open(filename, 'r') as f:
            for line in f:
                citation = json.loads(line)
                cited_paper_id = citation['citedPaperId']
                existing_citations.add(cited_paper_id)
                # if cited_paper_id not in existing_citations:
                #     existing_citations[cited_paper_id] = []
                # existing_citations[cited_paper_id].append(citation)
    return existing_citations


def keep_track_of_papers_with_more_than_10k_citations(paper_id):
    if os.path.exists("data/papers_with_more_than_10k_citations.json"):
        with open("data/papers_with_more_than_10k_citations.json", "r") as f:
            papers_with_more_than_10k_citations = json.load(f)
    else:
        papers_with_more_than_10k_citations = []    
    papers_with_more_than_10k_citations.append(paper_id)
    with open("data/papers_with_more_than_10k_citations.json", "w") as f:
        json.dump(papers_with_more_than_10k_citations, f)

# Function to fetch citations for a given paper

def fetch_references(paper_id, fields, max_retries=8):
    citations = []
    offset = 0
    limit = 1000
    while True:
        url = f"{SEMANTIC_SCHOLAR_API_URL}/paper/{paper_id}/references?offset={offset}&limit={limit}&fields={fields}"

        success = False
        backoff_base = 2

        for attempt in range(max_retries):
            try:
                response = requests.get(url, 
                                        # headers={'x-api-key': SEMANTIC_SCHOLAR_API_KEY}
                                        ).json()

                if 'message' in response or 'error' in response:
                    raise Exception

                citations.extend(response['data'])
                next_offset = response.get('next', None)
                success = True
                break
            except Exception as e:
                print(f"Error fetching citations for paper {paper_id} (attempt {attempt + 1}): {e}")
                # print(response)
                # time.sleep(WAIT_FOR_FAILED_REQUEST + random.random())
                wait_time = backoff_base ** attempt
                time.sleep(wait_time)

        # time.sleep(1)

        if success:
            if not next_offset:
                break
            offset = next_offset
            if offset == 9000:
                # Max allowed citations from semantic scholar is 9999, so have to adjust limit for the final request
                limit = 999
        else:
            if (offset == 9000 and limit == 999) or len(citations) == 9999:
                print(f'Paper id for more than 10k citations {paper_id}')
                keep_track_of_papers_with_more_than_10k_citations(paper_id)
                return citations
            print(f"Failed to fetch citations for paper {paper_id} after {max_retries} attempts. total queries till now"
                  f" {len(citations)/1000}")
            return -1

    return citations


def fetch_citations_multi_threaded(paper_id, fields, max_retries=5):
    citations = []
    offset = 0
    limit = 1000
    while True:
        url = f"{SEMANTIC_SCHOLAR_API_URL}/paper/{paper_id}/citations?offset={offset}&limit={limit}&fields={fields}"

        success = False
        for attempt in range(max_retries):
            semaphore.acquire()  # Acquire semaphore before making the request
            try:
                response = requests.get(url,
                                        #  headers={'x-api-key': SEMANTIC_SCHOLAR_API_KEY}
                                         ).json()

                if 'message' in response or 'error' in response:
                    raise Exception

                citations.extend(response['data'])
                next_offset = response.get('next', None)
                success = True
                break
            except Exception as e:
                # print(f"Error fetching citations for paper {paper_id} (attempt {attempt + 1}): {e}")
                # print(response)
                time.sleep(WAIT_FOR_FAILED_REQUEST + random.random())
            finally:
                semaphore.release()

        time.sleep(WAIT_PER_THREAD + random.random())

        if success:
            if not next_offset:
                break
            offset = next_offset
            if offset == 9000:
                # Max allowed citations from semantic scholar is 9999, so have to adjust limit for the final request
                limit = 999
        else:
            if (offset == 9000 and limit == 999) or len(citations) == 9999:
                print(f'Paper id for more than 10k citations {paper_id}')
                keep_track_of_papers_with_more_than_10k_citations(paper_id)
                return citations
            print(f"Failed to fetch citations for paper {paper_id} after {max_retries} attempts. total queries till now"
                  f" {len(citations)/1000}")
            return -1

    return citations


def main():

    arxiv_paper_details = pd.read_csv("data/arxiv_papers_with_semantic_scholar_ids.csv")

    # Since we will be working with references instead of citations, we will not filter out papers with no citations
    # arxiv_papers_with_citations = arxiv_paper_details[arxiv_paper_details['citationCount'] > 0]
    semantic_paper_ids = arxiv_paper_details['paperId'].tolist()
    print(f'Total papers in data {len(semantic_paper_ids)}')

    # random.shuffle(semantic_paper_ids)

    # Load already processed paper IDs with citations
    processed_paper_ids= load_processed_paper_ids()
    print(f'Papers processed till now {len(processed_paper_ids)}')
    
    failed_paper_ids = []
    citations_data = []

    # load paper ids of papers with no citations
    papers_with_no_references = []
    if os.path.exists('data/semantic_ids_with_no_references.json'):
        with open("data/semantic_ids_with_no_references.json", "r") as f:
            papers_with_no_references = json.load(f)

    print(f'Papers with no reference {len(papers_with_no_references)}')


    processed_paper_ids = list(processed_paper_ids)
    processed_paper_ids.extend(papers_with_no_references)


    all_papers = [paper_id for paper_id in semantic_paper_ids if paper_id not in processed_paper_ids]
    for paper in tqdm(all_papers, desc="Fetching references"):
        try:
            paper_id = paper
            citations = fetch_references(paper_id, citations_fields)
            for citation in citations:
                citation['citingPaperId'] = paper_id  # Add the cited paper ID for context
                citations_data.append(citation)
            save_references_to_jsonl(citations)
            if len(citations) == 0:
                papers_with_no_references.append(paper)
                # shortcut, remove this later
                with open("data/semantic_ids_with_no_references.json", "w") as f:
                    json.dump(papers_with_no_references, f)
                print(f'No citations for {paper}')
        except Exception as e:
                print(f"Error processing paper {paper}: {e}")
                failed_paper_ids.append(paper)

    # # Save all citations to a CSV file
    # citations_df = pd.DataFrame(citations_data)
    # citations_df.to_csv("all_citations.csv", index=False)

    # Fetch citations for each paper using multithreading
    # with ThreadPoolExecutor(max_workers=NUM_THREADS) as executor:
    #     future_to_paper = {executor.submit(fetch_citations, paper, citations_fields): paper for paper in
    #                        semantic_paper_ids if paper not in processed_paper_ids}
    #     for future in tqdm(as_completed(future_to_paper), total=len(future_to_paper), desc="Fetching citations"):
    #         paper = future_to_paper[future]
    #         try:
    #             citations = future.result()
    #             for citation in citations:
    #                 citation['citedPaperId'] = paper  # Add the cited paper ID for context
    #                 citations_data.append(citation)
    #             save_citations_to_jsonl(citations)
    #             if len(citations) == 0:
    #                 papers_with_no_citations.append(paper)
    #                 # shortcut, remove this later
    #                 with open("data/semantic_ids_with_no_citations.json", "w") as f:
    #                     json.dump(papers_with_no_citations, f)
    #                 print(f'No citations for {paper}')
    #         except Exception as e:
    #             print(f"Error processing paper {paper}: {e}")
    #             failed_paper_ids.append(paper)

    # Save all citations to a CSV file
    if len(citations_data) > 0:
        citations_df = pd.DataFrame(citations_data)
        append_to_csv(citations_df, "data/semantic_references.csv")

    append_to_json(failed_paper_ids, "data/semantic_ids_with_failed_references.json")
    append_to_json(papers_with_no_references, "data/semantic_ids_with_no_references.json")

    print(f'Processed {len(semantic_paper_ids)} papers:')
    print(f'- Failed citations: {len(failed_paper_ids)}')
    print(f'- No references: {len(papers_with_no_references)}')
    print(f'- Successfully processed: {len(citations_data)}')


if __name__ == "__main__":
    main()
