
const SIGNALLING_SERVER_URL = `ws://localhost:3000`; 

const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const messagesContainer = document.getElementById('messages');
const connectionCountSpan = document.getElementById('connectionCount');

let myId = null;
let peerConnections = new Map();
let dataChannels = new Map();

// Signaling server WebSocket
const signalingServer = new WebSocket(SIGNALLING_SERVER_URL);

// WebRTC configuration (STUN server for NAT traversal)
const peerConnectionConfig = {
    'iceServers': [
        { 'urls': 'stun:stun.l.google.com:19302' },
        { 'urls': 'stun:stun1.l.google.com:19302' },
    ]
};

// Function to scroll to the bottom of the messages container
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateConnectionCount() {
    const count = peerConnections.size;
    connectionCountSpan.textContent = `${count} peer${count !== 1 ? 's' : ''} connected`;
    connectionCountSpan.className = `connection-status ${count > 0 ? 'connected' : 'connecting'}`;
}

function appendStatusMessage(text) {
    const statusMessage = document.createElement('p');
    statusMessage.className = "text-center text-gray-500 text-sm italic py-2";
    statusMessage.textContent = text;
    messagesContainer.appendChild(statusMessage);
    scrollToBottom();
}

// Function to create a new peer connection
function createPeerConnection(peerId, isInitiator) {
    const peer = new RTCPeerConnection(peerConnectionConfig);
    peerConnections.set(peerId, peer);

    if (isInitiator) {
        // If initiating, create a data channel
        const dataChannel = peer.createDataChannel('chat');
        setupDataChannel(dataChannel, peerId);
        dataChannels.set(peerId, dataChannel);
    } else {
        // Wait for the data channel to be opened by the other peer
        peer.ondatachannel = event => {
            const dataChannel = event.channel;
            setupDataChannel(dataChannel, peerId);
            dataChannels.set(peerId, dataChannel);
        };
    }

    // Handle ICE candidates
    peer.onicecandidate = event => {
        if (event.candidate) {
            signalingServer.send(JSON.stringify({
                type: 'candidate',
                candidate: event.candidate,
                recipientId: peerId
            }));
        }
    };
    
    // Set up handlers for when the connection state changes
    peer.onconnectionstatechange = () => {
        console.log(`Connection to peer ${peerId} state:`, peer.connectionState);
        if (peer.connectionState === 'connected') {
            updateConnectionCount();
        } else if (peer.connectionState === 'disconnected' || peer.connectionState === 'closed') {
            peerConnections.delete(peerId);
            dataChannels.delete(peerId);
            updateConnectionCount();
            appendStatusMessage(`Peer ${peerId.substring(0, 8)} disconnected.`);
        }
    };
    
    return peer;
}

function setupDataChannel(channel, peerId) {
    channel.onmessage = event => {
        const receivedMessage = JSON.parse(event.data);
        appendMessage(receivedMessage.text, receivedMessage.timestamp, false, peerId.substring(0, 8));
    };
    channel.onopen = () => {
        console.log(`Data Channel with peer ${peerId} is open!`);
        appendStatusMessage(`Peer ${peerId.substring(0, 8)} connected.`);
    };
}

// Signaling server handlers
signalingServer.onmessage = async event => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'your_id') {
        myId = message.id;
        console.log('My client ID:', myId);
        messagesContainer.innerHTML = '<p class="text-center text-gray-500">Waiting for other peers to connect...</p>';

    } else if (message.type === 'new_peer') {
        const peerId = message.id;
        console.log('New peer joined:', peerId);
        // Create a peer connection and send an offer to the new peer
        const peerConnection = createPeerConnection(peerId, true);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        signalingServer.send(JSON.stringify({
            type: 'offer',
            offer: peerConnection.localDescription,
            recipientId: peerId
        }));

    } else if (message.type === 'offer') {
        const peerId = message.senderId;
        const peerConnection = createPeerConnection(peerId, false);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        signalingServer.send(JSON.stringify({
            type: 'answer',
            answer: peerConnection.localDescription,
            recipientId: peerId
        }));
    
    } else if (message.type === 'answer') {
        const peerConnection = peerConnections.get(message.senderId);
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
        }

    } else if (message.type === 'candidate') {
        const peerConnection = peerConnections.get(message.senderId);
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
            } catch (e) {
                console.error('Error adding ICE candidate:', e);
            }
        }
    }
};

// Append a new message to the chat UI
function appendMessage(text, timestamp, isSentByMe, senderId) {
    const messageBubbleClass = isSentByMe ? 'sent' : 'received';
    const messageInfoClass = isSentByMe ? 'sent' : 'received';
    
    const messageElement = document.createElement('div');
    messageElement.classList.add('flex', 'flex-col', 'w-full', isSentByMe ? 'items-end' : 'items-start');
    
    const bubble = document.createElement('div');
    bubble.classList.add('message-bubble', messageBubbleClass);
    bubble.textContent = text;

    const info = document.createElement('div');
    info.classList.add('message-info', messageInfoClass);
    info.textContent = `${isSentByMe ? 'You' : senderId} • ${timestamp}`;

    messageElement.appendChild(bubble);
    messageElement.appendChild(info);

    messagesContainer.appendChild(messageElement);
    scrollToBottom();
}

// Send a new message
function sendMessage() {
    const text = messageInput.value.trim();
    if (text === '') {
        return;
    }

    const message = {
        text: text,
        timestamp: new Date().toLocaleTimeString()
    };

    // Send message over the data channel to all connected peers
    dataChannels.forEach(channel => {
        if (channel.readyState === 'open') {
            channel.send(JSON.stringify(message));
        }
    });

    // Display your own message immediately
    appendMessage(message.text, message.timestamp, true, myId.substring(0, 8));
    messageInput.value = '';
}

// Event listeners
sendMessageBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});