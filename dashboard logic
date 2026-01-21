// --- INITIALIZATION ---
if (typeof _CONFIG === 'undefined') alert("Error: config.js missing");
const supabase = window.supabase.createClient(_CONFIG.supabaseUrl, _CONFIG.supabaseKey);

let currentEmp = null;
let activeChatId = null;
let chatSubscription = null;

// --- 1. AUTHENTICATION ---
window.addEventListener('load', async () => {
    // Check session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        verifyEmployee(session.user);
    } else {
        document.getElementById('login-screen').style.display = 'flex';
    }
});

async function empLogin() {
    const email = document.getElementById('e-email').value;
    const pass = document.getElementById('e-pass').value;
    
    const { data, error } = await supabase.auth.signInWithPassword({ 
        email: email, 
        password: pass 
    });

    if (error) {
        document.getElementById('login-error').innerText = error.message;
    } else {
        verifyEmployee(data.user);
    }
}

async function verifyEmployee(user) {
    // Check 'employees' table to enforce role
    const { data: emp, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', user.id)
        .single();

    if (emp) {
        currentEmp = emp;
        document.getElementById('login-screen').style.display = 'none';
        initDashboard();
    } else {
        alert("Access Denied: You are not authorized as staff.");
        await supabase.auth.signOut();
    }
}

// --- 2. DASHBOARD INIT ---
function initDashboard() {
    setupQueues();      // Listen to 'conversations'
    setupRibbon();      // Listen to 'global_tasks'
    setupMissedCalls(); // Listen to 'missed_calls'
    
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

// --- 3. QUEUE SYSTEM ---
function setupQueues() {
    // We listen to the entire 'conversations' table for changes
    // In Supabase, we can filter in the listener or just refresh logic on any change
    const channel = supabase.channel('dashboard-queues')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, payload => {
            refreshQueues();
        })
        .subscribe();
        
    refreshQueues(); // Initial load
}

async function refreshQueues() {
    // A. Waiting Queue (Status: 'queued')
    const { data: waiting } = await supabase
        .from('conversations')
        .select('*')
        .eq('status', 'queued')
        .order('last_message_at', { ascending: true });

    renderQueueList(waiting, 'queue-waiting', 'waiting');

    // B. My Active Chats
    const { data: active } = await supabase
        .from('conversations')
        .select('*')
        .eq('assigned_to', currentEmp.id)
        .eq('status', 'active');
        
    renderQueueList(active, 'queue-active', 'active');
    
    // Update my active count in DB
    if(active) {
        supabase.from('employees').update({ active_chat_count: active.length }).eq('id', currentEmp.id);
    }
}

function renderQueueList(data, elemId, type) {
    const list = document.getElementById(elemId);
    list.innerHTML = '';
    if(!data) return;

    data.forEach(chat => {
        const div = document.createElement('div');
        div.className = `queue-item ${activeChatId === chat.id ? 'active' : ''}`;
        div.innerHTML = `
            <div class="q-name">${chat.user_name || 'Guest User'}</div>
            <div class="q-meta">
                <span>UID: ${chat.uid_display || '...'}</span>
                <span class="badge ${type === 'waiting' ? 'new' : ''}">${type.toUpperCase()}</span>
            </div>
        `;
        div.onclick = () => pickUpChat(chat.id, type);
        list.appendChild(div);
    });
}

// --- 4. PICKUP LOGIC ---
async function pickUpChat(chatId, type) {
    if (activeChatId === chatId) return;
    
    if (type === 'waiting') {
        // Check Limit
        const { data: me } = await supabase.from('employees').select('active_chat_count').eq('id', currentEmp.id).single();
        if ((me?.active_chat_count || 0) >= 2) {
            return alert("⛔ LIMIT REACHED: Finish a chat first.");
        }
        
        // Assign to me
        await supabase.from('conversations').update({
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
    document.getElementById('header-title').innerText = "Chatting with UID: " + chatId.substring(0,8);
    const msgArea = document.getElementById('msg-area');
    msgArea.innerHTML = '';

    // Unsubscribe previous listener if exists
    if(chatSubscription) supabase.removeChannel(chatSubscription);

    // Load History First
    loadMessageHistory(chatId);

    // Subscribe to new messages
    chatSubscription = supabase.channel(`chat:${chatId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chatId}` }, 
        payload => {
            renderMessage(payload.new);
        })
        .subscribe();
}

async function loadMessageHistory(chatId) {
    const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', chatId)
        .order('created_at', { ascending: true });
        
    if(msgs) msgs.forEach(msg => renderMessage(msg));
}

function renderMessage(msg) {
    const area = document.getElementById('msg-area');
    const isMe = msg.sender_id === currentEmp.id;
    const time = new Date(msg.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    
    area.innerHTML += `
        <div class="msg-bubble ${isMe ? 'employee' : 'client'}">
            ${msg.text || '[Attachment]'}
            <span class="msg-time">${time}</span>
        </div>`;
    area.scrollTop = area.scrollHeight;
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
    if(confirm("End this session?")) {
        await supabase.from('conversations').update({ status: 'closed', assigned_to: null }).eq('id', activeChatId);
        activeChatId = null;
        document.getElementById('msg-area').innerHTML = '<div style="text-align:center; color:#94a3b8; margin-top:50px;">Select a client from the queue.</div>';
        document.getElementById('header-title').innerText = 'Select a Chat';
        document.getElementById('inp-passport').value = '';
        document.getElementById('inp-appid').value = '';
        document.getElementById('inp-notes').value = '';
    }
}

// --- 6. SECURE DETAILS & RIBBON ---
async function loadSecureDetails(uid) {
    // We need to map Conversation ID -> Client UID first
    const { data: conv } = await supabase.from('conversations').select('user_id').eq('id', uid).single();
    if(!conv) return;

    const { data: record } = await supabase.from('secure_records').select('*').eq('client_uid', conv.user_id).single();
    
    document.getElementById('inp-passport').value = record?.passport_number || '';
    document.getElementById('inp-appid').value = record?.application_id || '';
    document.getElementById('inp-notes').value = record?.notes || '';
}

async function saveSecureDetails() {
    if(!activeChatId) return alert("Select a chat first.");
    
    // Get Client UID again
    const { data: conv } = await supabase.from('conversations').select('user_id').eq('id', activeChatId).single();
    if(!conv) return;

    const updates = {
        client_uid: conv.user_id, // Ensure this is set for upsert
        passport_number: document.getElementById('inp-passport').value,
        application_id: document.getElementById('inp-appid').value,
        notes: document.getElementById('inp-notes').value,
        updated_by: currentEmp.name
    };

    // Upsert (Insert or Update)
    await supabase.from('secure_records').upsert(updates);

    // Handle Ribbon Deadline
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
    supabase.channel('ribbon-updates')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'global_tasks' }, () => loadRibbonItems())
        .subscribe();
    loadRibbonItems();
}

async function loadRibbonItems() {
    const { data } = await supabase.from('global_tasks')
        .select('*')
        .eq('status', 'pending')
        .order('deadline', { ascending: true });
        
    const track = document.getElementById('ribbon-track');
    track.innerHTML = '';
    if(data) {
        data.forEach(task => {
            const item = document.createElement('div');
            item.className = 'ribbon-item';
            if(new Date(task.deadline) < new Date()) item.classList.add('urgent');
            
            // Format deadline nicely
            const dStr = new Date(task.deadline).toLocaleDateString();
            item.innerHTML = `<span>UID: ...${task.client_uid.substring(0,4)}</span> | <b>${task.note}</b> | <span>${dStr}</span>`;
            track.appendChild(item);
        });
    }
}

// --- 7. MISSED CALLS ---
function setupMissedCalls() {
    supabase.channel('missed-calls-update')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'missed_calls' }, () => refreshMissed())
        .subscribe();
    refreshMissed();
}

async function refreshMissed() {
    const { data } = await supabase.from('missed_calls')
        .select('*')
        .eq('status', 'unattended');
        
    const list = document.getElementById('queue-missed');
    list.innerHTML = '';
    
    if(data) {
        data.forEach(call => {
            const div = document.createElement('div');
            div.className = 'queue-item';
            div.innerHTML = `
                <div class="q-name" style="color:var(--danger)">MISSED CALL</div>
                <div class="q-meta">${new Date(call.created_at).toLocaleTimeString()}</div>
            `;
            div.onclick = async () => {
                // Determine Conversation ID from Client ID if possible, or just mark attended
                await supabase.from('missed_calls').update({ status: 'attended' }).eq('id', call.id);
                // In a real app, you'd find the conversation associated with call.client_id here
            };
            list.appendChild(div);
        });
    }
}

async function searchClient(query) {
    // Search conversations by UID Display
    const { data } = await supabase.from('conversations')
        .select('*')
        .ilike('uid_display', `%${query}%`)
        .single();
        
    if(data) {
        pickUpChat(data.id, 'search');
    } else {
        alert("Client not found.");
    }
}
