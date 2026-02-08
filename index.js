const { 
    default: makeWASocket, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay
} = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, remove, push } = require('firebase/database');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qrcode = require('qrcode');
const pino = require('pino');

// --- FIREBASE CONFIG --
const firebaseConfig = {
  apiKey: "AIzaSyAb7V8Xxg5rUYi8UKChEd3rR5dglJ6bLhU",
  authDomain: "t2-storage-4e5ca.firebaseapp.com",
  databaseURL: "https://t2-storage-4e5ca-default-rtdb.firebaseio.com",
  projectId: "t2-storage-4e5ca",
  storageBucket: "t2-storage-4e5ca.firebasestorage.app",
  messagingSenderId: "667143720466",
  appId: "1:667143720466:web:c8bfe23f3935d3c7e052cb",
  measurementId: "G-K2KPMMC5C6"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const SESSION_PATH = 'wa_session_v7';
const CHAT_PATH = 'wa_backups';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());

let sock;
let isConnected = false;
let qrCodeData = null;

const cleanData = (obj) => JSON.parse(JSON.stringify(obj));

async function useFirebaseAuthState() {
    let creds;
    const sessionRef = ref(db, SESSION_PATH + '/creds');
    const snapshot = await get(sessionRef);
    if (snapshot.exists()) {
        creds = JSON.parse(JSON.stringify(snapshot.val()), (key, value) => {
            if (value && typeof value === 'object' && value.type === 'Buffer') return Buffer.from(value.data);
            return value;
        });
    } else {
        creds = require('@whiskeysockets/baileys').initAuthCreds();
    }
    return {
        state: {
            creds,
            keys: makeCacheableSignalKeyStore({
                get: async (type, ids) => {
                    const res = {};
                    for (const id of ids) {
                        const itemSnap = await get(ref(db, `${SESSION_PATH}/keys/${type}-${id}`));
                        if (itemSnap.exists()) res[id] = itemSnap.val();
                    }
                    return res;
                },
                set: async (data) => {
                    for (const type in data) {
                        for (const id in data[type]) {
                            const val = data[type][id];
                            const itemRef = ref(db, `${SESSION_PATH}/keys/${type}-${id}`);
                            val ? await set(itemRef, cleanData(val)) : await remove(itemRef);
                        }
                    }
                }
            }, pino({ level: 'silent' }))
        },
        saveCreds: async () => await set(sessionRef, cleanData(creds))
    };
}

async function startWhatsApp() {
    const { state, saveCreds } = await useFirebaseAuthState();
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({ version, logger: pino({ level: 'silent' }), auth: state, browser: ["Master-V7", "Chrome", "1.0.0"] });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) { qrCodeData = await qrcode.toDataURL(qr); io.emit('qr', qrCodeData); }
        if (connection === 'open') { isConnected = true; qrCodeData = null; io.emit('ready', true); }
        if (connection === 'close') { isConnected = false; startWhatsApp(); }
    });
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        const jid = msg.key.remoteJid;
        const name = msg.pushName || jid.split('@')[0];
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "Media Content";
        const time = new Date().toLocaleTimeString();
        const safeId = jid.replace(/[^a-zA-Z0-9]/g, '');
        push(ref(db, `${CHAT_PATH}/${safeId}`), { sender: name, text, time, fromMe: msg.key.fromMe, jid: jid });
    });
}

