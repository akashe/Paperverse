#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <unordered_map>
#include <boost/graph/adjacency_list.hpp>
#include <boost/graph/graphviz.hpp>
#include <rapidjson/document.h>
#include <rapidjson/istreamwrapper.h>
#include <thread>
#include <mutex>
#include <sstream>
#include <utility>
#include <stdexcept>
#include <sqlite3.h>
#include <Eigen/Sparse>
#include <cmath>

using namespace rapidjson;
using namespace boost;
using namespace std;

// Constants for PageRank
const double DAMPING_FACTOR = 0.99;
const int MAX_ITERATIONS = 100;
const double CONVERGENCE_THRESHOLD = 1e-9;
const double MIN_DANGLING_CONTRIBUTION = 1e-9;

// Define custom property tags for vertex properties
struct VertexProperties {
    string name;
    string url;
    int centrality;
    int year;
};

// Define the graph type
typedef adjacency_list<vecS, vecS, directedS, VertexProperties> Graph;
typedef graph_traits<Graph>::vertex_descriptor Vertex;

// Struct to store paper information
struct PaperInfo {
    string title;
    string url;
    int year;
    int citationCount;
};

// Global variables
mutex mtx;
std::unordered_map<string, Vertex> node_map;
std::unordered_map<string, PaperInfo> paper_info_map;
Graph g;
int csv_lines_processed = 0;
int csv_lines_skipped = 0;
int json_lines_processed = 0;
int json_lines_skipped = 0;

std::string ReplaceAll(std::string str, const std::string& from, const std::string& to) {
    size_t start_pos = 0;
    while((start_pos = str.find(from, start_pos)) != std::string::npos) {
        str.replace(start_pos, from.length(), to);
        start_pos += to.length();
    }
    return str;
}

vector<string> split_csv_line(const string& line) {
    vector<string> result;
    stringstream ss(line);
    string item;
    bool in_quotes = false;
    string temp;
    
    while (getline(ss, item, ',')) {
        if (in_quotes) {
            temp += ',' + item;
            if (!item.empty() && item.back() == '"') {
                result.push_back(temp.substr(1, temp.size() - 2));
                in_quotes = false;
            }
        } else {
            if (!item.empty() && item.front() == '"' && item.back() != '"') {
                temp = item;
                in_quotes = true;
            } else if (!item.empty() && item.front() == '"' && item.back() == '"') {
                result.push_back(item.substr(1, item.size() - 2));
            } else {
                result.push_back(item);
            }
        }
    }
    return result;
}

string escape_dot_string(const string& str) {
    string escaped = str;
    size_t pos = 0;
    while ((pos = escaped.find('"', pos)) != string::npos) {
        escaped.replace(pos, 1, "\\\"");
        pos += 2;
    }
    return escaped;
}

void load_paper_info(const string& csv_filename) {
    ifstream file(csv_filename);
    if (!file.is_open()) {
        cerr << "Error opening file: " << csv_filename << endl;
        return;
    }

    string line;
    getline(file, line); // Skip header

    while (getline(file, line)) {
        vector<string> fields = split_csv_line(line);
        if (fields.size() < 5) {  // Adjusted number of expected columns
            cerr << "Skipping malformed line: " << line << endl;
            csv_lines_skipped++;
            continue;
        }

        string paperId = fields[0];
        string url = fields[1];
        string title_old = escape_dot_string(fields[2]);
        // TODO: replacing "" in paper names with nothing because some paper are being missed this way
        string title = ReplaceAll(title_old, std::string("\"\""), std::string(" "));
        string year = fields[3];
        string citationCount = fields[4];

        try {
            int yearInt = stoi(year);
            int citationCountInt = stoi(citationCount);
            PaperInfo info = {title, url, yearInt, citationCountInt};
            paper_info_map[paperId] = info;

            // Add node to graph
            Vertex v = add_vertex(g);
            node_map[paperId] = v;
            g[v].name = title;
            g[v].url = url;
            g[v].centrality = citationCountInt;
            g[v].year = yearInt;
            csv_lines_processed++;
        } catch (const std::invalid_argument& e) {
            cerr << "Invalid argument: " << e.what() << " in line: " << line << endl;
            csv_lines_skipped++;
            continue;
        } catch (const std::out_of_range& e) {
            cerr << "Out of range: " << e.what() << " in line: " << line << endl;
            csv_lines_skipped++;
            continue;
        }
    }

    file.close();
}

