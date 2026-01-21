// --- CONFIGURATION ---
if (typeof _CONFIG === 'undefined') alert("Error: config.js missing");
const supabase = window.supabase.createClient(_CONFIG.supabaseUrl, _CONFIG.supabaseKey);

let currentEmp = null;
let activeChatId = null;
let currentChatChannel = null; // Store subscription to unsubscribe later

// --- 1. AUTHENTICATION ---
window.addEventListener('load', async () => {
    // Check if session exists
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
        verifyEmployee(session.user);
    } else {
        document.getElementById('login-screen').style.display = 'flex';
    }
});

async function empLogin() {
    const e = document.getElementById('e-email').value;
    const p = document.getElementById('e-pass').value;
    
    const { data, error } = await supabase.auth.signInWithPassword({ email: e, password: p });
    
    if (error) {
        document.getElementById('login-error').innerText = "Login Failed: " + error.message;
    } else {
        verifyEmployee(data.user);
    }
}

async function verifyEmployee(user) {
    // Check 'employees' table (replaces db.collection('employees'))
    const { data: emp, error } = await supabase.from('employees').select('*').eq('id', user.id).single();

    if (emp) {
        currentEmp = emp;
        document.getElementById('login-screen').style.display = 'none';
        initDashboard();
    } else {
        alert("Access Denied: You are not authorized as staff.");
        await supabase.auth.signOut();
    }
}

// --- 2. DASHBOARD INITIALIZATION ---
function initDashboard() {
    setupRibbon();
    setupQueues();
    setupMissedCalls();
    
    // Set Status Online
    supabase.from('employees').update({ 
        status: 'online', 
        last_active: new Date() 
    }).eq('id', currentEmp.id);

    // Handle Search
    document.querySelector('.search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchClient(e.target.value);
    });
}

// --- 3. QUEUE SYSTEM (Replicates Snapshots) ---
function setupQueues() {
    // Listen to ALL changes in 'conversations' table
    supabase.channel('public:conversations')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
            refreshQueues(); // Refresh UI whenever DB changes
        })
        .subscribe();
    
    refreshQueues(); // Initial Fetch
}

async function refreshQueues() {
    // A. Waiting Queue
    const { data: waiting } = await supabase.from('conversations')
        .select('*').eq('status', 'queued').order('last_activity', { ascending: true });
    
    const wList = document.getElementById('queue-waiting');
    wList.innerHTML = '';
    if(waiting) waiting.forEach(doc => renderQueueItem(doc, wList, 'waiting'));

    // B. My Active Chats
    const { data: active } = await supabase.from('conversations')
        .select('*').eq('assigned_to', currentEmp.id).eq('status', 'active');
    
    const aList = document.getElementById('queue-active');
    aList.innerHTML = '';
    if(active) {
        active.forEach(doc => renderQueueItem(doc, aList, 'active'));
        // Sync Count
        supabase.from('employees').update({ active_chat_count: active.length }).eq('id', currentEmp.id);
    }
}

function renderQueueItem(d, container, type) {
    const div = document.createElement('div');
    // Keeps EXACT CSS classes from original
    div.className = `queue-item ${activeChatId === d.id ? 'active' : ''}`;
    div.innerHTML = `
        <div class="q-name">${d.user_name || 'Guest User'}</div>
        <div class="q-meta">
            <span>UID: ${d.uid_display || '...'}</span>
            <span class="badge ${type === 'waiting' ? 'new' : ''}">${type.toUpperCase()}</span>
        </div>
    `;
    div.onclick = () => pickUpChat(d.id, type);
    container.appendChild(div);
}

// --- 4. PICKUP LOGIC ---
async function pickUpChat(chatId, type) {
    if (activeChatId === chatId) return;
    
    if (type === 'waiting') {
        // Check Limit
        const { data: me } = await supabase.from('employees').select('active_chat_count').eq('id', currentEmp.id).single();
        if ((me?.active_chat_count || 0) >= 2) {
            return alert("⛔ LIMIT REACHED: You are handling 2 chats. Please finish one.");
        }
        
        // Assign
        await supabase.from('conversations').update({
            assigned_to: currentEmp.id,
            status: 'active'
        }).eq('id', chatId);
    }

    activeChatId = chatId;
    loadChatUI(chatId);
    loadSecureDetails(chatId);
}

// --- 5. CHAT UI (Replicates Messages Snapshot) ---
function loadChatUI(chatId) {
    // 1. Unsubscribe previous
    if (currentChatChannel) supabase.removeChannel(currentChatChannel);

    document.getElementById('header-title').innerText = "Chatting with UID: " + chatId.substring(0,6);
    const msgArea = document.getElementById('msg-area');
    msgArea.innerHTML = '';

    // 2. Load History
    loadHistory(chatId);

    // 3. Listen for NEW messages
    currentChatChannel = supabase.channel(`chat:${chatId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chatId}` }, 
        payload => {
            renderMessage(payload.new);
        })
        .subscribe();
}

async function loadHistory(chatId) {
    const { data: msgs } = await supabase.from('messages')
        .select('*').eq('conversation_id', chatId).order('created_at', { ascending: true });
    
    if(msgs) msgs.forEach(msg => renderMessage(msg));
}

