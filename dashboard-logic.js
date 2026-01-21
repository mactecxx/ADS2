// --- CONFIGURATION CHECK ---
if (typeof _CONFIG === 'undefined') {
    alert("Error: config.js is not loaded. Check your index.html");
    throw new Error("config.js missing");
}

if (typeof window.supabase === 'undefined') {
    alert("Error: Supabase library not loaded. Check your index.html");
    throw new Error("Supabase Lib missing");
}

// Initialize Supabase
// We use 'supabaseClient' to avoid naming conflicts
const supabaseClient = window.supabase.createClient(_CONFIG.supabaseUrl, _CONFIG.supabaseKey);

let currentEmp = null;
let activeChatId = null;
let currentChatChannel = null;

// --- 1. AUTHENTICATION ---
window.addEventListener('load', async () => {
    // Check Session
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session) {
        verifyEmployee(session.user);
    } else {
        document.getElementById('login-screen').style.display = 'flex';
    }
});

async function empLogin() {
    const e = document.getElementById('e-email').value;
    const p = document.getElementById('e-pass').value;
    
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email: e, password: p });
    
    if (error) {
        document.getElementById('login-error').innerText = "Login Failed: " + error.message;
    } else {
        verifyEmployee(data.user);
    }
}

async function verifyEmployee(user) {
    const { data: emp, error } = await supabaseClient.from('employees').select('*').eq('id', user.id).single();

    if (emp) {
        currentEmp = emp;
        document.getElementById('login-screen').style.display = 'none';
        initDashboard();
    } else {
        alert("Access Denied: You are not authorized as staff.");
        await supabaseClient.auth.signOut();
    }
}

// --- 2. DASHBOARD SETUP ---
function initDashboard() {
    setupRibbon();
    setupQueues();
    setupMissedCalls();
    
    supabaseClient.from('employees').update({ 
        status: 'online', 
        last_active: new Date() 
    }).eq('id', currentEmp.id);

    document.querySelector('.search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchClient(e.target.value);
    });
}

// --- 3. QUEUE SYSTEM ---
function setupQueues() {
    supabaseClient.channel('public:conversations')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
            refreshQueues();
        })
        .subscribe();
    
    refreshQueues();
}

async function refreshQueues() {
    // A. Waiting
    const { data: waiting } = await supabaseClient
        .from('conversations')
        .select('*')
        .eq('status', 'queued')
        .order('last_message_at', { ascending: true });
    
    const wList = document.getElementById('queue-waiting');
    wList.innerHTML = '';
    if(waiting) waiting.forEach(doc => renderQueueItem(doc, wList, 'waiting'));

    // B. Active
    const { data: active } = await supabaseClient
        .from('conversations')
        .select('*')
        .eq('assigned_to', currentEmp.id)
        .eq('status', 'active');
    
    const aList = document.getElementById('queue-active');
    aList.innerHTML = '';
    if(active) {
        active.forEach(doc => renderQueueItem(doc, aList, 'active'));
        supabaseClient.from('employees').update({ active_chat_count: active.length }).eq('id', currentEmp.id);
    }
}

function renderQueueItem(d, container, type) {
    const div = document.createElement('div');
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
        const { data: me } = await supabaseClient.from('employees').select('active_chat_count').eq('id', currentEmp.id).single();
        if ((me?.active_chat_count || 0) >= 2) {
            return alert("⛔ LIMIT REACHED: You are handling 2 chats. Please finish one.");
        }
        
        await supabaseClient.from('conversations').update({
            assigned_to: currentEmp.id,
            status: 'active'
        }).eq('id', chatId);
    }

    activeChatId = chatId;
    loadChatUI(chatId);
    loadSecureDetails(chatId);
}

// --- 5. CHAT UI ---
function loadChatUI(chatId) {
    if (currentChatChannel) supabaseClient.removeChannel(currentChatChannel);

    supabaseClient.from('conversations').select('uid_display').eq('id', chatId).single()
        .then(({ data }) => {
            document.getElementById('header-title').innerText = "Chatting with UID: " + (data?.uid_display || '...');
        });

    const msgArea = document.getElementById('msg-area');
    msgArea.innerHTML = '';

    loadHistory(chatId);

    currentChatChannel = supabaseClient.channel(`chat:${chatId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chatId}` }, 
        payload => {
            renderMessage(payload.new);
        })
        .subscribe();
}

async function loadHistory(chatId) {
    const { data: msgs } = await supabaseClient.from('messages')
        .select('*').eq('conversation_id', chatId).order('created_at', { ascending: true });
    
    if(msgs) msgs.forEach(msg => renderMessage(msg));
}

