const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();

// Statik dosyaları sunmak için (index.html ve script.js)
// Bu dosyaların projenizin kök dizininde olduğunu varsayıyoruz.
app.use(express.static(path.join(__dirname, '/'))); 

const server = http.createServer(app);

// CORS ayarını Render'daki canlı URL'nizi de içerecek şekilde güncelleyebilirsiniz.
// İlk dağıtımdan sonra canlı URL'nizi buraya eklersiniz.
// Şimdilik "*" veya geliştirme URL'leriniz kalabilir.
const io = socketIO(server, {
  cors: {
    // origin: ["http://localhost:3000", "http://127.0.0.1:5500", "http://localhost:5500", "ONRENDER_APP_URL_BURAYA_GELECEK"],
    origin: "*", // Başlangıç için "*" kullanabilirsiniz, daha sonra kısıtlayın.
    methods: ["GET", "POST"]
  }
});

const MAX_PEERS_IN_ROOM = 3;
let roomPeers = {}; // Odadaki kullanıcıları socket.id'leri ile saklayacağız: { socketId: socketNesnesi }

io.on('connection', (socket) => {
    // Bağlantı sırasında query'den kullanıcı adını al
    const clientQueryUsername = socket.handshake.query.username;
    let processedUsername = clientQueryUsername;

    if (typeof clientQueryUsername === 'undefined' || clientQueryUsername === null || String(clientQueryUsername).trim() === '') {
        processedUsername = 'AnonimKullanici'; // Daha belirgin bir varsayılan isim
    }
    
    console.log(`[Sunucu] Yeni bağlantı: ID=${socket.id}. İstemciden gelen query.username='${clientQueryUsername}' (tip: ${typeof clientQueryUsername}). İşlenmiş username='${processedUsername}'`);

    if (Object.keys(roomPeers).length >= MAX_PEERS_IN_ROOM) {
        console.log(`[Sunucu] Oda dolu. Yeni kullanıcı ${processedUsername} (${socket.id}) reddedildi.`);
        socket.emit('room-full');
        socket.disconnect(true);
        return;
    }

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
});

// Dinamik port veya varsayılan 3000
const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => {
    console.log(`Sinyalleşme sunucusu ${PORT} portunda çalışıyor (${MAX_PEERS_IN_ROOM} kişilik odalar)...`);
});

// server.js dosyasının uygun bir yerine (diğer app.use'lardan sonra, server.listen'den önce)
app.get('/ping', (req, res) => {
    res.send('pong');
});
