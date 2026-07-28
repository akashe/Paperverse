import React, { useEffect, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import axios from '../axiosInstance'; // Import the custom Axios instance
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
    height: '80vh', // Change to viewport height
    width: '100%',
    marginTop: '20px',
    // Cytoscape's `fit: true` layout already rescales the graph to match
    // this container, so a scrollbar is never actually needed — but with
    // `overflow: auto` one could still appear/disappear at the sizing
    // boundary, shrinking/growing the container width each time, which
    // retriggers `fit` and flickers the scrollbar in a feedback loop.
    overflow: 'hidden',
  },
  tooltipCard: {
    // pointerEvents: 'none',
    maxWidth: '300px',
  },
  addButton: {
    marginTop: '10px',
  },
});

function Graph({ rootNode, depth, numPapers, selectionCriteria }) {
  const classes = useStyles();
  const cyRef = useRef(null);
  const { currentUser } = useAuth();
  const [tooltip, setTooltip] = React.useState({
    open: false,
    anchorEl: null,
    data: null,
    added: false, // New property
  });

  useEffect(() => {
    if (cyRef.current) {
      const cy = cyRef.current;

      // Clear existing elements
      cy.elements().remove();

      // Add root node
      cy.add({
        data: {
          id: rootNode.id.toString(),
          label: rootNode.label || rootNode.id.toString(),
        },
      });

      // Load first-level children
      loadChildren(rootNode.id.toString());

      // Center and fit the graph
      cy.layout({
        name: 'breadthfirst',
        directed: true,
        padding: 10,
        spacingFactor: 2,
        grid: true,
        rankDir: 'TB',
        rankSep: 600,
        fit: true, // Increased from 200 to 400
        minDist: 100, // Minimum distance between nodes
        maxDist: 200, // Maximum distance between nodes
      }).run();
    }
  }, [rootNode]);

  // Function to load children of a node
  const loadChildren = (nodeId) => {
    axios
      .post('/get_children/', {
        paper_id: nodeId,
        depth: parseInt(depth),
        root_id: rootNode.id,
        num_papers: parseInt(numPapers),
        selection_criteria: selectionCriteria,
      })
      .then((response) => {
        const cy = cyRef.current;
        cy.batch(() => {
          if (nodeId !== rootNode.id.toString() && response.data.length > 0) {
            // Create a virtual node for the vertical connector
            const connectorId = `connector-${nodeId}`;
            cy.add({
              data: {
                id: connectorId,
                isConnector: true,
                parentNode: nodeId,
              }
            });
  
            // Add edge from parent to connector
            cy.add({
              data: {
                id: `edge-${nodeId}-${connectorId}`,
                source: nodeId,
                target: connectorId,
              }
            });
  
            // Add children and connect them to the connector
            response.data.forEach((child) => {
              // Add child node if it doesn't exist
              if (!cy.getElementById(child.id.toString()).length) {
                cy.add({
                  data: {
                    id: child.id.toString(),
                    label: child.label || child.id.toString(),
                  }
                });
              }
  
              // Connect child to connector
              cy.add({
                data: {
                  id: `edge-${connectorId}-${child.id}`,
                  source: connectorId,
                  target: child.id.toString(),
                }
              });
            });
          } else {
            // Root node: direct connections
            response.data.forEach((child) => {
              // Add child node if it doesn't exist
              if (!cy.getElementById(child.id.toString()).length) {
                cy.add({
                  data: {
                    id: child.id.toString(),
                    label: child.label || child.id.toString(),
                  }
                });
  
                // Connect directly to root
                cy.add({
                  data: {
                    id: `edge-${nodeId}-${child.id}`,
                    source: nodeId,
                    target: child.id.toString(),
                  }
                });
              }
            });
          }
        });

  
        // Update layout
        cy.layout({
          name: 'breadthfirst',
          directed: true,
          padding: 10,
          spacingFactor: 2,
          grid: true,
          rankDir: 'TB',
          rankSep: 200,
        }).run();
      })
      .catch((error) => {
        console.error('Error loading children:', error);
      });
  };

  // Function to collapse children of a node
  const collapseChildren = (nodeId) => {
    const cy = cyRef.current;
    const nodesToRemove = new Set();
    const edgesToRemove = new Set();
  
    const recursiveCollapse = (currentNodeId) => {
      // Get all outgoing edges from this node
      const outgoingEdges = cy.edges(`[source = "${currentNodeId}"]`);
      
      outgoingEdges.forEach(edge => {
        const targetNode = edge.target();
        edgesToRemove.add(edge);
        
        // If target is a connector node
        if (targetNode.data('isConnector')) {
          nodesToRemove.add(targetNode);
          // Get all edges from connector to its children
          const connectorEdges = cy.edges(`[source = "${targetNode.id()}"]`);
          connectorEdges.forEach(connectorEdge => {
            const childNode = connectorEdge.target();
            edgesToRemove.add(connectorEdge);
            nodesToRemove.add(childNode);
            // Recursively remove children of this node
            recursiveCollapse(childNode.id());
          });
        } else {
          // For direct connections (like from root node)
          nodesToRemove.add(targetNode);
          recursiveCollapse(targetNode.id());
        }
      });
    };
  
    recursiveCollapse(nodeId);
  
    // Remove all collected elements in batch
    cy.batch(() => {
      Array.from(edgesToRemove).forEach(edge => edge.remove());
      Array.from(nodesToRemove).forEach(node => node.remove());
    });
  
    // Update layout while maintaining zoom
    const currentZoom = cy.zoom();
    cy.layout({
      name: 'breadthfirst',
      directed: true,
      padding: 50,
      spacingFactor: 1.5,
      grid: true,
      rankDir: 'TB',
      rankSep: 150,
      fit: false,
    }).run();
    cy.zoom(currentZoom);
  };

  // Event Handlers
  useEffect(() => {
    if (cyRef.current) {
      const cy = cyRef.current;

      cy.on('tap', 'node', (evt) => {
        const nodeId = evt.target.id();

        // Check if the node has been expanded already
        if (evt.target.data('expanded')) {
          // Collapse the node
          collapseChildren(nodeId);
          evt.target.data('expanded', false);
        } else {
          // Expand the node
          loadChildren(nodeId);
          evt.target.data('expanded', true);
        }
      });

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
              added: false, // Reset the added state
            });
          })
          .catch((error) => {
            console.error('Error fetching paper info:', error);
          });
      });

      cy.on('mouseout', 'node', (evt) => {
        // Don't close the tooltip if the mouse is over the Popover
        const popoverElement = document.querySelector('.MuiPopover-root');
        if (popoverElement) {
          const popoverRect = popoverElement.getBoundingClientRect();
          if (evt.originalEvent.clientX >= popoverRect.left &&
              evt.originalEvent.clientX <= popoverRect.right &&
              evt.originalEvent.clientY >= popoverRect.top &&
              evt.originalEvent.clientY <= popoverRect.bottom) {
            return;
          }
        }
        
        setTooltip({
          open: false,
          anchorPosition: null,
          data: null,
          nodeId: null,
          added: false
        });
      });
    }
  }, [cyRef, depth, numPapers, selectionCriteria, rootNode]);

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
            cy.userZoomingEnabled(false);
          }}
          layout={{
            name: 'breadthfirst',
            directed: true,
            padding: 10,
            spacingFactor: 2,
            grid: true,
            rankDir: 'TB',
            rankSep: 200,
          }}
          stylesheet={[
            {
              selector: 'node',
              style: {
                label: 'data(label)',
                'background-color': '#1976d2',
                color: '#000',
                'text-valign': 'bottom',
                'text-halign': 'center',
                'text-wrap': 'wrap',
                'text-max-width': '100px',
                'font-size': '16px',
                'text-margin-y': '10px',
                width: '38px', // Fixed width with units
                height: '38px', // Fixed height with units
                'min-width': '38px', // Prevent shrinking
                'min-height': '38px',
                'font-size-relative-to': 'none', // Prevent font scaling
                'text-scale': 1, // Keep text size constant
              },
            },
            {
              selector: 'edge',
              style: {
                width: 2,
                'line-color': '#ccc',
                'target-arrow-color': '#ccc',
                'target-arrow-shape': 'triangle',
                'curve-style': 'straight',
                'edge-distances': 'node-position',
              },
            },
            {
              selector: 'node[isConnector]',
              style: {
                'background-opacity': 0,
                'border-width': 0,
                'width': '1px',
                'height': '1px',
                'shape': 'rectangle',
                label: '', // Ensure connectors have no label
              }
            }
          ]}
        />
      </div>

      <Popover
        open={tooltip.open}
        anchorReference="anchorPosition"
        anchorPosition={tooltip.anchorPosition}
        onClose={() => setTooltip({ open: false, anchorEl: null, data: null, nodeId: null, added: false })}
        anchorOrigin={{
          vertical: 'center',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'center',
          horizontal: 'right',
        }}
        disableRestoreFocus
        transitionDuration={0}  // Add this line
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
                  <Typography
                    variant="body2"
                    className={classes.linkTypography}
                  >
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
                  disabled={tooltip.added} // Disable button if already added
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

export default Graph;