void parse_jsonl_file(const string& filename) {
    ifstream ifs(filename);
    if (!ifs.is_open()) {
        cerr << "Error opening file: " << filename << endl;
        return;
    }

    IStreamWrapper isw(ifs);
    string line;
    while (getline(ifs, line)) {
        Document d;
        d.Parse(line.c_str());

        if (!d.IsObject()) {
            cerr << "Skipping malformed JSON line: " << line << endl;
            json_lines_skipped++;
            continue;
        }

        auto citedPaperIdItr = d.FindMember("citedPaperId");
        auto citingPaperItr = d.FindMember("citingPaper");
        
        if (citedPaperIdItr == d.MemberEnd() || !citedPaperIdItr->value.IsString() ||
            citingPaperItr == d.MemberEnd() || !citingPaperItr->value.IsObject()) {
            cerr << "Skipping malformed JSON line: " << line << endl;
            json_lines_skipped++;
            continue;
        }

        auto& citingPaper = citingPaperItr->value;
        auto citingPaperIdItr = citingPaper.FindMember("paperId");
        auto citingPaperTitleItr = citingPaper.FindMember("title");
        auto citingPaperYearItr = citingPaper.FindMember("year");

        // Replace null values with defaults
        string cited_paper_id = citedPaperIdItr->value.IsString() ? citedPaperIdItr->value.GetString() : "unknown";
        string citing_paper_id = citingPaperIdItr->value.IsString() ? citingPaperIdItr->value.GetString() : "unknown";
        string citing_paper_title = citingPaperTitleItr->value.IsString() ? escape_dot_string(citingPaperTitleItr->value.GetString()) : "unknown";
        int citing_paper_year = citingPaperYearItr->value.IsInt() ? citingPaperYearItr->value.GetInt() : 0;

        string url_start = "https://www.semanticscholar.org/paper/";

        lock_guard<mutex> lock(mtx);
        if (node_map.find(cited_paper_id) == node_map.end()) {
            // If the cited paper is not in the initial set, add it as an isolated node
            Vertex v = add_vertex(g);
            node_map[cited_paper_id] = v;
            g[v].name = cited_paper_id; // Just adding the paper id as a node name
            g[v].url = url_start + cited_paper_id;
            g[v].centrality = 0;
            g[v].year = 0;
        }
        if (node_map.find(citing_paper_id) == node_map.end()) {
            // If the citing paper is not in the initial set, add it as an isolated node
            Vertex v = add_vertex(g);
            node_map[citing_paper_id] = v;
            g[v].name = citing_paper_title;
            g[v].url = url_start + citing_paper_id;
            g[v].centrality = 0;
            g[v].year = citing_paper_year;
        }

//        add_edge(node_map[citing_paper_id], node_map[cited_paper_id], g);
        add_edge(node_map[cited_paper_id], node_map[citing_paper_id], g);

        if (json_lines_processed % 100000 == 0) {
            cout << "Json lines processed: " << json_lines_processed << endl;
        }

        json_lines_processed++;
    }

    ifs.close();
}

// Custom property writer for vertex properties
class VertexPropertyWriter {
public:
    VertexPropertyWriter(Graph& g) : g(g) {}

    template <class VertexOrEdge>
    void operator()(ostream& out, const VertexOrEdge& v) const {
        out << "[label=\"" << g[v].name << "\"";
        out << ", year=\"" << g[v].year << "\"";
        out << ", citationCount=\"" << g[v].centrality << "\"";
        out << ", url=\"" << g[v].url << "\"]";
    }

private:
    Graph& g;
};


