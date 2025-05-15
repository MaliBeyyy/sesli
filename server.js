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
    pingTimeout: 60000, // 60 saniye ping timeout
    pingInterval: 25000, // 25 saniye ping aralığı
    connectTimeout: 45000, // 45 saniye bağlantı timeout
    maxHttpBufferSize: 1e8 // 100 MB
});

// Her odadaki kullanıcıları tutacak nesne
const rooms = {}; // { roomId: { peers: { socketId: { socket, username } } } }

io.on('connection', (socket) => {
    const clientQueryUsername = socket.handshake.query.username;
    const roomId = socket.handshake.query.room; // roomId yerine room olarak değiştirildi

    if (!roomId) {
        console.error(`[Sunucu] room parametresi eksik: ID=${socket.id}`);
        socket.emit('error', { message: 'Oda bilgisi eksik' });
        socket.disconnect();
        return;
    }

    let processedUsername = clientQueryUsername || 'AnonimKullanici';
    
    console.log(`[Sunucu] Yeni bağlantı: ID=${socket.id}, Oda=${roomId}, Username=${processedUsername}`);

    // Bağlantı durumunu izle
    socket.conn.on('packet', (packet) => {
        if (packet.type === 'ping') console.log(`[Sunucu] Ping alındı: ${socket.id}`);
        if (packet.type === 'pong') console.log(`[Sunucu] Pong alındı: ${socket.id}`);
    });

    socket.conn.on('error', (error) => {
        console.error(`[Sunucu] Bağlantı hatası (${socket.id}):`, error);
    });

    // Oda yoksa oluştur
    if (!rooms[roomId]) {
        rooms[roomId] = { peers: {} };
        console.log(`[Sunucu] Yeni oda oluşturuldu: ${roomId}`);
    }

    try {
        // Odadaki mevcut kullanıcıları yeni kullanıcıya gönder
        const existingPeersData = Object.entries(rooms[roomId].peers).map(([id, data]) => ({
            id,
            username: data.username
        }));

        console.log(`[Sunucu] ${roomId} odasındaki mevcut kullanıcılar:`, existingPeersData);
        socket.emit('existing-peers', existingPeersData);

        // Odadaki diğer kullanıcılara yeni kullanıcıyı bildir
        socket.to(roomId).emit('peer-joined', {
            newPeerId: socket.id,
            username: processedUsername
        });

        // Kullanıcıyı odaya ekle
        socket.join(roomId);
        rooms[roomId].peers[socket.id] = { socket, username: processedUsername };
        console.log(`[Sunucu] ${processedUsername} (${socket.id}) ${roomId} odasına eklendi. Odadaki toplam kullanıcı: ${Object.keys(rooms[roomId].peers).length}`);
    } catch (error) {
        console.error(`[Sunucu] Kullanıcı odaya eklenirken hata:`, error);
        socket.emit('error', { message: 'Odaya katılırken bir hata oluştu' });
    }

    socket.on('offer', (data) => {
        const targetPeerData = rooms[roomId]?.peers[data.targetId];
        if (targetPeerData) {
            targetPeerData.socket.emit('offer', {
                sdp: data.sdp,
                fromId: socket.id,
                fromUsername: rooms[roomId].peers[socket.id].username
            });
        }
    });

    socket.on('answer', (data) => {
        const targetPeerData = rooms[roomId]?.peers[data.targetId];
        if (targetPeerData) {
            targetPeerData.socket.emit('answer', {
                sdp: data.sdp,
                fromId: socket.id,
                fromUsername: rooms[roomId].peers[socket.id].username
            });
        }
    });

    socket.on('ice-candidate', (data) => {
        const targetPeerData = rooms[roomId]?.peers[data.targetId];
        if (targetPeerData) {
            targetPeerData.socket.emit('ice-candidate', {
                candidate: data.candidate,
                fromId: socket.id
            });
        }
    });

    socket.on('chat message', (msg) => {
        // Mesajı sadece aynı odadaki kullanıcılara ilet
        io.to(roomId).emit('chat message', {
            text: msg.text,
            sender: msg.sender || 'Misafir',
            type: msg.type
        });
    });

    socket.on('disconnect', (reason) => {
        console.log(`[Sunucu] Bağlantı koptu (${socket.id}). Sebep: ${reason}`);
        if (rooms[roomId]) {
            const disconnectedUser = rooms[roomId].peers[socket.id];
            if (disconnectedUser) {
                const username = disconnectedUser.username;
                console.log(`[Sunucu] Kullanıcı ayrıldı: ${username} (ID: ${socket.id}) - Oda: ${roomId}`);
                
                // Odadaki diğer kullanıcılara bildir
                socket.to(roomId).emit('peer-left', socket.id);
                
                // Kullanıcıyı odadan sil
                delete rooms[roomId].peers[socket.id];
                
                // Oda boşsa odayı sil
                if (Object.keys(rooms[roomId].peers).length === 0) {
                    delete rooms[roomId];
                    console.log(`[Sunucu] Oda silindi: ${roomId}`);
                }

                // Yeniden bağlanma denemesi için event gönder
                socket.emit('try-reconnect');
            }
        }
    });
});

// Sunucu durumunu düzenli olarak kontrol et
setInterval(() => {
    console.log(`[Sunucu] Aktif odalar: ${Object.keys(rooms).length}`);
    for (const [roomId, room] of Object.entries(rooms)) {
        console.log(`[Sunucu] Oda ${roomId}: ${Object.keys(room.peers).length} kullanıcı`);
    }
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sinyalleşme sunucusu ${PORT} portunda çalışıyor...`);
});

app.get('/ping', (req, res) => {
    res.send('pong');
});

// Hata yakalama
process.on('uncaughtException', (error) => {
    console.error('[Sunucu] Yakalanmamış hata:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Sunucu] İşlenmemiş promise reddi:', reason);
});
