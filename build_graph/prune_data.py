import os
import json
import pandas as pd

def load_processed_paper_ids(filename="data/references_complete.jsonl"):
    if not os.path.exists(filename):
        return set()

    cited_paper_ids = {}
    with open(filename, 'r') as f:
        for line in f:
            citation = json.loads(line)
            if 'citingPaperId' in citation:
                processed_paper_id = citation['citedPaper']['paperId']
                citationCount = citation['citedPaper']['citationCount']
                year = citation['citedPaper']['year']
            
            cited_paper_ids[processed_paper_id] = (citationCount, year)

    return cited_paper_ids


# Load dictionary from JSONL
cited_paper_ids = load_processed_paper_ids()

print('Loaded cited paper IDs from jsonl file:', len(cited_paper_ids))

citationCountMismatch = 0 
# Read CSV and update dictionary with missing entries
arxiv_paper_details = pd.read_csv("data/arxiv_papers_with_semantic_scholar_ids.csv")
for _, row in arxiv_paper_details.iterrows():
    paper_id = row['paperId']
    citation_count = row['citationCount']
    year = row['year']
    if paper_id not in cited_paper_ids:
        cited_paper_ids[paper_id] = (citation_count, year)
    else:
        if cited_paper_ids[paper_id][0] != citation_count:
            citationCountMismatch += 1

print(f"Number of citation count mismatches: {citationCountMismatch}")

total_unique_papers = len(cited_paper_ids)
print(f"Total unique papers with citations: {total_unique_papers}")

# Create DataFrame from updated dictionary
df = pd.DataFrame(
    [(pid, vals[0], vals[1]) for pid, vals in cited_paper_ids.items()],
    columns=['paperId', 'citationCount', 'year']
)

import datetime

current_year = datetime.datetime.now().year

def keep_paper(row):
    age = current_year - row['year']
    if age == 0:
        return row['citationCount'] >= 0
    elif age == 1:
        return row['citationCount'] > 5
    elif age == 2:
        return row['citationCount'] > 25
    elif age == 3:
        return row['citationCount'] > 100
    elif age == 4:
        return row['citationCount'] > 250
    else:
        return row['citationCount'] > 500 

df = df[df.apply(keep_paper, axis=1)]

print('Pruned df size :', len(df))

stats = {
    "<5": len(df[df['citationCount'] < 5]),
    "5-9": len(df[(df['citationCount'] >= 5) & (df['citationCount'] < 10)]),
    "10-49": len(df[(df['citationCount'] >= 10) & (df['citationCount'] < 50)]),
    "50-99": len(df[(df['citationCount'] >= 50) & (df['citationCount'] < 100)]),
    "100-499": len(df[(df['citationCount'] >= 100) & (df['citationCount'] < 500)]),
    "500-999": len(df[(df['citationCount'] >= 500) & (df['citationCount'] < 1000)]),
    "1000-4999": len(df[(df['citationCount'] >= 1000) & (df['citationCount'] < 5000)]),
    "5000-9999": len(df[(df['citationCount'] >= 5000) & (df['citationCount'] < 10000)]),
    ">=10000": len(df[df['citationCount'] >= 10000])
}

print("Citation count statistics:")
for k, v in stats.items():
    print(f"{k}: {v}")

print("Year-wise distribution:")
year_stats = df['year'].value_counts().sort_index()
for year, count in year_stats.items():
    print(f"{year}: {count}")

prune_year = 2018
print(f'Removing papers before the year {prune_year}')

df = df[df['year'] >= prune_year]
print(f'After pruning, total papers: {len(df)}')



############
# Saving pruned data
############


# Get set of shortlisted paperIds
shortlisted_ids = set(df['paperId'].astype(str))

# Filter and save CSV
input_csv = "data/arxiv_papers_with_semantic_scholar_ids.csv"
output_csv = "data/arxiv_papers_with_semantic_scholar_ids_pruned.csv"
output_csv_for_c_code = "data/semantic_scholar_paper_details_pruned_for_c_code.csv"

arxiv_df = pd.read_csv(input_csv)
arxiv_df = arxiv_df[arxiv_df['paperId'].astype(str).isin(shortlisted_ids)]
arxiv_df.to_csv(output_csv, index=False)
print(f"Saved shortlisted CSV to {output_csv}")

df_for_c_code = arxiv_df[['paperId', 'url', 'title', 'year', 'citationCount', 'abstract']]
# df_for_c_code['title'] = df_for_c_code['title'].str.replace('\n', '')
df_for_c_code.to_csv(output_csv_for_c_code, index=False)


# Filter and save JSONL
input_jsonl = "data/references_complete.jsonl"
output_jsonl = "data/references_complete_pruned.jsonl"

input_line_count  =0
output_line_count = 0
with open(input_jsonl, 'r') as fin, open(output_jsonl, 'w') as fout:
    for line in fin:
        try:

            input_line_count += 1

            citation = json.loads(line)
            citing_id = citation.get('citingPaperId')
            cited_paper = citation.get('citedPaper', {})
            cited_id = cited_paper.get('paperId')
            if citing_id in shortlisted_ids and cited_id in shortlisted_ids:
                fout.write(line)
                output_line_count += 1
        except Exception as e:
            continue  # skip malformed lines

print(f"Filtered {input_line_count} lines to {output_line_count} lines in JSONL file.")
print(f"Saved shortlisted JSONL to {output_jsonl}")