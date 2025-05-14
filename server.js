const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Statik dosyaları sunmak için (index.html ve script.js)
// Bu dosyaların projenizin kök dizininde olduğunu varsayıyoruz.
app.use(express.static(path.join(__dirname, '/'))); 

const server = http.createServer(app);

// Socket.IO yapılandırması
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
    // Bağlantı sırasında query'den kullanıcı adını al
    const clientQueryUsername = socket.handshake.query.username;
    let processedUsername = clientQueryUsername;

    if (typeof clientQueryUsername === 'undefined' || clientQueryUsername === null || String(clientQueryUsername).trim() === '') {
        processedUsername = 'AnonimKullanici';
    }

    const roomCode = socket.handshake.query.room;
    if (!roomCode) {
        console.warn(`[Sunucu] Bağlanan socket için roomCode belirtilmemiş. ID=${socket.id}`);
        // İstersen bağlantıyı burada kesebilirsin.
        // socket.disconnect();
        return;
    }
    if (!rooms[roomCode]) rooms[roomCode] = {};

    console.log(`[Sunucu] Yeni bağlantı: ID=${socket.id}. İstemciden gelen query.username='${clientQueryUsername}' (tip: ${typeof clientQueryUsername}). İşlenmiş username='${processedUsername}', room='${roomCode}'`);

    const existingPeersData = Object.entries(rooms[roomCode]).map(([id, data]) => ({ id, username: data.username }));
    socket.emit('existing-peers', existingPeersData);

    socket.to(roomCode).emit('peer-joined', { newPeerId: socket.id, username: processedUsername });

    rooms[roomCode][socket.id] = { socket, username: processedUsername };
    socket.join(roomCode);
    console.log(`[Sunucu] ${processedUsername} (${socket.id}) odaya '${roomCode}' eklendi. Odadaki kullanıcı sayısı: ${Object.keys(rooms[roomCode]).length}`);

    socket.on('offer', (data) => {
        const targetPeerData = rooms[roomCode][data.targetId];
        const senderUsername = rooms[roomCode][socket.id]?.username || socket.id;
        const targetUsername = targetPeerData?.username || data.targetId;
        if (targetPeerData && targetPeerData.socket) {
            console.log(`[Sunucu] Offer iletiliyor: ${senderUsername} -> ${targetUsername}`);
            targetPeerData.socket.emit('offer', { 
                sdp: data.sdp, 
                fromId: socket.id, 
                fromUsername: senderUsername 
            });
        } else {
            console.warn(`[Sunucu] Offer için hedef (${targetUsername}) bulunamadı. Gönderen: ${senderUsername}`);
        }
    });

    socket.on('answer', (data) => {
        const targetPeerData = rooms[roomCode][data.targetId];
        const senderUsername = rooms[roomCode][socket.id]?.username || socket.id;
        const targetUsername = targetPeerData?.username || data.targetId;
        if (targetPeerData && targetPeerData.socket) {
            console.log(`[Sunucu] Answer iletiliyor: ${senderUsername} -> ${targetUsername}`);
            targetPeerData.socket.emit('answer', { 
                sdp: data.sdp, 
                fromId: socket.id,
                fromUsername: senderUsername
            });
        } else {
            console.warn(`[Sunucu] Answer için hedef (${targetUsername}) bulunamadı. Gönderen: ${senderUsername}`);
        }
    });

    socket.on('ice-candidate', (data) => {
        const targetPeerData = rooms[roomCode][data.targetId];
        if (targetPeerData && targetPeerData.socket) {
            targetPeerData.socket.emit('ice-candidate', { 
                candidate: data.candidate, 
                fromId: socket.id,
            });
        }
    });

    socket.on('leave-room', ({ room }) => {
      if (rooms[room] && rooms[room][socket.id]) {
        delete rooms[room][socket.id];
        socket.leave(room);
        socket.to(room).emit('peer-left', socket.id);
        if (Object.keys(rooms[room]).length === 0) {
          delete rooms[room];
        }
        console.log(`[Sunucu] ${processedUsername} (${socket.id}) '${room}' odasından ayrıldı.`);
      }
    });

    socket.on('disconnect', () => {
        const disconnectedUser = rooms[roomCode] ? rooms[roomCode][socket.id] : null;
        const disconnectedUsername = disconnectedUser ? disconnectedUser.username : 'Bilinmeyen';
        console.log(`[Sunucu] Kullanıcı ayrıldı: ${disconnectedUsername} (ID: ${socket.id})`);

        if (rooms[roomCode] && rooms[roomCode][socket.id]) {
            delete rooms[roomCode][socket.id];
            socket.to(roomCode).emit('peer-left', socket.id);
            if (Object.keys(rooms[roomCode]).length === 0) {
                delete rooms[roomCode];
            }
            console.log(`[Sunucu] ${disconnectedUsername} (${socket.id}) '${roomCode}' odasından çıkarıldı. Kalan kullanıcı sayısı: ${rooms[roomCode] ? Object.keys(rooms[roomCode]).length : 0}`);
            if (rooms[roomCode] && Object.keys(rooms[roomCode]).length > 0) {
                console.log(`[Sunucu] Kalan kullanıcılara ${disconnectedUsername} (${socket.id}) kullanıcısının ayrıldığı bildirildi.`);
            }
        }
    });

    // Sohbet sistemi için Socket.IO olayları
    socket.on('chat message', (msg) => {
        console.log('Mesaj alındı:', msg);
        // Mesajı odadaki diğer kullanıcılara ilet
        socket.to(roomCode).emit('chat message', {
            text: msg.text,
            sender: msg.sender || 'Misafir'
        });
    });
});

// Dinamik port veya varsayılan 3000
const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => {
    console.log(`Sinyalleşme sunucusu ${PORT} portunda çalışıyor...`);
});

// server.js dosyasının uygun bir yerine (diğer app.use'lardan sonra, server.listen'den önce)
app.get('/ping', (req, res) => {
    res.send('pong');
});