app.post('/send', async (req, res) => {
    let { jid, message } = req.body;
    if(!jid.includes('@')) jid = jid + '@s.whatsapp.net';
    await sock.sendMessage(jid, { text: message });
    res.json({ success: true });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Master V7</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/socket.io/socket.io.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        body { background: #0b141a; color: #e9edef; font-family: sans-serif; height: 100dvh; display: flex; overflow: hidden; }
        .sidebar { width: 100%; max-width: 350px; background: #111b21; border-right: 1px solid #222d34; display: flex; flex-direction: column; z-index: 20; transition: all 0.3s; }
        .main { flex: 1; display: flex; flex-direction: column; background: #0b141a; z-index: 10; }
        @media (max-width: 768px) {
            .sidebar { position: absolute; left: -100%; height: 100%; }
            .sidebar.active { left: 0; }
        }
        .bubble { padding: 8px 12px; border-radius: 8px; margin: 4px; max-width: 85%; font-size: 14px; word-wrap: break-word; }
        .in { background: #202c33; align-self: flex-start; }
        .out { background: #005c4b; align-self: flex-end; }
        #overlay { position: fixed; inset: 0; background: #0b141a; z-index: 100; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <div id="overlay">
        <div id="qr-box" class="bg-white p-4 rounded-xl mb-4">Connecting...</div>
        <p class="text-emerald-500 font-bold">MASTER PRO V7</p>
    </div>

    <div class="sidebar" id="sidebar">
        <div class="p-4 bg-[#202c33] flex justify-between items-center">
            <h1 class="font-bold text-emerald-500">Chats</h1>
            <button onclick="toggleSidebar()" class="md:hidden text-gray-400"><i class="fas fa-times"></i></button>
        </div>
        <div class="p-3">
            <button onclick="promptDirect()" class="w-full bg-emerald-600 p-2 rounded font-bold text-sm mb-2"><i class="fas fa-plus mr-2"></i>Direct Message</button>
        </div>
        <div id="list" class="flex-1 overflow-y-auto"></div>
    </div>

    <div class="main">
        <div id="head" class="p-3 bg-[#202c33] flex items-center border-b border-[#222d34] hidden">
            <button onclick="toggleSidebar()" class="mr-3 md:hidden"><i class="fas fa-bars"></i></button>
            <div id="name" class="font-bold flex-1">Chat</div>
            <div class="flex gap-2">
                <input id="timer" type="number" placeholder="Sec" class="w-12 bg-[#2a3942] p-1 text-xs rounded">
                <button onclick="send(true)" class="bg-orange-600 p-1 rounded text-[10px] px-2 font-bold">TIMER</button>
            </div>
        </div>
        <div id="msgs" class="flex-1 overflow-y-auto p-4 flex flex-col">
            <div class="m-auto text-center opacity-20"><i class="fab fa-whatsapp text-9xl"></i><p>Select a chat</p></div>
        </div>
        <div id="input" class="p-3 bg-[#202c33] flex gap-2 hidden">
            <input id="txt" type="text" placeholder="Type..." class="flex-1 bg-[#2a3942] p-2 rounded-lg outline-none text-sm">
            <button onclick="send(false)" class="bg-emerald-500 text-black px-4 rounded-lg font-bold"><i class="fas fa-paper-plane"></i></button>
        </div>
    </div>

    <script src="https://www.gstatic.com/firebasejs/9.1.3/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.1.3/firebase-database-compat.js"></script>
    <script>
        const socket = io();
        firebase.initializeApp(${JSON.stringify(firebaseConfig)});
        const db = firebase.database();

        socket.on('qr', url => {
            document.getElementById('overlay').classList.remove('hidden');
            document.getElementById('qr-box').innerHTML = \`<img src="\${url}" class="w-64 h-64">\`;
        });

        socket.on('ready', () => {
            document.getElementById('overlay').classList.add('hidden');
            sync();
        });

        let curJid = null;

        function toggleSidebar() { document.getElementById('sidebar').classList.toggle('active'); }

        function sync() {
            db.ref('${CHAT_PATH}').on('value', snap => {
                const list = document.getElementById('list');
                list.innerHTML = '';
                snap.forEach(c => {
                    const data = Object.values(c.val());
                    const last = data[data.length - 1];
                    const div = document.createElement('div');
                    div.className = "p-4 border-b border-[#222d34] cursor-pointer hover:bg-[#202c33]";
                    div.onclick = () => { openChat(c.key, last.sender, last.jid); if(window.innerWidth < 768) toggleSidebar(); };
                    div.innerHTML = \`<div class="font-bold text-sm">\${last.sender}</div><div class="text-xs text-gray-500 truncate">\${last.text}</div>\`;
                    list.appendChild(div);
                });
            });
        }

        function openChat(id, name, jid) {
            curJid = jid;
            document.getElementById('head').classList.remove('hidden');
            document.getElementById('input').classList.remove('hidden');
            document.getElementById('name').innerText = name;
            db.ref('${CHAT_PATH}/' + id).on('value', snap => {
                const box = document.getElementById('msgs'); box.innerHTML = '';
                snap.forEach(c => {
                    const m = c.val();
                    box.innerHTML += \`<div class="bubble \${m.fromMe ? 'out' : 'in'}">\${m.text}</div>\`;
                });
                box.scrollTop = box.scrollHeight;
            });
        }

        async function send(isTimer) {
            const txt = document.getElementById('txt');
            const sec = document.getElementById('timer').value;
            if(!txt.value) return;
            if(isTimer && !sec) return alert('Enter seconds');
            
            if(isTimer) {
                alert('Scheduled for ' + sec + 's');
                setTimeout(() => fetch('/send', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ jid: curJid, message: '[Timer]: ' + txt.value }) }), sec * 1000);
            } else {
                fetch('/send', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ jid: curJid, message: txt.value }) });
            }
            txt.value = '';
        }

        function promptDirect() {
            const num = prompt('Enter WhatsApp Number (with country code, e.g. 91...)');
            const msg = prompt('Enter Message');
            if(num && msg) fetch('/send', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ jid: num, message: msg }) });
        }
    </script>
</body>
</html>
    `);
});

startWhatsApp();
server.listen(PORT, () => console.log('Live on ' + PORT));
