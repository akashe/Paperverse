import React, { useEffect, useRef, useState } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import axios from '../axiosInstance';
import { makeStyles } from '@mui/styles';
import {
  Card,
  CardContent,
  Typography,
  Popover,
  Button,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';

const useStyles = makeStyles({
  graphContainer: {
    height: '600px',
    width: '100%',
    marginTop: '20px',
  },
  tooltipCard: {
    maxWidth: '300px',
  },
  addButton: {
    marginTop: '10px',
  },
});

function PathGraph({ paths, isPathFinder }) {
  const classes = useStyles();
  const cyRef = useRef(null);
  const { currentUser } = useAuth();
  const [tooltip, setTooltip] = useState({
    open: false,
    anchorPosition: null,
    data: null,
    nodeId: null,
    added: false,
  });

  useEffect(() => {
    if (cyRef.current && paths) {
      const cy = cyRef.current;

      // Clear existing elements
      cy.elements().remove();

      const nodesMap = new Map();
      const edgesSet = new Set();

      const addNode = async (nodeId) => {
        if (!nodesMap.has(nodeId)) {
          try {
            const response = await axios.post('/get_paper_info/', { paper_id: nodeId });
            const paper = response.data;
            const node = {
              data: {
                id: nodeId.toString(),
                label: paper.title || nodeId.toString(),
                fillcolor: '#3498db',
              },
            };
            nodesMap.set(nodeId, node);
            cy.add(node);
          } catch (error) {
            console.error('Error fetching paper info:', error);
          }
        }
      };

      const addEdge = (source, target) => {
        const edgeId = `${source}-${target}`;
        if (!edgesSet.has(edgeId)) {
          edgesSet.add(edgeId);
          cy.add({
            data: {
              id: edgeId,
              source: source.toString(),
              target: target.toString(),
            },
          });
        }
      };

      const processPaths = async () => {
        for (const path of paths) {
          for (let i = 0; i < path.length; i++) {
            await addNode(path[i]);
            if (i > 0) {
              addEdge(path[i - 1], path[i]);
            }
          }
        }
        cy.layout({ name: 'breadthfirst', directed: true, padding: 10, spacingFactor: 1.5 }).run();
      };

      processPaths();
    }
  }, [paths]);

  useEffect(() => {
    if (cyRef.current) {
      const cy = cyRef.current;

      cy.on('mouseover', 'node', (evt) => {
        const nodeId = evt.target.id();
        const nodePosition = evt.target.renderedPosition();
        axios
          .post('/get_paper_info/', { paper_id: nodeId })
          .then((response) => {
            setTooltip({
              open: true,
              anchorPosition: {
                left: nodePosition.x + evt.cy.container().getBoundingClientRect().left,
                top: nodePosition.y + evt.cy.container().getBoundingClientRect().top,
              },
              data: response.data,
              nodeId: nodeId,
              added: false,
            });
          })
          .catch((error) => {
            console.error('Error fetching paper info:', error);
          });
      });

      cy.on('mouseout', 'node', () => {
        setTooltip({ open: false, anchorPosition: null, data: null, nodeId: null, added: false });
      });
    }
  }, [cyRef]);

  const handleAddToReadingList = async () => {
    if (!currentUser) {
      console.log('No current user');
      return;
    }
    console.log('Add to Reading List clicked');
    const userDoc = doc(db, 'users', currentUser.uid);
    try {
      await updateDoc(userDoc, {
        readingList: arrayUnion(tooltip.nodeId),
      });
      console.log('Added to reading list');
      setTooltip({ ...tooltip, open: false, added: true });
    } catch (error) {
      console.error('Error adding to reading list:', error);
    }
  };

  return (
    <>
      <div className={classes.graphContainer}>
        <CytoscapeComponent
          elements={[]}
          style={{ width: '100%', height: '100%' }}
          cy={(cy) => {
            cyRef.current = cy;
          }}
          layout={{ name: 'breadthfirst', directed: true, padding: 10 }}
          stylesheet={[
            {
              selector: 'node',
              style: {
                label: 'data(label)',
                'background-color': 'data(fillcolor)',
                color: '#000',
                'text-valign': 'bottom',
                'text-halign': 'center',
                'text-wrap': 'wrap',
                'text-max-width': '100px',
                'font-size': '16px',
                'text-margin-y': '10px',
                width: 32,
                height: 32,
              },
            },
            {
              selector: 'edge',
              style: {
                width: 2,
                'line-color': '#ccc',
                'target-arrow-color': '#ccc',
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
              },
            },
          ]}
        />
      </div>

      <Popover
        open={tooltip.open}
        anchorReference="anchorPosition"
        anchorPosition={tooltip.anchorPosition}
        onClose={() => setTooltip({ open: false, anchorPosition: null, data: null, nodeId: null, added: false })}
        anchorOrigin={{
          vertical: 'center',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'center',
          horizontal: 'right',
        }}
        disableRestoreFocus
      >
        {tooltip.data && (
          <Card className={classes.tooltipCard}>
            <CardContent>
              <Typography variant="h6">{tooltip.data.title}</Typography>
              <Typography variant="body2">
                <strong>Published Date:</strong> {tooltip.data.published_date}
              </Typography>
              <Typography variant="body2">
                <strong>Citation Count:</strong> {tooltip.data.citationCount}
              </Typography>
              {tooltip.data.url && (
                <Typography variant="body2" className={classes.linkTypography}>
                  <a
                    href={tooltip.data.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={classes.link}
                  >
                    Paper URL
                  </a>
                </Typography>
              )}
              <Typography variant="body2">
                <strong>TL;DR:</strong> {tooltip.data.tldr}
              </Typography>
              {currentUser && currentUser.emailVerified && (
                <Button
                  variant="contained"
                  color="primary"
                  className={classes.addButton}
                  onClick={handleAddToReadingList}
                  disabled={tooltip.added}
                >
                  {tooltip.added ? 'Added to Reading List' : 'Add to Reading List'}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </Popover>
    </>
  );
}

export default PathGraph;