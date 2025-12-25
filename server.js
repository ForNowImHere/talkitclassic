// =====================
// ClassTalk Full Server (All-in-One, JSON-Persisted)
// =====================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SECRET = 'supersecret123';
const USERS_FILE = path.join(__dirname,'users.json');

app.use(express.json());
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, 'public')));

// =====================
// Load/Save Users
// =====================
let users = {};
if(fs.existsSync(USERS_FILE)){
    try { 
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        const parsed = JSON.parse(raw, (key, value)=>{
            if(key==='socketIds') return new Set(value);
            return value;
        });
        users = parsed;
    } catch(e){ users={}; }
}

function saveUsers(){
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, (key,value)=>{
            if(value instanceof Set) return Array.from(value);
            return value;
        }, 2));
    } catch(e){ console.error('Failed to save users:', e); }
}

// Auto-save every 10 seconds
setInterval(saveUsers, 10000);
function saveUsersAsync(){ setImmediate(saveUsers); }

// =====================
// Helpers
// =====================
function generateToken(username){ return jwt.sign({username}, SECRET); }
function getUserFromToken(token){ try{ return jwt.verify(token, SECRET).username; }catch(e){ return null; } }
function calculateStatus(user, sessionId){
    if(!user) return 'offline';
    if(user.dynamic){
        const activeSessions = Object.keys(user.sessions||{}).length;
        if(activeSessions===0) return 'offline';
        if(!user.sessions[sessionId]?.activeTab) return 'idle';
        return 'online';
    } else return user.manualStatus || 'online';
}

// Allow iframe embedding
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "ALLOWALL"); // allow iframe
  res.setHeader("Content-Security-Policy", "frame-ancestors *"); // allow any parent
  next();
});
// =====================
// HTML Pages
// =====================
const homeHTML = `
<style>
body { display:flex; justify-content:center; align-items:center; height:100vh; background:#f2f2f2; font-family:Arial,sans-serif; }
.container { text-align:center; background:#fff; padding:40px; border-radius:15px; box-shadow:0 0 25px rgba(0,0,0,0.2); }
a { display:inline-block; margin:10px; font-weight:bold; color:#007bff; text-decoration:none; }
a:hover { text-decoration:underline; }
h1 { margin-bottom:20px; }
</style>
<div class="container">
<h1>Welcome to ClassTalk</h1>
<a href="/signup">Signup</a> | <a href="/login">Login</a>
</div>
`;

const signupHTML = `
<style>
body { display:flex; justify-content:center; align-items:center; height:100vh; background:#f2f2f2; font-family:Arial,sans-serif; }
.container { background:#fff; padding:30px; border-radius:15px; box-shadow:0 0 20px rgba(0,0,0,0.2); width:350px; text-align:center; }
input { margin:10px 0; padding:10px; width:80%; border-radius:5px; border:1px solid #ccc; }
button { padding:10px 20px; margin-top:10px; border:none; border-radius:5px; background:#007bff; color:#fff; cursor:pointer; }
button:hover { background:#0056b3; }
#status { margin-top:10px; color:red; font-weight:bold; }
</style>

<div class="container">
<h2>Signup</h2>
<input id="avatar" placeholder="Avatar URL"/><br/>
<input id="user" placeholder="Username"/><br/>
<input id="pass" type="password" placeholder="Password"/><br/>
<input id="display" placeholder="Display Name"/><br/>
<button onclick="signup()">Signup</button>
<p id="status"></p>
</div>

<script>
async function signup(){
    const res = await fetch('/signup',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            username:document.getElementById('user').value,
            password:document.getElementById('pass').value,
            displayName:document.getElementById('display').value,
            avatar:document.getElementById('avatar').value
        })
    });
    const text = await res.text();
    document.getElementById('status').textContent = text;
    if(text==='OK'){ location.href='/friends'; }
}
</script>
`;

const loginHTML = `
<style>
body { display:flex; justify-content:center; align-items:center; height:100vh; background:#f2f2f2; font-family:Arial,sans-serif; }
.container { background:#fff; padding:30px; border-radius:15px; box-shadow:0 0 20px rgba(0,0,0,0.2); width:350px; text-align:center; }
input { margin:10px 0; padding:10px; width:80%; border-radius:5px; border:1px solid #ccc; }
button { padding:10px 20px; margin-top:10px; border:none; border-radius:5px; background:#007bff; color:#fff; cursor:pointer; }
button:hover { background:#0056b3; }
#status { margin-top:10px; color:red; font-weight:bold; }
</style>

<div class="container">
<h2>Login</h2>
<input id="user" placeholder="Username"/><br/>
<input id="pass" type="password" placeholder="Password"/><br/>
<button onclick="login()">Login</button>
<p id="status"></p>
</div>

<script>
async function login(){
    const res = await fetch('/login',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            username:document.getElementById('user').value,
            password:document.getElementById('pass').value
        })
    });
    const text = await res.text();
    document.getElementById('status').textContent = text;
    if(text==='OK'){ location.href='/friends'; }
}
</script>
`;

