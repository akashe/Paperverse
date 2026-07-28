import React, { useState } from 'react';
import {
  TextField,
  Button,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  Grid,
  CircularProgress,
  Box,
  Typography
} from '@mui/material';
import axios from '../axiosInstance';
import Graph from './Graph';
import { Autocomplete, Alert } from '@mui/material';
import debounce from 'lodash/debounce';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAnonymous } from '../contexts/AnonymousContext';

function CitationNetwork() {
  const [searchQuery, setSearchQuery] = useState('');
  const [paperOptions, setPaperOptions] = useState([]);
  const [selectedPaper, setSelectedPaper] = useState('');
  const [depth, setDepth] = useState('');
  const [numPapers, setNumPapers] = useState('');
  const [selectionCriteria, setSelectionCriteria] = useState('');
  const [rootNode, setRootNode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [treeGenerationCount, setTreeGenerationCount] = useState(0);
  const { incrementGraphCount, graphCount, shouldPromptLogin } = useAnonymous();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const getHintText = (step) => {
    if (treeGenerationCount >= 5) return null;
    
    switch(step) {
      case 1:
        return "Start by searching for a research paper using its title. This will be the central node of your citation network.";
      case 2:
        return "Choose how many levels deep you want to explore the citations. A higher depth shows more connections but may be more complex.";
      case 3:
        return "Select how many papers to display at each level. More papers give a broader view but may be harder to navigate.";
      case 4:
        return "Choose how to select papers: by citation count (most cited), PageRank (most influential), or random selection.";
      default:
        return null;
    }
  };
  
  const debouncedSearch = React.useCallback(
    debounce(async (query) => {
      if (!query || query.length < 3) return; // Only search if query is 3 or more characters
      setSearchLoading(true);
      try {
        const response = await axios.post('/search_papers/', { query });
        setPaperOptions(response.data);
      } catch (error) {
        console.error('Error searching papers:', error);
      } finally {
        setSearchLoading(false);
      }
    }, 800), // Increased debounce delay to 800ms
    [] // Empty dependency array since we don't need to recreate this function
  );

  const handleStepComplete = () => {
    if (currentStep < 4) {
      setCurrentStep(prev => prev + 1);
    } else {
      setTreeGenerationCount(prev => prev + 1);
      handleGenerateTree();
    }
  };

  React.useEffect(() => {
    return () => {
      debouncedSearch.cancel();
    };
  }, [debouncedSearch]);

  const handlePaperSelection = (newValue) => {
    setSelectedPaper(newValue ? newValue.id : '');
    // Reset all subsequent values
    setDepth('');
    setNumPapers('');
    setSelectionCriteria('');
    setRootNode(null);
    if (newValue) {
      setCurrentStep(2);
    } else {
      setCurrentStep(1);
    }
  };

  const handleDepthChange = (e) => {
    setDepth(e.target.value);
    // Reset subsequent values
    setNumPapers('');
    setSelectionCriteria('');
    setRootNode(null);
    if (e.target.value) {
      setCurrentStep(3);
    }
  };

  const handleNumPapersChange = (e) => {
    setNumPapers(e.target.value);
    // Reset subsequent values
    setSelectionCriteria('');
    setRootNode(null);
    if (e.target.value) {
      setCurrentStep(4);
    }
  };
  
  const handleSelectionCriteriaChange = (e) => {
    setSelectionCriteria(e.target.value);
    setRootNode(null);
    if (e.target.value) {
      handleStepComplete();
    }
  };

  const handleGenerateTree = () => {
    if (!currentUser && graphCount >= 3) {
      navigate('/login', { state: { exceeded: true } });
      return;
    }

    setLoading(true);
    axios
      .post('/generate_tree/', {
        paper_id: selectedPaper,
        depth: parseInt(depth),
      })
      .then((response) => {
        if (!currentUser) {
          incrementGraphCount();
        }
        if (response.data.message === 'Tree already exists') {
          loadRootNode();
        } else {
          // Wait a bit for the backend to generate the tree
          setTimeout(loadRootNode, 5000);
        }
      })
      .catch((error) => {
        console.error('Error generating tree:', error);
        setLoading(false);
      });
  };

  const loadRootNode = () => {
    axios
      .post('/get_root_info/', {
        paper_id: selectedPaper,
        depth: parseInt(depth),
      })
      .then((response) => {
        setRootNode(response.data);
        setLoading(false);
      })
      .catch((error) => {
        console.error('Error loading root node:', error);
        setLoading(false);
      });
  };

  const renderLimitWarning = () => {
    if (!currentUser) {
      if (graphCount === 2) {
        return (
          <Alert severity="warning" sx={{ mt: 2 }}>
            You have 1 free visualization remaining. Create an account to get unlimited access!
          </Alert>
        );
      } else if (graphCount >= 3) {
        return (
          <Alert severity="warning" sx={{ mt: 2 }}>
            You have no free visualizations remaining. Please create an account to continue!
          </Alert>
        );
      }
    }
    return null;
  };

  const [open, setOpen] = useState(false);

  return (
    <Box sx={{ 
      mt: 1,
      mx: 'auto',
      p: 1,
    }}>
      {renderLimitWarning()}
      <Box sx={{
        maxWidth: '800px',
        mx: 'auto'
      }}>
      <Typography 
        variant="h4" 
        gutterBottom 
        sx={{
          fontFamily: '"Inter Display", sans-serif',
          fontSize: "30px",
          fontWeight: "700",
          letterSpacing: "-1px",
          textAlign: "center",
          color: "rgb(51, 51, 51)",
          mb: 4
        }}
      >
        Generate Citation Network
      </Typography>
      
      <Grid container direction="column" spacing={3}>
        {/* Step 1: Paper Search */}
        <Grid item xs={12}>
          <Box sx={{ mb: 1 }}>
            {treeGenerationCount < 5 ? (
              <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 1, fontSize: '0.9rem', fontStyle: 'italic' }}>
                {getHintText(1)}
              </Typography>
            ) : (
              <Typography variant="subtitle1" color="primary" sx={{ mb: 1 }}>
                1. Search for a paper
              </Typography>
            )}
            <Autocomplete
              fullWidth
              open={open && (searchLoading || paperOptions.length > 0)}
              onOpen={() => setOpen(true)}
              onClose={() => setOpen(false)}
              options={paperOptions}
              getOptionLabel={(option) => option.label || ''}
              loading={searchLoading}
              noOptionsText="No options"
              onInputChange={(_, newInputValue) => {
                setSearchQuery(newInputValue);
                if (newInputValue.length >= 3) {
                  debouncedSearch(newInputValue);
                } else {
                  setPaperOptions([]);
                }
              }}
              onChange={(_, newValue) => handlePaperSelection(newValue)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Search for a paper (minimum 3 characters)"
                  variant="outlined"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {searchLoading ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          </Box>
        </Grid>

        {/* Step 2: Depth */}
        {currentStep >= 2 && (
          <Grid item xs={12}>
            <Box sx={{ mb: 1 }}>
            {treeGenerationCount < 5 ? (
              <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 1, fontSize: '0.9rem', fontStyle: 'italic' }}>
                {getHintText(2)}
              </Typography>
            ) : (
              <Typography variant="subtitle1" color="primary" sx={{ mb: 1 }}>
                Select citation depth
              </Typography>
            )}
              <FormControl variant="outlined" fullWidth>
                <InputLabel>Depth</InputLabel>
                <Select
                  value={depth}
                  label="Depth"
                  onChange={handleDepthChange}
                >
                  {[2, 3, 4, 5].map((num) => (
                    <MenuItem key={num} value={num}>
                      {`${num} levels`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </Grid>
        )}

        {/* Step 3: Number of Papers */}
        {currentStep >= 3 && (
          <Grid item xs={12}>
            <Box sx={{ mb: 1 }}>
              {treeGenerationCount < 5 ? (
                <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 1, fontSize: '0.9rem', fontStyle: 'italic' }}>
                  {getHintText(3)}
                </Typography>
                ) : (
                  <Typography variant="subtitle1" color="primary" sx={{ mb: 1 }}>
                    Papers per level
                  </Typography>
                )}
              <FormControl variant="outlined" fullWidth>
                <InputLabel>Number of Papers</InputLabel>
                <Select
                  value={numPapers}
                  label="Number of Papers"
                  onChange={handleNumPapersChange}
                >
                  {[5, 10, 15, 20].map((num) => (
                    <MenuItem key={num} value={num}>
                      {`${num} papers`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </Grid>
        )}

        {/* Step 4: Selection Criteria */}
        {currentStep >= 4 && (
          <Grid item xs={12}>
            <Box sx={{ mb: 1 }}>
              {treeGenerationCount < 5 ? (
                <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 1, fontSize: '0.9rem', fontStyle: 'italic' }}>
                  {getHintText(4)}
                </Typography>
                ) : (
                  <Typography variant="subtitle1" color="primary" sx={{ mb: 1 }}>
                    Selection method
                  </Typography>
                )}
              <FormControl variant="outlined" fullWidth>
                <InputLabel>Selection Criteria</InputLabel>
                <Select
                  value={selectionCriteria}
                  label="Selection Criteria"
                  onChange={handleSelectionCriteriaChange}
                >
                  <MenuItem value="citationCount">Citation Count</MenuItem>
                  <MenuItem value="pageRank">PageRank</MenuItem>
                  <MenuItem value="random">Random</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </Grid>
        )}
      </Grid>

      {/* Loading Indicator */}
      {loading && (
        <Grid container justifyContent="center" sx={{ mt: 2 }}>
          <CircularProgress />
          </Grid>
        )}
      </Box>
        {/* Graph Component */}
      {rootNode && !loading && (
        <Graph
          rootNode={rootNode}
          depth={depth}
          numPapers={numPapers}
          selectionCriteria={selectionCriteria}
        />
      )}
    </Box>
  );
}

export default CitationNetwork;