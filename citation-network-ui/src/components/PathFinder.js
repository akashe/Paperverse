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
import PathGraph from './PathGraph'; // Import the new PathGraph component
import { Autocomplete } from '@mui/material';
import debounce from 'lodash/debounce';

function PathFinder() {
  const [searchQuery1, setSearchQuery1] = useState('');
  const [searchQuery2, setSearchQuery2] = useState('');
  const [paperOptions1, setPaperOptions1] = useState([]);
  const [paperOptions2, setPaperOptions2] = useState([]);
  const [selectedPaper1, setSelectedPaper1] = useState(null);
  const [selectedPaper2, setSelectedPaper2] = useState(null);
  const [searchLoading1, setSearchLoading1] = useState(false);
  const [searchLoading2, setSearchLoading2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paths, setPaths] = useState(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [open1, setOpen1] = useState(false);
  const [open2, setOpen2] = useState(false);
  const [shouldCancel, setShouldCancel] = useState(false);

  const debouncedSearch1 = React.useCallback(
    debounce(async (query) => {
      if (!query || query.length < 3) return;
      setSearchLoading1(true);
      try {
        const response = await axios.post('/search_papers/', { query });
        setPaperOptions1(response.data);
      } catch (error) {
        console.error('Error searching papers:', error);
      } finally {
        setSearchLoading1(false);
      }
    }, 800),
    []
  );

  const debouncedSearch2 = React.useCallback(
    debounce(async (query) => {
      if (!query || query.length < 3) return;
      setSearchLoading2(true);
      try {
        const response = await axios.post('/search_papers/', { query });
        setPaperOptions2(response.data);
      } catch (error) {
        console.error('Error searching papers:', error);
      } finally {
        setSearchLoading2(false);
      }
    }, 800),
    []
  );

  React.useEffect(() => {
    return () => {
      debouncedSearch1.cancel();
      debouncedSearch2.cancel();
    };
  }, [debouncedSearch1, debouncedSearch2]);


  const handleFindPaths = async () => {
    if (!selectedPaper1 || !selectedPaper2) return;
  
    setLoading(true);
    setPaths(null);
  
    try {
      const response = await axios.post('/find_paths/', {
        start_id: selectedPaper1,
        end_id: selectedPaper2,
      });
  
      // If we should cancel, don't update the state with the response
      if (shouldCancel) {
        return;
      }
  
      if (!response.data.paths) {
        alert(response.data.message);
        return;
      }
  
      setPaths(response.data.paths);
    } catch (error) {
      console.error('Error finding paths:', error);
    } finally {
      setLoading(false);
      setShouldCancel(false);
    }
  };

  React.useEffect(() => {
    if (selectedPaper1 && selectedPaper2) {
      handleFindPaths();
    }
  }, [selectedPaper1, selectedPaper2]);

  return (
    <Box sx={{ 
      mt: 1,
      mx: 'auto',
      maxWidth: '1200px',
      p: 1,
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
        Find Citation Path Between Papers
      </Typography>
      
      <Grid container spacing={2} alignItems="center">
        {/* First Paper Search */}
        <Grid item xs={12}>
          <Autocomplete
            fullWidth
            open={open1 && (searchLoading1 || paperOptions1.length > 0)}
            onOpen={() => setOpen1(true)}
            onClose={() => setOpen1(false)}
            options={paperOptions1}
            getOptionLabel={(option) => option.label || ''}
            loading={searchLoading1}
            noOptionsText="No options"
            value={paperOptions1.find(option => option.id === selectedPaper1) || null}
            onInputChange={(_, newInputValue) => {
              setSearchQuery1(newInputValue);
              // Set the cancel flag and reset everything
              setShouldCancel(true);
              setLoading(false);
              setSelectedPaper1(null);
              setSelectedPaper2(null);
              setPaths(null);
              setCurrentStep(1);
              setPaperOptions2([]);
              setSearchQuery2('');
              
              if (newInputValue.length >= 3) {
                debouncedSearch1(newInputValue);
              } else {
                setPaperOptions1([]);
              }
            }}
            onChange={(_, newValue) => {
              setSelectedPaper1(newValue ? newValue.id : null);
              if (newValue) {
                setCurrentStep(2);
              } else {
                setSelectedPaper2(null);
                setPaths(null);
                setCurrentStep(1);
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select the first paper"
                variant="outlined"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {searchLoading1 ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
        </Grid>

        {/* Second Paper Search - Only shown after first paper is selected */}
        {currentStep >= 2 && (
          <Grid item xs={12}>
            <Autocomplete
              fullWidth
              open={open2 && (searchLoading2 || paperOptions2.length > 0)}
              onOpen={() => setOpen2(true)}
              onClose={() => setOpen2(false)}
              options={paperOptions2}
              getOptionLabel={(option) => option.label || ''}
              loading={searchLoading2}
              noOptionsText="No options"
              onInputChange={(_, newInputValue) => {
                setSearchQuery2(newInputValue);
                if (newInputValue.length >= 3) {
                  debouncedSearch2(newInputValue);
                } else {
                  setPaperOptions2([]);
                }
              }}
              onChange={(_, newValue) => {
                setSelectedPaper2(newValue ? newValue.id : null);
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Select the second paper"
                  variant="outlined"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {searchLoading2 ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          </Grid>
        )}
      </Grid>

      {/* Loading Indicator */}
      {loading && (
        <Grid container justifyContent="center" sx={{ mt: 2 }}>
          <CircularProgress />
        </Grid>
      )}

      {/* PathGraph Component */}
      {paths && !loading && (
        <PathGraph
          paths={paths}
          isPathFinder={true}
        />
      )}
    </Box>
  );
}

export default PathFinder;