void calculate_pagerank(const Graph& g, std::unordered_map<string, double>& pageRanks) {
    int numNodes = num_vertices(g);
    vector<Eigen::Triplet<double>> tripletList;
    std::unordered_map<Vertex, int> idMapping;
    
    // Create ID mapping
    int index = 0;
    graph_traits<Graph>::vertex_iterator vi, vi_end;
    for (tie(vi, vi_end) = vertices(g); vi != vi_end; ++vi) {
        idMapping[*vi] = index++;
    }

    // Build triplet list (equivalent to original implementation)
    graph_traits<Graph>::edge_iterator ei, ei_end;
    for (tie(ei, ei_end) = edges(g); ei != ei_end; ++ei) {
        Vertex source = boost::source(*ei, g);
        Vertex target = boost::target(*ei, g);
        tripletList.emplace_back(idMapping[source], idMapping[target], 1.0);
    }

    // Create sparse matrix
    Eigen::SparseMatrix<double> adjacencyMatrix(numNodes, numNodes);
    adjacencyMatrix.setFromTriplets(tripletList.begin(), tripletList.end());

    // Find max citations for normalization
    int maxCitations = 0;
    for (tie(vi, vi_end) = vertices(g); vi != vi_end; ++vi) {
        maxCitations = max(maxCitations, g[*vi].centrality);
    }

    // Initialize ranks with citation count bias (matching original)
    Eigen::VectorXd ranks(numNodes);
    for (tie(vi, vi_end) = vertices(g); vi != vi_end; ++vi) {
        int mappedId = idMapping[*vi];
        double normalizedCitation = log(g[*vi].centrality + 1) / log(maxCitations + 1);
        ranks[mappedId] = normalizedCitation;
    }
    ranks /= ranks.sum();

    // Identify dangling nodes (matching original)
    Eigen::VectorXd danglingNodes = Eigen::VectorXd::Zero(numNodes);
    for (tie(vi, vi_end) = vertices(g); vi != vi_end; ++vi) {
        int mappedId = idMapping[*vi];
        if (out_degree(*vi, g) == 0) {
            danglingNodes[mappedId] = 1.0;
        }
    }

    // PageRank iteration (matching original implementation)
    Eigen::VectorXd oldRanks(numNodes);
    for (int iteration = 0; iteration < MAX_ITERATIONS; ++iteration) {
        oldRanks = ranks;
        double danglingContribution = MIN_DANGLING_CONTRIBUTION * danglingNodes.sum();
        Eigen::VectorXd newRanks = DAMPING_FACTOR * (adjacencyMatrix * oldRanks + 
            danglingContribution * Eigen::VectorXd::Ones(numNodes)) + 
            (1 - DAMPING_FACTOR) / numNodes * Eigen::VectorXd::Ones(numNodes);

        newRanks /= newRanks.sum();
        double diff = (newRanks - oldRanks).norm();

        if (iteration % 1 == 0) {
            cout << "Iteration " << iteration << ": diff = " << diff << endl;
        }

        if (diff < CONVERGENCE_THRESHOLD) {
            ranks = newRanks;
            break;
        }
        ranks = newRanks;
    }

    // Store results (matching original)
    double maxRank = ranks.maxCoeff();
    double scaleFactor = 1.0 / maxRank;

    for (tie(vi, vi_end) = vertices(g); vi != vi_end; ++vi) {
        string originalId = to_string(*vi);
        int mappedId = idMapping[*vi];
        pageRanks[originalId] = ranks(mappedId) * scaleFactor;
    }

    double minRank = ranks.minCoeff() * scaleFactor;
    maxRank = ranks.maxCoeff() * scaleFactor;
    cout << "Min PageRank: " << minRank << ", Max PageRank: " << maxRank << endl;
}

