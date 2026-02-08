const express = require('express');
const axios = require('axios');
const firebase = require('firebase/compat/app');
require('firebase/compat/database');

const app = express();
app.use(express.json());

// ================= [ CONFIGURATION ] =================
// Apni Firebase Details Yahan Bharein
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

// ================= [ BACKEND ENGINE ] =================
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const sitesRef = db.ref('monitored_sites');

let activeIntervals = {};

const performPing = async (id, url) => {
    const startTime = Date.now();
    try {
        // Render sites ko active rakhne ke liye 15s timeout
        const res = await axios.get(url, { 
            timeout: 15000,
            headers: { 'User-Agent': 'RenderAlive-Pro/3.0' }
        });
        
        const responseTime = Date.now() - startTime;
        sitesRef.child(id).update({
            status: 'Online',
            lastPing: new Date().toLocaleString(),
            responseTime: responseTime + 'ms',
            lastCode: res.status
        });
    } catch (error) {
        sitesRef.child(id).update({
            status: 'Offline',
            lastPing: new Date().toLocaleString(),
            lastCode: error.response ? error.response.status : 'ERR'
        });
    }
};

// Site monitoring logic
sitesRef.on('value', (snapshot) => {
    const sites = snapshot.val();
    if (!sites) return;

    Object.keys(sites).forEach(id => {
        const site = sites[id];
        
        if (site.enabled && !activeIntervals[id]) {
            console.log(`Starting Monitor: ${site.url}`);
            // Pehla ping turant
            performPing(id, site.url);
            // Interval setup
            const ms = (parseInt(site.interval) || 5) * 60 * 1000;
            activeIntervals[id] = setInterval(() => performPing(id, site.url), ms);
        } 
        else if (!site.enabled && activeIntervals[id]) {
            console.log(`Stopping Monitor: ${site.url}`);
            clearInterval(activeIntervals[id]);
            delete activeIntervals[id];
        }
    });
});

// ================= [ DASHBOARD UI ] =================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RenderAlive | Professional Uptime</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap');
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: #05070a; }
        .glass-card { background: rgba(17, 25, 40, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); }
        .status-dot { height: 10px; width: 10px; border-radius: 50%; display: inline-block; }
    </style>