// =====================
// Friends Page Generator
// =====================
function friendsHTML(username){
    const user = users[username];
    const friendsList = (user.friends||[]).map(f=>{
        const fUser = users[f];
        if(!fUser) return '';
        const sessionId = Object.keys(fUser.sessions||{})[0] || '';
        const status = calculateStatus(fUser, sessionId);
        return `
        <div class="friend-item">
            <img src="${fUser.avatar||'/public/default.png'}" width="40" height="40" style="border-radius:50%; margin-right:10px;"/>
            <span>${fUser.displayName} (${f}) - <span class="status">${status}</span></span>
            <button onclick="callFriend('${f}')">Call</button>
            <button onclick="openChat('${f}')">Chat</button>
        </div>`;
    }).join('') || '<i>No friends yet</i>';

    const requestsList = (user.friendRequests||[]).map(f=>{
        const fUser = users[f];
        return `
        <div class="request-item">
            ${(fUser?.displayName||f)} (${f})
            <button onclick="respondRequest('${f}',true)">✅</button>
            <button onclick="respondRequest('${f}',false)">❌</button>
        </div>`;
    }).join('') || '<i>No requests</i>';

    return `
<style>
body { font-family: Arial,sans-serif; background:#f2f2f2; display:flex; justify-content:center; }
.container { width:550px; margin-top:30px; background:#fff; padding:20px; border-radius:10px; box-shadow:0 0 15px rgba(0,0,0,0.2); }
h2,h3 { text-align:center; }
.friend-item, .request-item { display:flex; align-items:center; justify-content:space-between; margin:5px 0; padding:5px 10px; background:#eaeaea; border-radius:5px; }
button { cursor:pointer; margin-left:5px; }
.status { font-weight:bold; margin-left:5px; }
#incomingCall { display:none; color:red; text-align:center; font-weight:bold; margin-top:20px; }
#chatBox { display:none; margin-top:10px; border:1px solid #ccc; padding:5px; height:200px; overflow-y:auto; background:#fafafa; }
#chatInput { width:75%; padding:5px; }
.settings-row { margin:5px 0; }
</style>

<div class="container">
<h2>Welcome <img src="${user.avatar||'/public/default.png'}" width="50" height="50" style="border-radius:50%;"/> ${user.displayName} (${username})</h2>
<button onclick="showSettings()">Settings</button>

<h3>Friend Requests</h3>
<div id="requests">${requestsList}</div>

<h3>Friends</h3>
<div id="friendList">${friendsList}</div>

<h3>Add Friend</h3>
<input id="friendInput" placeholder="Username"/><button onclick="addFriend()">Add</button>

<div id="incomingCall">Incoming Call! <button onclick="dismissCall()">Dismiss</button></div>

<div id="chatBox"></div>
<input id="chatInput" placeholder="Type message"/><button onclick="sendMessage()">Send</button>

<div id="settings" style="display:none;">
<h3>Settings</h3>
<div class="settings-row">
<label>Display Name:</label><input id="displayName" value="${user.displayName}"/>
</div>
<div class="settings-row">
<label>Username:</label><input id="username" value="${username}"/>
</div>
<div class="settings-row">
<label>Password:</label><input id="password" type="password"/>
</div>
<div class="settings-row">
<label>Avatar URL:</label><input id="avatarURL" value="${user.avatar||''}"/>
</div>
<div class="settings-row">
<label>Status Mode:</label>
<select id="statusMode">
  <option value="online" ${user.manualStatus==='online'?'selected':''}>Online</option>
  <option value="idle" ${user.manualStatus==='idle'?'selected':''}>Idle</option>
  <option value="dnd" ${user.manualStatus==='dnd'?'selected':''}>Do Not Disturb</option>
  <option value="invisible" ${user.manualStatus==='invisible'?'selected':''}>Invisible</option>
</select>
<input type="checkbox" id="dynamic" ${user.dynamic?'checked':''}/> Dynamic
</div>
<button onclick="saveSettings()">Save</button>
<button onclick="deleteAccount()">Delete Account</button>
<button onclick="deactivateAccount()">Deactivate Account</button>
</div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
socket.emit('register','${username}');
let currentChat = null;
let windowFocused = true;
window.onfocus = ()=>{ windowFocused=true; };
window.onblur = ()=>{ windowFocused=false; };

function openChat(f){ currentChat=f; document.getElementById('chatBox').style.display='block'; loadMessages(); }
async function loadMessages(){
    if(!currentChat) return;
    const res = await fetch('/get-messages',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({friend:currentChat})});
    const data = await res.json();
    const box = document.getElementById('chatBox');
    box.innerHTML = data.map(m=>'<div><b>'+m.from+':</b> '+m.text+'</div>').join('');
    box.scrollTop = box.scrollHeight;
}
async function sendMessage(){
    const text = document.getElementById('chatInput').value;
    if(!currentChat || !text) return;
    document.getElementById('chatInput').value='';
    await fetch('/send-message',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({to:currentChat,text})});
    loadMessages();
}
socket.on('message', data=>{
    if(data.to==='${username}'){
        if(!windowFocused && !data.text.startsWith('📞')) new Audio('/public/text.wav').play();
        if(currentChat===data.from) loadMessages();
    }
});

function callFriend(f){ 
    const code = Math.random().toString(36).substring(2,11);
    const url = '/room/' + code;
    socket.emit('call-friend',{to:f, from:'${username}', link:url});
    fetch('/send-message',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({to:f, text:'📞 '+username+' is calling you! Join here: '+url})});
}
socket.on('incoming-call', data=>{
    if(data.status==='dnd'||data.status==='offline'||data.status==='invisible') return;
    const div = document.getElementById('incomingCall');
    div.style.display='block';
    setTimeout(()=>{ div.style.display='none'; },30000);
});
function dismissCall(){ document.getElementById('incomingCall').style.display='none'; }

async function addFriend(){
    const f = document.getElementById('friendInput').value;
    const res = await fetch('/add-friend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({friend:f})});
    alert(await res.text());
    location.reload();
}
async function respondRequest(f,accept){
    const res = await fetch('/respond-friend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({friend:f,accept})});
    alert(await res.text());
    location.reload();
}

function showSettings(){ document.getElementById('settings').style.display='block'; }
async function saveSettings(){
    const newDisplay = document.getElementById('displayName').value;
    const newUser = document.getElementById('username').value;
    const newPass = document.getElementById('password').value;
    const avatar = document.getElementById('avatarURL').value;
    const dynamic = document.getElementById('dynamic').checked;
    const status = document.getElementById('statusMode').value;
    const res = await fetch('/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:newDisplay,username:newUser,password:newPass,dynamic,status,avatar})});
    alert(await res.text());
    location.reload();
}
async function deleteAccount(){ await fetch('/delete',{method:'POST'}); alert('Deleted'); location.href='/'; }
async function deactivateAccount(){ await fetch('/deactivate',{method:'POST'}); alert('Deactivated'); location.href='/'; }

document.addEventListener('visibilitychange',()=>{ socket.emit('tab-active',{active:!document.hidden}); });
</script>
`;
}

