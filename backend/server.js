const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;
let clients = new Map();

const importUuid = async () => {
  const { v4: uuidv4 } = await import('uuid');
  return uuidv4;
};

// WebSocket logic
wss.on('connection', async ws => {
  const uuidv4 = await importUuid();
  const clientId = uuidv4();
  clients.set(clientId, ws);
  console.log(`Client connected with ID: ${clientId}`);
  
  // Send the new client their ID
  ws.send(JSON.stringify({ type: 'your_id', id: clientId }));

  // Notify all other clients about the new peer
  const otherClientIds = Array.from(clients.keys()).filter(id => id !== clientId);
  otherClientIds.forEach(id => {
    clients.get(id).send(JSON.stringify({ type: 'new_peer', id: clientId }));
  });

  // Relay all messages to other connected clients
  ws.on('message', message => {
    try {
      const parsedMessage = JSON.parse(message);
      if (parsedMessage.type && parsedMessage.recipientId) {
        const recipientWs = clients.get(parsedMessage.recipientId);
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
          // Add senderId for the recipient to know who sent the message
          parsedMessage.senderId = clientId; 
          recipientWs.send(JSON.stringify(parsedMessage));
        }
      }
    } catch (e) {
      console.error('Failed to parse or relay message:', e);
    }
  });

  // Handle client disconnections
  ws.on('close', () => {
    console.log(`Client with ID ${clientId} disconnected`);
    clients.delete(clientId);
    // Notify all remaining clients that this peer has left
    clients.forEach(clientWs => {
        clientWs.send(JSON.stringify({ type: 'peer_left', id: clientId }));
    });
  });

  // Handle errors
  ws.on('error', error => {
    console.error('WebSocket error:', error);
  });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${PORT}`);
});
