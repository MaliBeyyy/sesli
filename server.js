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
    transports: ['websocket', 'polling'],
    pingTimeout: 60000, // Ping zaman aşımını artır
    pingInterval: 25000, // Ping aralığını artır
    connectTimeout: 30000, // Bağlantı zaman aşımını artır
    maxHttpBufferSize: 1e8, // Buffer boyutunu artır
    allowEIO3: true, // Socket.IO v3 uyumluluğu
    // Yeniden bağlanma ayarları
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
});

// Bağlantı durumunu izle
io.engine.on("connection_error", (err) => {
    console.error("[Sunucu] Bağlantı hatası:", err.code, err.message);
});

// Her oda için ayrı kullanıcı listesi tutacağız
const rooms = new Map(); // { roomId: { peers: { socketId: { socket, username } } } }

io.on('connection', (socket) => {
    const clientQueryUsername = socket.handshake.query.username;
    const roomId = socket.handshake.query.roomId;
    let processedUsername = clientQueryUsername || 'AnonimKullanici';
    
    console.log(`[Sunucu] Yeni bağlantı: ID=${socket.id}, Oda=${roomId}, Username=${processedUsername}`);

    // Soket bağlantı durumunu izle
    socket.conn.on("packet", (packet) => {
        if (packet.type === "ping") {
            console.log(`[Sunucu] Ping alındı: ${socket.id}`);
        }
    });

    socket.conn.on("error", (error) => {
        console.error(`[Sunucu] Soket hatası (${socket.id}):`, error);
    });

    // Oda yoksa oluştur
    if (!rooms.has(roomId)) {
        rooms.set(roomId, { peers: {} });
    }

    const room = rooms.get(roomId);

    // Yeniden bağlanma durumu için yeni olay dinleyicisi
    socket.on('rejoin-room', (data) => {
        const { roomId, username } = data;
        console.log(`[Sunucu] Kullanıcı yeniden bağlanıyor: ${username} (ID: ${socket.id}, Oda: ${roomId})`);
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, { peers: {} });
        }
        
        const room = rooms.get(roomId);
        
        // Odadaki mevcut kullanıcıları yeniden bağlanan kullanıcıya bildir
        const existingPeersData = Object.entries(room.peers).map(([id, data]) => ({ 
            id, 
            username: data.username 
        }));
        socket.emit('existing-peers', existingPeersData);
        
        // Odadaki diğer kullanıcılara yeniden bağlanan kullanıcıyı bildir
        Object.values(room.peers).forEach(peerData => {
            if (peerData.socket && peerData.socket.id !== socket.id) {
                peerData.socket.emit('peer-joined', { 
                    newPeerId: socket.id, 
                    username: username 
                });
            }
        });
        
        // Kullanıcıyı odaya ekle
        room.peers[socket.id] = { socket: socket, username: username };
        socket.join(roomId);
    });

    // Odadaki mevcut kullanıcıları yeni kullanıcıya bildir
    const existingPeersData = Object.entries(room.peers).map(([id, data]) => ({ 
        id, 
        username: data.username,
        isHost: id === room.host // Host bilgisini ekle
    }));
    socket.emit('existing-peers', existingPeersData);

    // Odadaki diğer kullanıcılara yeni kullanıcıyı bildir
    Object.values(room.peers).forEach(peerData => {
        if (peerData.socket && peerData.socket.id !== socket.id) {
            peerData.socket.emit('peer-joined', { 
                newPeerId: socket.id, 
                username: processedUsername,
                isHost: socket.id === room.host
            });
        }
    });

    // Kullanıcıya host durumunu bildir
    socket.emit('host-status', {
        isHost: socket.id === room.host
    });

    // Kullanıcıyı odaya ekle
    room.peers[socket.id] = { socket: socket, username: processedUsername };
    socket.join(roomId);

    // Kullanıcı atma işlemi
    socket.on('kick-user', (targetId) => {
        if (socket.id === room.host) { // Sadece host kullanıcı atabilir
            const targetSocket = room.peers[targetId]?.socket;
            if (targetSocket) {
                // Atılan kullanıcıya bildir
                targetSocket.emit('kicked-from-room');
                // Diğer kullanıcılara bildir
                socket.to(roomId).emit('user-kicked', {
                    kickedId: targetId,
                    kickedUsername: room.peers[targetId].username
                });
                // Kullanıcıyı odadan çıkar
                targetSocket.disconnect();
            }
        }
    });

    socket.on('offer', (data) => {
        const targetPeerData = room.peers[data.targetId];
        const senderUsername = room.peers[socket.id]?.username || socket.id;
        const targetUsername = targetPeerData?.username || data.targetId;
        
        if (targetPeerData && targetPeerData.socket) {
            console.log(`[Sunucu] Offer iletiliyor: ${senderUsername} -> ${targetUsername} (Oda: ${roomId})`);
            targetPeerData.socket.emit('offer', { 
                sdp: data.sdp, 
                fromId: socket.id, 
                fromUsername: senderUsername 
            });
        }
    });

    socket.on('answer', (data) => {
        const targetPeerData = room.peers[data.targetId];
        const senderUsername = room.peers[socket.id]?.username || socket.id;
        const targetUsername = targetPeerData?.username || data.targetId;
        
        if (targetPeerData && targetPeerData.socket) {
            console.log(`[Sunucu] Answer iletiliyor: ${senderUsername} -> ${targetUsername} (Oda: ${roomId})`);
            targetPeerData.socket.emit('answer', { 
                sdp: data.sdp, 
                fromId: socket.id,
                fromUsername: senderUsername
            });
        }
    });

    socket.on('ice-candidate', (data) => {
        const targetPeerData = room.peers[data.targetId];
        if (targetPeerData && targetPeerData.socket) {
            targetPeerData.socket.emit('ice-candidate', { 
                candidate: data.candidate, 
                fromId: socket.id,
            });
        }
    });

    socket.on('chat message', (msg) => {
        io.to(roomId).emit('chat message', {
            text: msg.text,
            sender: msg.sender || 'Misafir',
            type: msg.type
        });
    });

    socket.on('disconnect', () => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            const disconnectedUser = room.peers[socket.id];
            const disconnectedUsername = disconnectedUser ? disconnectedUser.username : 'Bilinmeyen';
            
            console.log(`[Sunucu] Kullanıcı ayrıldı: ${disconnectedUsername} (ID: ${socket.id}, Oda: ${roomId})`);
            
            // Eğer ayrılan kişi host ise, yeni host seç
            if (socket.id === room.host) {
                // Odadaki diğer kullanıcılardan birini host yap
                const remainingPeers = Object.keys(room.peers).filter(id => id !== socket.id);
                if (remainingPeers.length > 0) {
                    const newHost = remainingPeers[0]; // İlk katılan kişiyi host yap
                    room.host = newHost;
                    // Yeni host'a ve diğer kullanıcılara bildir
                    io.to(roomId).emit('new-host', {
                        hostId: newHost,
                        hostUsername: room.peers[newHost].username
                    });
                }
            }

            delete room.peers[socket.id];
            
            // Odadaki diğer kullanıcılara bildir
            Object.values(room.peers).forEach(peerData => {
                if (peerData.socket) {
                    peerData.socket.emit('peer-left', socket.id);
                }
            });

            // Oda boşsa odayı sil
            if (Object.keys(room.peers).length === 0) {
                rooms.delete(roomId);
                console.log(`[Sunucu] Oda silindi: ${roomId} (boş)`);
            }
        }
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
