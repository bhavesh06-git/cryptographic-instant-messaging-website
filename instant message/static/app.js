const socket = io();
const cryptoMgr = new CryptoManager();
let currentUser, currentRecipient;
const sessionKeys = {};

// --- WEBRTC VARIABLES ---
let peerConnection;
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }; // Google's free STUN server

window.onload = async () => {
    await cryptoMgr.init();
    document.getElementById('status-bar').innerText = "SYSTEM: READY";
};

// --- AUTH & SETUP --- (Same as before)
async function registerUser() {
    const u = document.getElementById('username-in').value;
    const p = document.getElementById('password-in').value;
    const pub = await cryptoMgr.exportPublicKey();
    await fetch('/register', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({username: u, password: p, public_key: pub})
    });
    alert("REGISTERED");
}

function loginUser() {
    currentUser = document.getElementById('username-in').value;
    if(!currentUser) return;
    document.getElementById('auth-panel').style.display = 'none';
    document.getElementById('chat-panel').style.display = 'block';
    document.getElementById('my-username').innerText = currentUser;
    socket.emit('join', {username: currentUser});
}

async function initiateHandshake() {
    const r = document.getElementById('recipient-in').value;
    const res = await fetch(`/get_key/${r}`);
    if(!res.ok) return alert("USER NOT FOUND");
    const data = await res.json();
    const peerKey = await cryptoMgr.importPeerKey(data.public_key);
    sessionKeys[r] = await cryptoMgr.deriveSharedSecret(peerKey);
    currentRecipient = r;
    alert(`LINK ESTABLISHED: ${r}`);
}

// --- MESSAGING & STEGANOGRAPHY ---
async function sendMessage() {
    const text = document.getElementById('message-in').value;
    const ttl = document.getElementById('ttl-in').value;
    const stegoFile = document.getElementById('stego-upload').files[0]; // Check if user selected an image

    if(!sessionKeys[currentRecipient]) return alert("LINK FIRST");

    let payloadType = 'text';
    let contentToSend = text;

    // STEGANOGRAPHY MODE
    if (stegoFile && text) {
        // Encrypt text FIRST, then hide in image
        const enc = await cryptoMgr.encrypt(text, sessionKeys[currentRecipient]);
        // Format: [STEGO]ciphertext|iv
        const hiddenData = `[STEGO]${enc.cipher}|${enc.iv}`; 
        
        // Hide inside the image
        const stegoImageBase64 = await Stego.encode(stegoFile, hiddenData);
        
        contentToSend = stegoImageBase64; // We send the IMAGE, not the text
        payloadType = 'image_stego';
    } else {
        // NORMAL TEXT MODE
        const enc = await cryptoMgr.encrypt(text, sessionKeys[currentRecipient]);
        contentToSend = enc.cipher; // Send raw cipher
        var iv = enc.iv;
    }

    // Normalizing payload construction
    const payload = {
        sender: currentUser, recipient: currentRecipient,
        ciphertext: contentToSend, 
        iv: (payloadType === 'text') ? iv : 'embedded', // If stego, IV is inside image
        ttl: ttl, 
        type: payloadType
    };

    socket.emit('private_message', payload);
    
    if(payloadType === 'image_stego') {
        displayMessage("ME", "[SENT HIDDEN MESSAGE IN IMAGE]", ttl);
    } else {
        displayMessage("ME", text, ttl);
    }
}

// --- RECEIVING ---
socket.on('incoming_message', async (data) => {
    const sender = data.sender;
    if(!sessionKeys[sender]) { /* (Handshake logic from previous step) */ }

    if (data.type === 'text') {
        const decryptedBuff = await cryptoMgr.decrypt(data.ciphertext, data.iv, sessionKeys[sender]);
        const text = new TextDecoder().decode(decryptedBuff);
        displayMessage(sender, text, data.ttl);
    } 
    else if (data.type === 'image_stego') {
        renderStegoImage(sender, data.ciphertext, data.ttl); // ciphertext is the Base64 Image
    }
});

function displayMessage(sender, text, ttl) {
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `<strong>${sender}</strong>: ${text} <small style="color:red">[${ttl}s]</small>`;
    document.getElementById('messages-area').appendChild(div);
    setTimeout(() => div.remove(), ttl * 1000);
}

// --- STEGO DECODING ---
function renderStegoImage(sender, imgBase64, ttl) {
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `<strong>${sender}</strong> SENT AN IMAGE.<br><img src="${imgBase64}" style="max-width:100px; border:1px solid #0f0"><br><button id="decode-btn">DECODE HIDDEN DATA</button>`;
    
    // Auto-delete logic
    setTimeout(() => div.remove(), ttl * 1000);

    div.querySelector('#decode-btn').onclick = async () => {
        const hiddenRaw = await Stego.decode(imgBase64);
        if(hiddenRaw.startsWith("[STEGO]")) {
            // Extract cipher and IV
            const parts = hiddenRaw.replace("[STEGO]", "").split("|");
            const cipher = parts[0];
            const iv = parts[1];
            
            // Decrypt
            const decryptedBuff = await cryptoMgr.decrypt(cipher, iv, sessionKeys[sender]);
            const text = new TextDecoder().decode(decryptedBuff);
            alert(`HIDDEN MESSAGE FOUND:\n\n"${text}"`);
        } else {
            alert("No valid hidden message found.");
        }
    };
    document.getElementById('messages-area').appendChild(div);
}

// --- VIDEO CALL (WEBRTC) ---

async function startVideoCall() {
    if(!currentRecipient) return alert("SELECT RECIPIENT FIRST");
    
    peerConnection = new RTCPeerConnection(config);
    const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('local-video').srcObject = localStream;
    
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = event => {
        document.getElementById('remote-video').srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', { candidate: event.candidate, to: currentRecipient, sender: currentUser });
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('call-user', { offer: offer, to: currentRecipient, sender: currentUser });
    document.getElementById('video-panel').style.display = 'block';
}

