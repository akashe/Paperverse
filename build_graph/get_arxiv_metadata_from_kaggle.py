import json
import pandas as pd
from datetime import datetime, timedelta
import argparse
import os
import pdb

# Relevant categories for machine learning-related papers
RELEVANT_CATEGORIES = {"cs.CV", "cs.AI", "cs.LG", "cs.CL", "cs.NE", "stat.ML", "cs.IR"}


def load_json(filepath):
    data = []
    with open(filepath, 'r') as file:
        for line in file:
            try:
                data.append(json.loads(line))
            except json.JSONDecodeError:
                print("Error decoding JSON line, skipping.")
    return data


def filter_data(data, relevant_categories, years):
    cutoff_date = datetime.now() - timedelta(days=years * 365)
    filtered_data = []

    for entry in data:
        # Convert the update_date to a datetime object
        entry_date = datetime.strptime(entry['update_date'], "%Y-%m-%d")
        if entry_date >= cutoff_date:
            # Check if any of the categories are relevant
            if any(category in relevant_categories for category in entry['categories'].split()):
                filtered_data.append({
                    "id": entry["id"],
                    "title": entry["title"].replace("\n", "").replace("\r", "").replace('"', ''),
                    "published_date": entry["update_date"],  # use update_date as published_date
                    "abstract": entry["abstract"].replace("\n", "").replace("\r", "")
                })

    return filtered_data


def save_data(filtered_data, save_path):
    df = pd.DataFrame(filtered_data)
    df.to_pickle(save_path)
    print(f"Filtered data saved to {save_path}")


def load_existing_ids(filepath):
    """Load existing paper IDs from a pickle file."""
    if os.path.exists(filepath):
        df = pd.read_pickle(filepath)
        return set(df['id'])
    return set()

def process_and_filter_new_data(filepath, existing_ids, relevant_categories, years):
    """Load and filter JSON data simultaneously, processing only new entries."""
    cutoff_date = datetime.now() - timedelta(days=years * 365)
    filtered_data = []
    skipped_count = 0
    processed_count = 0

    with open(filepath, 'r') as file:
        for line in file:
            try:
                entry = json.loads(line)
                processed_count += 1
                if processed_count % 100000 == 0:
                    print(f'Processed {processed_count} entries, found {len(filtered_data)} new relevant papers')

                # Skip if paper ID already exists
                if entry['id'] in existing_ids:
                    skipped_count += 1
                    if skipped_count % 10000 == 0:
                        print(f'Skipped {skipped_count} existing entries')
                    continue

                # Convert the update_date to a datetime object
                entry_date = datetime.strptime(entry['update_date'], "%Y-%m-%d")
                if entry_date >= cutoff_date:
                    # Check if any of the categories are relevant
                    if any(category in relevant_categories for category in entry['categories'].split()):
                        filtered_data.append({
                            "id": entry["id"],
                            "title": entry["title"].replace("\n", "").replace("\r", "").replace('"', ''),
                            "published_date": entry["update_date"],
                            "abstract": entry["abstract"].replace("\n", "").replace("\r", "")
                        })
                        
                        if len(filtered_data) % 500 == 0:
                            print(f'Found {len(filtered_data)} new relevant papers')

            except json.JSONDecodeError:
                print("Error decoding JSON line, skipping.")
                continue

    return filtered_data

def analyze_dates(filepath, relevant_categories, months=7):
    """Analyze paper dates from the last N months."""
    cutoff_date = datetime.now() - timedelta(days=months * 30)
    date_counts = {}
    total_count = 0
    
    print(f"Analyzing papers since {cutoff_date.strftime('%Y-%m-%d')}")
    
    with open(filepath, 'r') as file:
        for line in file:
            try:
                entry = json.loads(line)
                update_date = datetime.strptime(entry['update_date'], "%Y-%m-%d")
                
                if update_date >= cutoff_date:
                    if any(category in relevant_categories for category in entry['categories'].split()):
                        month_key = update_date.strftime("%Y-%m")
                        date_counts[month_key] = date_counts.get(month_key, 0) + 1
                        total_count += 1
                
                if total_count % 100000 == 0:
                    print(f"Processed {total_count} relevant papers...")
                    
            except json.JSONDecodeError:
                continue
    
    # Print results sorted by date
    print("\nPapers per month:")
    for date in sorted(date_counts.keys()):
        print(f"{date}: {date_counts[date]} papers")
    print(f"\nTotal papers in last {months} months: {total_count}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-f", "--file", type=str, required=True, help="Path to the Arxiv JSON metadata file")
    parser.add_argument("-s", "--save_file_name", type=str, help="File name to save the filtered results",
                        default="arxiv_data.pkl")
    parser.add_argument("-y", "--years", type=int, help="Number of past years to include", default=10)
    parser.add_argument("-n", "--new_file", type=str, help="Path to new Arxiv JSON metadata file", default=None)
    parser.add_argument("--analyze", action="store_true", help="Analyze dates only")
    args = parser.parse_args()

    file_path = args.file
    save_file_name = args.save_file_name
    years = args.years

    if args.analyze:
        analyze_dates(args.file, RELEVANT_CATEGORIES, months=years * 12)
        exit()

    if args.new_file is None:
        data = load_json(args.file)
        filtered_data = filter_data(data, RELEVANT_CATEGORIES, args.years)
        save_data(filtered_data, os.path.join("data", args.save_file_name))
    else:
        # Load existing IDs from the original filtered data
        existing_ids = load_existing_ids(os.path.join("data", args.save_file_name))
        print(f'Length of existing ids: {len(existing_ids)}')

        # Process new file line by line and filter simultaneously
        new_filtered_data = process_and_filter_new_data(
            args.new_file, 
            existing_ids, 
            RELEVANT_CATEGORIES, 
            args.years
        )
        
        # Save new entries to a separate file
        save_data(new_filtered_data, os.path.join("data", args.new_file))
        print(f"Found {len(new_filtered_data)} new papers")