void updateDotFile(const Graph& g, const std::unordered_map<string, double>& pageRanks, const string& outputPath) {
    ofstream outfile(outputPath);
    if (!outfile.is_open()) {
        cerr << "Failed to open output file: " << outputPath << endl;
        return;
    }

    // Write graph header
    outfile << "digraph CitationNetwork {" << endl;
    outfile << "  rankdir=LR;" << endl;

    // Write nodes with properties
    graph_traits<Graph>::vertex_iterator vi, vi_end;
    for (tie(vi, vi_end) = vertices(g); vi != vi_end; ++vi) {
        string id = to_string(*vi);
        outfile << "  " << id << " [label=\"" << g[*vi].name << "\"";
        outfile << ", year=\"" << g[*vi].year << "\"";
        outfile << ", citationCount=\"" << g[*vi].centrality << "\"";
        outfile << ", url=\"" << g[*vi].url << "\"";
        
        // Add PageRank value if available
        auto pageRankIt = pageRanks.find(id);
        if (pageRankIt != pageRanks.end()) {
            outfile << ", pageRank=\"" << pageRankIt->second << "\"";
        }
        outfile << "];" << endl;
    }

    // Write edges
    graph_traits<Graph>::edge_iterator ei, ei_end;
    for (tie(ei, ei_end) = edges(g); ei != ei_end; ++ei) {
        outfile << "  " << source(*ei, g) << " -> " << target(*ei, g) << ";" << endl;
    }

    outfile << "}" << endl;
    outfile.close();
}

