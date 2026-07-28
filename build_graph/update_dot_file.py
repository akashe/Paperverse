
def fix_dot_format(input_file, output_file):
    with open(input_file, 'r') as infile, open(output_file, 'w') as outfile:
        for line in infile:
            # Remove any leading or trailing whitespace
            line = line.strip()
            line = line.replace("\n", "") \
                .replace("\r", "") \
                .replace(r'\"', "")\
                .replace('""', '"')\
                .replace(r'\\', "")\
                .replace('\
', '') \
            # Fix the format of edges
            # if '->' in line:
            #     line = line.replace(' ;', ';').replace('->', ' -> ')
            outfile.write(line + '\n')


# Specify the input and output file paths
input_file = 'data/citation_network_with_pagerank.dot'
output_file = 'data/citation_network_with_pagerank_fixed.dot'

# Run the function to fix the DOT file format
fix_dot_format(input_file, output_file)
