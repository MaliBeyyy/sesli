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

let roomPeers = {}; // Odadaki kullanıcıları socket.id'leri ile saklayacağız: { socketId: socketNesnesi }

io.on('connection', (socket) => {
    // Bağlantı sırasında query'den kullanıcı adını al
    const clientQueryUsername = socket.handshake.query.username;
    let processedUsername = clientQueryUsername;

    if (typeof clientQueryUsername === 'undefined' || clientQueryUsername === null || String(clientQueryUsername).trim() === '') {
        processedUsername = 'AnonimKullanici';
    }
    
    console.log(`[Sunucu] Yeni bağlantı: ID=${socket.id}. İstemciden gelen query.username='${clientQueryUsername}' (tip: ${typeof clientQueryUsername}). İşlenmiş username='${processedUsername}'`);

    // --- existing-peers için loglama (önceki gibi kalabilir veya basitleştirilebilir) ---
    // console.log('[Sunucu] "existing-peers" için roomPeers durumu:', JSON.stringify(roomPeers, (key, value) => (key === 'socket' ? '[SocketObject]' : value), 2));
    const existingPeersData = Object.entries(roomPeers).map(([id, data]) => ({ id, username: data.username }));
    // console.log(`[Sunucu] "existing-peers" olayı ile ${socket.id} (${processedUsername}) kullanıcısına gönderilecek veri:`, JSON.stringify(existingPeersData, null, 2));
    socket.emit('existing-peers', existingPeersData);
    // --- existing-peers loglama sonu ---


    // Odadaki mevcut diğer kullanıcılara yeni katılan kullanıcının ID'sini ve kullanıcı adını bildir
    Object.values(roomPeers).forEach(existingPeerData => {
        if (existingPeerData.socket && existingPeerData.socket.id !== socket.id) { // Kendisine göndermesin
            const eventDataForPeerJoined = { newPeerId: socket.id, username: processedUsername };
            console.log(`[Sunucu] 'peer-joined' olayı ${existingPeerData.username} (${existingPeerData.socket.id}) kullanıcısına gönderiliyor. Veri: ${JSON.stringify(eventDataForPeerJoined)}`);
            existingPeerData.socket.emit('peer-joined', eventDataForPeerJoined);
        }
    });
    if (Object.keys(roomPeers).length > 0) {
      console.log(`[Sunucu] Mevcut kullanıcılara yeni kullanıcı ${processedUsername} (${socket.id}) bilgisi (peer-joined yoluyla) gönderildi.`);
    }

    // Yeni kullanıcıyı odaya ekle
    roomPeers[socket.id] = { socket: socket, username: processedUsername };
    console.log(`[Sunucu] ${processedUsername} (${socket.id}) odaya eklendi. Odadaki kullanıcı sayısı: ${Object.keys(roomPeers).length}`);


    socket.on('offer', (data) => {
        const targetPeerData = roomPeers[data.targetId];
        const senderUsername = roomPeers[socket.id]?.username || socket.id; // veya processedUsername (eğer bu socket içinse)
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
        const targetPeerData = roomPeers[data.targetId];
        const senderUsername = roomPeers[socket.id]?.username || socket.id;
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
        const targetPeerData = roomPeers[data.targetId];
        if (targetPeerData && targetPeerData.socket) {
            targetPeerData.socket.emit('ice-candidate', { 
                candidate: data.candidate, 
                fromId: socket.id,
            });
        }
    });

    socket.on('disconnect', () => {
        const disconnectedUser = roomPeers[socket.id];
        const disconnectedUsername = disconnectedUser ? disconnectedUser.username : 'Bilinmeyen';
        console.log(`[Sunucu] Kullanıcı ayrıldı: ${disconnectedUsername} (ID: ${socket.id})`);
        
        const wasInRoom = !!roomPeers[socket.id];
        delete roomPeers[socket.id]; 
        
        if (wasInRoom) { 
            console.log(`[Sunucu] ${disconnectedUsername} (${socket.id}) odadan çıkarıldı. Kalan kullanıcı sayısı: ${Object.keys(roomPeers).length}`);
            Object.values(roomPeers).forEach(peerData => {
                if (peerData.socket) {
                    peerData.socket.emit('peer-left', socket.id);
                }
            });
            if (Object.keys(roomPeers).length > 0) {
                console.log(`[Sunucu] Kalan kullanıcılara ${disconnectedUsername} (${socket.id}) kullanıcısının ayrıldığı bildirildi.`);
            }
        }
    });

    // Sohbet sistemi için Socket.IO olayları
    socket.on('chat message', (msg) => {
        console.log('Mesaj alındı:', msg);
        // Mesajı tüm bağlı kullanıcılara ilet
        io.emit('chat message', {
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