void store_all_data(const Graph& g, const string& csv_filename, sqlite3* db, const std::unordered_map<string, double>& pageRanks) {
    // Create tables
    const char* create_tables_sql = R"(
        CREATE TABLE IF NOT EXISTS Nodes (
            id TEXT PRIMARY KEY,
            label TEXT,
            year INTEGER,
            citationCount INTEGER,
            url TEXT,
            pageRank REAL
        );
        
        CREATE TABLE IF NOT EXISTS Paper_info (
            arxiv_id TEXT,
            citationCount INTEGER,
            year INTEGER,
            semantic_id TEXT,
            url TEXT PRIMARY KEY,
            abstract TEXT,
            title TEXT,
            published_date TEXT,
            tldr TEXT
        );
        
        CREATE TABLE IF NOT EXISTS PaperEdges (
            source_id TEXT,
            target_id TEXT,
            UNIQUE(source_id, target_id)
        );
    )";
    
    char* err_msg = 0;
    if (sqlite3_exec(db, create_tables_sql, 0, 0, &err_msg) != SQLITE_OK) {
        cerr << "SQL error: " << err_msg << endl;
        sqlite3_free(err_msg);
        return;
    }

    cout << "Starting table creation " << endl;

    // Begin transaction
    sqlite3_exec(db, "BEGIN TRANSACTION;", 0, 0, 0);

    cout << "Starting inserting into Nodes " << endl;
    // Store nodes with PageRank
    sqlite3_stmt* node_stmt;
    const char* insert_node_sql = 
        "INSERT OR REPLACE INTO Nodes (id, label, year, citationCount, url, pageRank) "
        "VALUES (?, ?, ?, ?, ?, ?);";
    sqlite3_prepare_v2(db, insert_node_sql, -1, &node_stmt, 0);

    graph_traits<Graph>::vertex_iterator vi, vi_end;
    for (tie(vi, vi_end) = vertices(g); vi != vi_end; ++vi) {
        string id = to_string(*vi);
        sqlite3_bind_text(node_stmt, 1, id.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(node_stmt, 2, g[*vi].name.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_int(node_stmt, 3, g[*vi].year);
        sqlite3_bind_int(node_stmt, 4, g[*vi].centrality);
        sqlite3_bind_text(node_stmt, 5, g[*vi].url.c_str(), -1, SQLITE_STATIC);
        
        auto pageRankIt = pageRanks.find(id);
        double pageRankValue = pageRankIt != pageRanks.end() ? pageRankIt->second : 0.0;
        sqlite3_bind_double(node_stmt, 6, pageRankValue);
        
        sqlite3_step(node_stmt);
        sqlite3_reset(node_stmt);
    }
    sqlite3_finalize(node_stmt);
    
    cout << "Starting inserting into PaperEdges " << endl;
    // Store edges
    sqlite3_stmt* edge_stmt;
    const char* insert_edge_sql = 
        "INSERT OR IGNORE INTO PaperEdges (source_id, target_id) VALUES (?, ?);";
    sqlite3_prepare_v2(db, insert_edge_sql, -1, &edge_stmt, 0);

    graph_traits<Graph>::edge_iterator ei, ei_end;
    for (tie(ei, ei_end) = edges(g); ei != ei_end; ++ei) {
        string source_id = to_string(source(*ei, g));
        string target_id = to_string(target(*ei, g));
        
        sqlite3_bind_text(edge_stmt, 1, source_id.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_text(edge_stmt, 2, target_id.c_str(), -1, SQLITE_STATIC);
        
        sqlite3_step(edge_stmt);
        sqlite3_reset(edge_stmt);
    }
    sqlite3_finalize(edge_stmt);

    cout << "Starting inserting into Paper_info " << endl;
    // Store paper info from CSV
    ifstream csv_file(csv_filename);
    if (csv_file.is_open()) {
        string header;
        getline(csv_file, header);

        sqlite3_stmt* paper_stmt;
        const char* insert_paper_sql = 
            "INSERT OR IGNORE INTO Paper_info "
            "(arxiv_id, citationCount, year, semantic_id, url, abstract, title, published_date, tldr) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);";
        sqlite3_prepare_v2(db, insert_paper_sql, -1, &paper_stmt, 0);

        string line;
        int line_number = 1;
        int error_count = 0;
        const int MAX_ERRORS = 10;

        while (getline(csv_file, line)) {
            try {
                auto fields = split_csv_line(line);
                if (fields.size() >= 11) {  // Need at least 11 fields now (2 row numbers + 9 actual fields)
                    // Convert citation count and year using correct indices
                    int citationCount = 0;
                    int year = 0;
                    
                    try {
                        fields[3].erase(0, fields[3].find_first_not_of(" \n\r\t"));  // CitationCount is 4th field
                        fields[3].erase(fields[3].find_last_not_of(" \n\r\t") + 1);
                        fields[4].erase(0, fields[4].find_first_not_of(" \n\r\t"));  // Year is 5th field
                        fields[4].erase(fields[4].find_last_not_of(" \n\r\t") + 1);

                        citationCount = stoi(fields[3]);
                        year = stoi(fields[4]);
                        error_count = 0;
                    } catch (const std::exception& e) {
                        error_count++;
                        if (error_count <= MAX_ERRORS) {
                            cout << "Conversion error at line " << line_number << ": " << e.what() << endl;
                            cout << "Citation count: '" << fields[3] << "'" << endl;
                            cout << "Year: '" << fields[4] << "'" << endl;
                        }
                        if (error_count == MAX_ERRORS) {
                            cout << "Suppressing further conversion errors..." << endl;
                        }
                        continue;
                    }

                    // Ensure all text fields are properly stripped of quotes
                    for (int i = 2; i < fields.size(); i++) {  // Start from field 3 (arxiv_id)
                        if (i != 3 && i != 4) {  // Skip citation count and year fields
                            auto& field = fields[i];
                            if (!field.empty() && field.front() == '"') {
                                field = field.substr(1);
                            }
                            if (!field.empty() && field.back() == '"') {
                                field.pop_back();
                            }
                        }
                    }

                    // Bind all fields to the SQL statement with correct indices
                    sqlite3_bind_text(paper_stmt, 1, fields[2].c_str(), -1, SQLITE_STATIC);  // arxiv_id
                    sqlite3_bind_int(paper_stmt, 2, citationCount);
                    sqlite3_bind_int(paper_stmt, 3, year);
                    sqlite3_bind_text(paper_stmt, 4, fields[5].c_str(), -1, SQLITE_STATIC);  // semantic_id
                    sqlite3_bind_text(paper_stmt, 5, fields[6].c_str(), -1, SQLITE_STATIC);  // url
                    sqlite3_bind_text(paper_stmt, 6, fields[7].c_str(), -1, SQLITE_STATIC);  // title
                    sqlite3_bind_text(paper_stmt, 7, fields[8].c_str(), -1, SQLITE_STATIC);  // published_date
                    sqlite3_bind_text(paper_stmt, 8, fields[9].c_str(), -1, SQLITE_STATIC);  // abstract
                    sqlite3_bind_text(paper_stmt, 9, fields[10].c_str(), -1, SQLITE_STATIC); // tldr
                    
                    sqlite3_step(paper_stmt);
                    sqlite3_reset(paper_stmt);
                }
            } catch (const std::exception& e) {
                cout << "Error processing line " << line_number << ": " << e.what() << endl;
                cout << "Line content: " << line << endl;
            }
            line_number++;
        }
        sqlite3_finalize(paper_stmt);
        csv_file.close();
    }
    // Commit all changes
    sqlite3_exec(db, "COMMIT;", 0, 0, 0);
}

int main() {
    // g++ -std=c++11 -I$BOOST_INCLUDE_PATH -I$RAPIDJSON_INCLUDE_PATH -I /Users/akashkumar/Downloads/eigen-3.4.0 -L$BOOST_LIB_PATH -lboost_graph -lboost_system -lsqlite3 -o citation_network_new main.cpp
    auto start_time = chrono::high_resolution_clock::now();

    // Load paper information from cleaned CSV file
    string csv_filename = "data/semantic_scholar_paper_details_for_c_code.csv";
    load_paper_info(csv_filename);

    cout << "CSV lines processed: " << csv_lines_processed << ", CSV lines skipped: " << csv_lines_skipped << endl;

    // Parse the JSONL file to build the graph
    string jsonl_filename = "data/citations.jsonl";
    parse_jsonl_file(jsonl_filename);

    cout << "JSON lines processed: " << json_lines_processed << ", JSON lines skipped: " << json_lines_skipped << endl;

    // Save the graph to a file with custom property writer
    ofstream dotfile("../citation-network-backend/data/citation_network.dot");
    write_graphviz(dotfile, g, VertexPropertyWriter(g));

    cout << "Graph construction complete. Nodes: " << num_vertices(g) << ", Edges: " << num_edges(g) << endl;

    auto mid_time = chrono::high_resolution_clock::now();
    chrono::duration<double> graph_build_duration = mid_time - start_time;
    cout << "Total time for graph creation " << graph_build_duration.count() << " seconds" << endl;

    // Calculate PageRank
    std::unordered_map<string, double> pageRanks;
    cout << "Starting PageRank calculation..." << endl;
    calculate_pagerank(g, pageRanks);
    cout << "PageRank calculation complete" << endl;

    auto mid_time_1 = chrono::high_resolution_clock::now();
    chrono::duration<double> pagerank_duration = mid_time_1 - mid_time;
    cout << "Total time for pagerank calculation " << pagerank_duration.count() << " seconds" << endl;

    // Update dot file with PageRank values
    cout << "Updating dot file..." << endl;
    updateDotFile(g, pageRanks, "../citation-network-backend/data/citation_network_with_pagerank.dot");
    cout << "Dot file update complete" << endl;

    auto mid_time_2 = chrono::high_resolution_clock::now();
    chrono::duration<double> dot_file_duration = mid_time_2 - mid_time_1;
    cout << "Total time for saving new dot file " << dot_file_duration.count() << " seconds" << endl;

    // Store everything in database
    sqlite3* db;
    if (sqlite3_open("../citation-network-backend/data/citations_data.db", &db) == SQLITE_OK) {
        store_all_data(g, "data/arxiv_papers_with_semantic_scholar_ids.csv", db, pageRanks);
        sqlite3_close(db);
        cout << "Database population complete" << endl;
    } else {
        cerr << "Failed to open database" << endl;
        return 1;
    }

    auto mid_time_3 = chrono::high_resolution_clock::now();
    chrono::duration<double> db_duration = mid_time_3 - mid_time_2;
    cout << "Total time for creating and saving info in database " << db_duration.count() << " seconds" << endl;

    auto end_time = chrono::high_resolution_clock::now();
    chrono::duration<double> total_duration = end_time - start_time;
    cout << "Total execution time: " << total_duration.count() << " seconds" << endl;

    return 0;
}