// =====================
// Routes
// =====================
app.get('/', (req,res)=>res.send(homeHTML));
app.get('/signup', (req,res)=>res.send(signupHTML));
app.get('/login', (req,res)=>res.send(loginHTML));
app.get('/friends', (req,res)=>{
    const username = getUserFromToken(req.cookies.token);
    if(!username) return res.redirect('/login');
    res.send(friendsHTML(username));
});
// =====================
// Auth
// =====================
// =====================
// Signup Route
// =====================
app.post('/signup', async (req, res) => {
    const { username, password, displayName, avatar } = req.body;
    if (users[username]) return res.status(400).send('User exists');
    const hash = await bcrypt.hash(password, 10);
    users[username] = {
        passwordHash: hash,
        displayName,
        friends: [],
        friendRequests: [],
        sessions: {},
        dynamic: true,
        manualStatus: 'online',
        socketIds: new Set(),
        messages: {},
        avatar
    };
    // Cross-site iframe friendly cookie
    res.cookie('token', generateToken(username), {
        httpOnly: true,
        sameSite: 'None',  // allow cross-site
        secure: true       // HTTPS required
    });
    res.send('OK');
});

// =====================
// Login Route
// =====================
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users[username];
    if (!user) return res.status(400).send('No such user');
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(400).send('Wrong password');
    // Cross-site iframe friendly cookie
    res.cookie('token', generateToken(username), {
        httpOnly: true,
        sameSite: 'None',  // allow cross-site
        secure: true       // HTTPS required
    });
    res.send('OK');
});

// =====================
// Friend Actions
// =====================
app.post('/add-friend',(req,res)=>{
    const username = getUserFromToken(req.cookies.token);
    if(!username) return res.status(401).send('Not logged in');
    const { friend } = req.body;
    if(!users[friend]) return res.status(400).send('No such user');
    const user = users[username];

    if(users[friend].friendRequests.includes(username)){
        users[friend].friendRequests = users[friend].friendRequests.filter(u=>u!==username);
        if(!user.friends.includes(friend)) user.friends.push(friend);
        if(!users[friend].friends.includes(username)) users[friend].friends.push(username);
        return res.send('Mutual request! You are now friends.');
    }

    if(user.friends.includes(friend)) return res.send('Already friends');
    if(users[friend].friendRequests.includes(username)) return res.send('Request already sent');
    users[friend].friendRequests.push(username);
    res.send('Friend request sent');
});