function renderMessage(d) {
    const msgArea = document.getElementById('msg-area');
    const time = new Date(d.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    
    // Uses EXACT CSS classes: 'msg-bubble', 'employee', 'client'
    const isMe = d.sender_id === currentEmp.id;
    msgArea.innerHTML += `
        <div class="msg-bubble ${isMe ? 'employee' : 'client'}">
            ${d.text}
            <span class="msg-time">${time}</span>
        </div>`;
    msgArea.scrollTop = msgArea.scrollHeight;
}

async function sendEmpMessage() {
    const input = document.getElementById('emp-input');
    const txt = input.value.trim();
    if(!txt || !activeChatId) return;
    
    input.value = '';
    await supabase.from('messages').insert([{
        conversation_id: activeChatId,
        sender_id: currentEmp.id,
        text: txt
    }]);
}

async function closeActiveChat() {
    if(!activeChatId) return;
    if(confirm("End this session? It will be removed from your active queue.")) {
        await supabase.from('conversations').update({ status: 'closed', assigned_to: null }).eq('id', activeChatId);
        activeChatId = null;
        document.getElementById('msg-area').innerHTML = '<div style="text-align:center; color:#94a3b8; margin-top:50px;">Select a client from the queue.</div>';
        document.getElementById('header-title').innerText = 'Select a Chat';
        clearSecureInputs();
    }
}

// --- 6. SECURE DETAILS & RIBBON ---
async function loadSecureDetails(chatId) {
    // Map Conversation ID -> Client User ID
    const { data: conv } = await supabase.from('conversations').select('user_id').eq('id', chatId).single();
    if(!conv) return;

    // Fetch Secure Record
    const { data: rec } = await supabase.from('secure_records').select('*').eq('client_uid', conv.user_id).single();
    
    document.getElementById('inp-passport').value = rec?.passport_number || '';
    document.getElementById('inp-appid').value = rec?.application_id || '';
    document.getElementById('inp-notes').value = rec?.notes || '';
}

function clearSecureInputs() {
    document.getElementById('inp-passport').value = '';
    document.getElementById('inp-appid').value = '';
    document.getElementById('inp-notes').value = '';
}

async function saveSecureDetails() {
    if(!activeChatId) return alert("Select a chat first.");
    
    const { data: conv } = await supabase.from('conversations').select('user_id').eq('id', activeChatId).single();
    if(!conv) return;

    const updates = {
        client_uid: conv.user_id,
        passport_number: document.getElementById('inp-passport').value,
        application_id: document.getElementById('inp-appid').value,
        notes: document.getElementById('inp-notes').value,
        updated_by: currentEmp.name
    };

    // Upsert
    await supabase.from('secure_records').upsert(updates);

    // Ribbon
    const deadline = document.getElementById('inp-deadline').value;
    if (deadline) {
        await supabase.from('global_tasks').insert([{
            client_uid: conv.user_id,
            note: updates.notes.substring(0, 30),
            deadline: deadline,
            created_by: currentEmp.name
        }]);
        alert("✅ Saved & Added to Deadline Ribbon");
    } else {
        alert("✅ Records Saved");
    }
}

function setupRibbon() {
    // Listen for ribbon changes
    supabase.channel('ribbon-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'global_tasks' }, () => loadRibbon())
        .subscribe();
    loadRibbon();
}

async function loadRibbon() {
    const { data } = await supabase.from('global_tasks')
        .select('*').eq('status', 'pending').order('deadline', { ascending: true });
        
    const track = document.getElementById('ribbon-track');
    track.innerHTML = '';
    if(data) {
        data.forEach(d => {
            const date = new Date(d.deadline).toLocaleDateString();
            const item = document.createElement('div');
            item.className = 'ribbon-item'; // Exact CSS class
            if(new Date(d.deadline) < new Date()) item.classList.add('urgent');
            item.innerHTML = `<span>UID: ...${d.client_uid ? d.client_uid.substring(0,4) : '???'}</span> | <b>${d.note}</b> | <span>${date}</span>`;
            track.appendChild(item);
        });
    }
}

// --- 7. MISSED CALLS ---
function setupMissedCalls() {
    supabase.channel('missed-calls-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'missed_calls' }, () => refreshMissed())
        .subscribe();
    refreshMissed();
}

async function refreshMissed() {
    const { data } = await supabase.from('missed_calls').select('*').eq('status', 'unattended');
    const list = document.getElementById('queue-missed');
    list.innerHTML = '';
    
    if(data) {
        data.forEach(d => {
            const div = document.createElement('div');
            div.className = 'queue-item';
            div.innerHTML = `
                <div class="q-name" style="color:var(--danger)">MISSED CALL</div>
                <div class="q-meta">${new Date(d.created_at).toLocaleTimeString()}</div>
            `;
            div.onclick = async () => {
                await supabase.from('missed_calls').update({ status: 'attended' }).eq('id', d.id);
            };
            list.appendChild(div);
        });
    }
}

async function searchClient(query) {
    // Search by exact UID Display (the 6 digit code)
    const { data } = await supabase.from('conversations').select('*').eq('uid_display', query).single();
    if(data) pickUpChat(data.id, 'search');
    else alert("Client not found.");
}