function renderMessage(d) {
    const msgArea = document.getElementById('msg-area');
    const time = new Date(d.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const isMe = d.sender_id === currentEmp.id;
    
    msgArea.innerHTML += `
        <div class="msg-bubble ${isMe ? 'employee' : 'client'}">
            ${d.text || '[Attachment]'}
            <span class="msg-time">${time}</span>
        </div>`;
    msgArea.scrollTop = msgArea.scrollHeight;
}

async function sendEmpMessage() {
    const input = document.getElementById('emp-input');
    const txt = input.value.trim();
    if(!txt || !activeChatId) return;
    
    input.value = '';
    
    await supabaseClient.from('messages').insert([{
        conversation_id: activeChatId,
        sender_id: currentEmp.id,
        text: txt
    }]);

    await supabaseClient.from('conversations').update({ last_message_at: new Date() }).eq('id', activeChatId);
}

async function closeActiveChat() {
    if(!activeChatId) return;
    if(confirm("End this session?")) {
        await supabaseClient.from('conversations').update({ status: 'closed', assigned_to: null }).eq('id', activeChatId);
        activeChatId = null;
        document.getElementById('msg-area').innerHTML = '<div style="text-align:center; color:#94a3b8; margin-top:50px;">Select a client from the queue.</div>';
        document.getElementById('header-title').innerText = 'Select a Chat';
        clearInputs();
    }
}

// --- 6. SECURE RECORDS ---
async function loadSecureDetails(chatId) {
    const { data: conv } = await supabaseClient.from('conversations').select('user_id').eq('id', chatId).single();
    if(!conv) return;

    const { data: rec } = await supabaseClient.from('secure_records').select('*').eq('client_uid', conv.user_id).single();
    
    document.getElementById('inp-passport').value = rec?.passport_number || '';
    document.getElementById('inp-appid').value = rec?.application_id || '';
    document.getElementById('inp-notes').value = rec?.internal_notes || '';
}

function clearInputs() {
    document.getElementById('inp-passport').value = '';
    document.getElementById('inp-appid').value = '';
    document.getElementById('inp-notes').value = '';
}

async function saveSecureDetails() {
    if(!activeChatId) return alert("Select a chat first.");
    
    const { data: conv } = await supabaseClient.from('conversations').select('user_id').eq('id', activeChatId).single();
    if(!conv) return;

    const updates = {
        client_uid: conv.user_id,
        passport_number: document.getElementById('inp-passport').value,
        application_id: document.getElementById('inp-appid').value,
        internal_notes: document.getElementById('inp-notes').value,
        updated_by: currentEmp.name
    };

    const { error } = await supabaseClient.from('secure_records').upsert(updates);
    if(error) console.error("Save Error", error);

    const deadline = document.getElementById('inp-deadline').value;
    if (deadline) {
        await supabaseClient.from('global_tasks').insert([{
            client_uid: conv.user_id,
            note: updates.internal_notes.substring(0, 30),
            deadline: deadline,
            created_by: currentEmp.name
        }]);
        alert("✅ Saved & Added to Deadline Ribbon");
    } else {
        alert("✅ Records Saved");
    }
}

// --- 7. RIBBON & MISSED CALLS ---
function setupRibbon() {
    supabaseClient.channel('ribbon-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'global_tasks' }, () => loadRibbon())
        .subscribe();
    loadRibbon();
}

async function loadRibbon() {
    const { data } = await supabaseClient.from('global_tasks')
        .select('*').eq('status', 'pending').order('deadline', { ascending: true });
        
    const track = document.getElementById('ribbon-track');
    track.innerHTML = '';
    if(data) {
        data.forEach(d => {
            const date = new Date(d.deadline).toLocaleDateString();
            const item = document.createElement('div');
            item.className = 'ribbon-item';
            if(new Date(d.deadline) < new Date()) item.classList.add('urgent');
            item.innerHTML = `<span>UID: ...${d.client_uid.substring(0,4)}</span> | <b>${d.note}</b> | <span>${date}</span>`;
            track.appendChild(item);
        });
    }
}

function setupMissedCalls() {
    supabaseClient.channel('missed-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'missed_calls' }, () => refreshMissed())
        .subscribe();
    refreshMissed();
}

async function refreshMissed() {
    const { data } = await supabaseClient.from('missed_calls').select('*').eq('status', 'unattended');
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
                await supabaseClient.from('missed_calls').update({ status: 'attended' }).eq('id', d.id);
            };
            list.appendChild(div);
        });
    }
}

async function searchClient(query) {
    const { data } = await supabaseClient.from('conversations')
        .select('*').eq('uid_display', query).single();
        
    if(data) {
        pickUpChat(data.id, 'search');
    } else {
        alert("Client not found.");
    }
}
