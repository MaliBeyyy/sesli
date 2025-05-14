const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.use(express.static(path.join(__dirname, '/')));

const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["*"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

let rooms = {}; // { roomCode: { socketId: { socket, username } } }

io.on('connection', (socket) => {
    const rawUsername = socket.handshake.query.username;
    const roomCode = socket.handshake.query.room;
    const processedUsername = rawUsername && rawUsername.trim() !== '' ? rawUsername.trim() : 'AnonimKullanici';

    if (!roomCode) {
        console.warn(`[Sunucu] room parametresi eksik: ID=${socket.id}`);
        socket.disconnect();
        return;
    }

    if (!rooms[roomCode]) {
        rooms[roomCode] = {};
    }

    // Odaya katıl
    socket.join(roomCode);
    rooms[roomCode][socket.id] = { socket, username: processedUsername };

    console.log(`[Sunucu] Kullanıcı bağlandı: ${processedUsername} (${socket.id}) - Oda: ${roomCode}`);

    // Yeni kullanıcıya mevcut katılımcı listesini gönder
    const existingPeers = Object.entries(rooms[roomCode])
        .filter(([id]) => id !== socket.id)
        .map(([id, data]) => ({ id, username: data.username }));
    socket.emit('existing-peers', existingPeers);

    // Diğer kullanıcılara bu kişinin katıldığını bildir
    socket.to(roomCode).emit('peer-joined', {
        newPeerId: socket.id,
        username: processedUsername
    });

    // Teklif (offer) iletimi
    socket.on('offer', (data) => {
        const target = rooms[roomCode]?.[data.targetId];
        if (target) {
            target.socket.emit('offer', {
                sdp: data.sdp,
                fromId: socket.id,
                fromUsername: processedUsername
            });
        }
    });

    // Yanıt (answer) iletimi
    socket.on('answer', (data) => {
        const target = rooms[roomCode]?.[data.targetId];
        if (target) {
            target.socket.emit('answer', {
                sdp: data.sdp,
                fromId: socket.id,
                fromUsername: processedUsername
            });
        }
    });

    // ICE Candidate iletimi
    socket.on('ice-candidate', (data) => {
        const target = rooms[roomCode]?.[data.targetId];
        if (target) {
            target.socket.emit('ice-candidate', {
                candidate: data.candidate,
                fromId: socket.id
            });
        }
    });

    // Odadan ayrılma isteği
    socket.on('leave-room', ({ room }) => {
        if (rooms[room] && rooms[room][socket.id]) {
            delete rooms[room][socket.id];
            socket.leave(room);
            socket.to(room).emit('peer-left', socket.id);
            console.log(`[Sunucu] ${processedUsername} (${socket.id}) odadan ayrıldı: ${room}`);
            if (Object.keys(rooms[room]).length === 0) {
                delete rooms[room];
            }
        }
    });

    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        if (rooms[roomCode] && rooms[roomCode][socket.id]) {
            delete rooms[roomCode][socket.id];
            socket.to(roomCode).emit('peer-left', socket.id);
            console.log(`[Sunucu] ${processedUsername} (${socket.id}) bağlantıyı kapattı ve odadan çıkarıldı: ${roomCode}`);
            if (Object.keys(rooms[roomCode]).length === 0) {
                delete rooms[roomCode];
            }
        }
    });

    // Mesajlaşma
    socket.on('chat message', (msg) => {
        socket.to(roomCode).emit('chat message', {
            text: msg.text,
            sender: msg.sender || 'Misafir'
        });
    });
});

// Test endpoint
app.get('/ping', (req, res) => {
    res.send('pong');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});