</head>
<body class="text-slate-200">

    <div class="max-w-6xl mx-auto px-4 py-8">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="glass-card p-6 rounded-3xl">
                <p class="text-slate-400 text-sm uppercase font-bold tracking-widest">Total Projects</p>
                <h2 id="total-count" class="text-4xl font-extrabold mt-2 text-blue-500">0</h2>
            </div>
            <div class="glass-card p-6 rounded-3xl border-l-4 border-l-emerald-500">
                <p class="text-slate-400 text-sm uppercase font-bold tracking-widest">Active Pings</p>
                <h2 id="active-count" class="text-4xl font-extrabold mt-2 text-emerald-500">0</h2>
            </div>
            <div class="glass-card p-6 rounded-3xl">
                <p class="text-slate-400 text-sm uppercase font-bold tracking-widest">Global Status</p>
                <h2 class="text-2xl font-extrabold mt-2 text-white flex items-center">
                    <span class="status-dot bg-emerald-500 mr-2 animate-pulse"></span> SYSTEM OK
                </h2>
            </div>
        </div>

        <div class="glass-card p-8 rounded-[2rem] mb-10 shadow-2xl">
            <h3 class="text-xl font-bold mb-6 flex items-center"><i class="fas fa-satellite-dish mr-3 text-blue-500"></i> Register New Endpoint</h3>
            <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div class="lg:col-span-2">
                    <input type="url" id="site-url" placeholder="https://your-app.render.com" class="w-full bg-slate-900/50 border border-slate-700 p-4 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                </div>
                <div class="relative">
                    <input type="number" id="site-interval" placeholder="Time (Min)" class="w-full bg-slate-900/50 border border-slate-700 p-4 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all">
                    <span class="absolute right-4 top-4 text-slate-500">Min</span>
                </div>
                <button onclick="addNewSite()" class="bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl p-4 transition-all shadow-lg shadow-blue-500/20 active:scale-95">
                    START MONITORING
                </button>
            </div>
        </div>

        <div id="sites-container" class="grid grid-cols-1 md:grid-cols-2 gap-6">
            </div>
    </div>

    <script>
        const config = ${JSON.stringify(firebaseConfig)};
        firebase.initializeApp(config);
        const database = firebase.database();
        const rootRef = database.ref('monitored_sites');

        function addNewSite() {
            const url = document.getElementById('site-url').value;
            const time = document.getElementById('site-interval').value;
            if(!url || !time) return alert("Bhai, Details to bharo!");

            rootRef.push({
                url: url,
                interval: time,
                enabled: true,
                status: 'Initialising',
                lastPing: 'Just Now',
                responseTime: '...'
            });
            document.getElementById('site-url').value = '';
        }

        function toggle(id, current) { rootRef.child(id).update({ enabled: !current }); }
        function del(id) { if(confirm('Band kar dein monitoring?')) rootRef.child(id).remove(); }

        rootRef.on('value', (snapshot) => {
            const data = snapshot.val();
            const container = document.getElementById('sites-container');
            container.innerHTML = '';
            
            if(!data) {
                document.getElementById('total-count').innerText = '0';
                document.getElementById('active-count').innerText = '0';
                return;
            }

            let activeCount = 0;
            const keys = Object.keys(data);
            document.getElementById('total-count').innerText = keys.length;

            keys.forEach(id => {
                const site = data[id];
                if(site.enabled) activeCount++;
                
                const isUp = site.status === 'Online';
                
                container.innerHTML += \`
                    <div class="glass-card p-6 rounded-3xl transition-all hover:scale-[1.02]">
                        <div class="flex justify-between items-start mb-4">
                            <div class="truncate pr-4">
                                <h4 class="text-blue-400 font-bold truncate">\${site.url}</h4>
                                <span class="text-[10px] text-slate-500 uppercase tracking-widest">Interval: \${site.interval} Mins</span>
                            </div>
                            <span class="\${isUp ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-400'} px-3 py-1 rounded-full text-[10px] font-black uppercase">
                                \${site.status}
                            </span>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4 mb-6">
                            <div class="bg-slate-900/40 p-3 rounded-xl">
                                <p class="text-[10px] text-slate-500">RESPONSE</p>
                                <p class="font-mono text-sm">\${site.responseTime}</p>
                            </div>
                            <div class="bg-slate-900/40 p-3 rounded-xl">
                                <p class="text-[10px] text-slate-500">LAST PING</p>
                                <p class="text-xs truncate">\${site.lastPing.split(',')[1] || '---'}</p>
                            </div>
                        </div>

                        <div class="flex gap-3">
                            <button onclick="toggle('\${id}', \${site.enabled})" class="flex-1 p-2 rounded-xl text-xs font-bold \${site.enabled ? 'bg-amber-500/20 text-amber-500' : 'bg-emerald-500/20 text-emerald-500'} transition-colors">
                                \${site.enabled ? '<i class="fas fa-pause mr-1"></i> PAUSE' : '<i class="fas fa-play mr-1"></i> RESUME'}
                            </button>
                            <button onclick="del('\${id}')" class="p-2 px-4 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                \`;
            });
            document.getElementById('active-count').innerText = activeCount;
        });
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('--- RENDER ALIVE PRO SYSTEM START ---');
    // Self-ping logic to keep the pinger itself alive
    setInterval(() => {
        const myUrl = process.env.RENDER_EXTERNAL_URL;
        if(myUrl) axios.get(myUrl).catch(e => console.log("Self ping failed"));
    }, 10 * 60 * 1000); 
});
