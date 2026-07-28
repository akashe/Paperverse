import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { List, ListItem, ListItemText, Typography, CircularProgress, Alert, Button } from '@mui/material';
import axios from '../axiosInstance';

function ReadingList() {
  const { currentUser } = useAuth();
  const [readingList, setReadingList] = useState([]);
  const [papers, setPapers] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentUser) return;

    const userDoc = doc(db, 'users', currentUser.uid);
    const unsubscribe = onSnapshot(userDoc, async (docSnap) => {
      if (docSnap.exists()) {
        console.log('Reading List Updated:', docSnap.data().readingList);
        const list = docSnap.data().readingList || [];
        setReadingList(list);

        // Fetch paper details for display. Use allSettled, not all — one
        // paper failing to load (e.g. a stale id no longer in the graph)
        // shouldn't blank out the whole list.
        const results = await Promise.allSettled(
          list.map(paperId => axios.post('/get_paper_info/', { paper_id: paperId }))
        );
        const papersData = {};
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            papersData[list[index]] = result.value.data;
          } else {
            console.error(`Error fetching details for paper ${list[index]}:`, result.reason);
          }
        });
        setPapers(papersData);
        setLoading(false);
      } else {
        setReadingList([]);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleRemoveFromReadingList = async (paperId) => {
    if (!currentUser) return;
    const userDoc = doc(db, 'users', currentUser.uid);

    // Remove the paper from the reading list in Firestore
    const updatedList = readingList.filter(id => id !== paperId);
    try {
      await updateDoc(userDoc, { readingList: updatedList });
      setReadingList(updatedList);
    } catch (err) {
      console.error('Error removing paper from reading list:', err);
      setError('Failed to remove paper from reading list.');
    }
  };

  if (loading) {
    return <CircularProgress />;
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <div>
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
        My Reading List</Typography>
      {readingList.length === 0 ? (
        <Typography variant="body1">Your reading list is empty.</Typography>
      ) : (
        <List>
          {readingList.map((paperId) => (
            <ListItem key={paperId} alignItems="flex-start">
              <ListItemText
                primary={papers[paperId]?.title || `Paper ID: ${paperId}`}
                secondary={
                  <>
                    <Typography variant="body2">
                      <strong>Published Date:</strong> {papers[paperId]?.published_date || 'N/A'}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Citation Count:</strong> {papers[paperId]?.citationCount || 'N/A'}
                    </Typography>
                    {papers[paperId]?.url && (
                      <Typography variant="body2">
                        <strong>Paper URL: </strong>
                        <a href={papers[paperId]?.url} target="_blank" rel="noopener noreferrer">
                          View Paper
                        </a>
                      </Typography>
                    )}
                  </>
                }
              />
              <Button
                variant="contained"
                color="secondary"
                onClick={() => handleRemoveFromReadingList(paperId)}
              >
                Remove
              </Button>
            </ListItem>
          ))}
        </List>
      )}
    </div>
  );
}

export default ReadingList;