app.post('/respond-friend', (req,res)=>{
    const username = getUserFromToken(req.cookies.token);
    if(!username) return res.status(401).send('Not logged in');
    const { friend, accept } = req.body;
    const user = users[username];
    if(!user.friendRequests.includes(friend)) return res.status(400).send('No such request');

    if(accept){
        if(users[friend]?.friendRequests?.includes(username)){
            users[friend].friendRequests = users[friend].friendRequests.filter(u=>u!==username);
        }
        if(!user.friends.includes(friend)) user.friends.push(friend);
        if(users[friend] && !users[friend].friends.includes(username)) users[friend].friends.push(username);
    }
    user.friendRequests = user.friendRequests.filter(u=>u!==friend);
    res.send(accept?'Accepted':'Rejected');
});

// =====================
// Settings
// =====================
app.post('/settings',(req,res)=>{
    const username = getUserFromToken(req.cookies.token);
    if(!username) return res.status(401).send('Not logged in');
    const user = users[username];
    const { displayName, username:newUser, password, dynamic, status, avatar } = req.body;
    if(displayName) user.displayName = displayName;
    if(avatar) user.avatar = avatar;
    if(newUser && newUser!==username){
        if(users[newUser]) return res.status(400).send('Username taken');
        users[newUser] = user;
        delete users[username];
        res.cookie('token', generateToken(newUser), { httpOnly:true });
    }
    if(password) bcrypt.hash(password,10).then(h=>{ user.passwordHash = h; });
    user.dynamic = !!dynamic;
    user.manualStatus = status || user.manualStatus;
    res.send('Settings saved');
});

app.post('/delete',(req,res)=>{
    const username = getUserFromToken(req.cookies.token);
    if(!username) return res.status(401).send('Not logged in');
    Object.values(users).forEach(u=>{
        u.friends = (u.friends||[]).filter(f=>f!==username);
        u.friendRequests = (u.friendRequests||[]).filter(f=>f!==username);
    });
    delete users[username];
    res.clearCookie('token');
    res.send('Deleted');
});

app.post('/deactivate',(req,res)=>{
    const username = getUserFromToken(req.cookies.token);
    if(!username) return res.status(401).send('Not logged in');
    users[username].manualStatus = 'offline';
    res.send('Deactivated');
});

// =====================
// Chat
// =====================
app.post('/send-message', (req,res)=>{
    const from = getUserFromToken(req.cookies.token);
    if(!from) return res.status(401).send('Not logged in');
    const { to, text } = req.body;
    if(!users[to]) return res.status(400).send('No such user');
    users[from].messages[to] = users[from].messages[to] || [];
    users[to].messages[from] = users[to].messages[from] || [];
    const msg = { from,to,text,time:Date.now() };
    users[from].messages[to].push(msg);
    users[to].messages[from].push(msg);
    users[to].socketIds.forEach(id=> io.to(id).emit('message', msg));
    res.send('OK');
});

app.post('/get-messages', (req,res)=>{
    const from = getUserFromToken(req.cookies.token);
    if(!from) return res.status(401).send('Not logged in');
    const { friend } = req.body;
    res.json(users[from].messages[friend] || []);
});

// =====================
// Socket.io
// =====================
io.on('connection', socket=>{
    socket.on('register', username=>{
        const user = users[username];
        if(!user) return;
        user.socketIds.add(socket.id);
        user.sessions[socket.id] = { activeTab:true };
        saveUsersAsync();
    });

    socket.on('tab-active', ({active})=>{
        const user = Object.values(users).find(u=>u.sessions[socket.id]);
        if(user) user.sessions[socket.id].activeTab = active;
        saveUsersAsync();
    });

    socket.on('call-friend', ({to, from, link})=>{
        const friend = users[to];
        if(!friend) return;
        const status = calculateStatus(friend, Object.keys(friend.sessions)[0] || '');
        friend.socketIds.forEach(id=>{
            io.to(id).emit('incoming-call',{from, link, status});
        });
    });

    socket.on('disconnect', ()=>{
        Object.values(users).forEach(user=>{
            if(user.sessions[socket.id]){
                delete user.sessions[socket.id];
                user.socketIds.delete(socket.id);
                saveUsersAsync();
            }
        });
    });
});

// =====================
// Start Server
// =====================
server.listen(5000, ()=>console.log('ClassTalk running at http://localhost:5000'));