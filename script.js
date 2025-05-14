const joinArea = document.getElementById('joinArea');
const usernameInput = document.getElementById('usernameInput');
const joinButton = document.getElementById('joinButton');
const appArea = document.getElementById('appArea');
const displayUsername = document.getElementById('displayUsername');

const startButton = document.getElementById('startButton');
const muteButton = document.getElementById('muteButton');
const localAudio = document.getElementById('localAudio');
const remoteAudioContainer = document.getElementById('remoteAudioContainer');

let localStream;
const peerConnections = {}; // { peerId: RTCPeerConnection }
const remoteAudioElements = {}; // { peerId: {div: HTMLDivElement, audio: HTMLAudioElement} } - Artık div'i de saklıyoruz
let socket;
const signalingServerUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? `http://${window.location.hostname}:3000` 
    : 'https://diskurt-oy50.onrender.com';
let myUsername = ''; // Kullanıcı adını saklamak için

// STUN sunucu yapılandırması (NAT traversal için)
const STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let idsThatNeedMyOffer = new Set(); // Odadaki mevcut kişilere offer göndermemiz gerekebilir
let idsThatNeedMyAnswer = new Set(); // Bize offer gönderen ama henüz cevaplayamadıklarımız

console.log('Bağlanılacak sunucu:', signalingServerUrl);

// --- Socket.IO Bağlantısı ve Olayları ---
function connectToSignalingServer() {
    if (socket) {
        return;
    }
    socket = io(signalingServerUrl, {
        query: { 
            username: myUsername
        },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });

    socket.on('connect', () => {
        console.log('Sinyalleşme sunucusuna bağlandı. ID:', socket.id, 'Kullanıcı Adı:', myUsername);
        setupChatListeners();
    });

    socket.on('connect_error', (error) => {
        console.error('Bağlantı hatası:', error);
        alert('Sunucuya bağlanırken bir hata oluştu. Lütfen sayfayı yenileyip tekrar deneyin.');
    });

    socket.on('existing-peers', (peersData) => {
        console.log('--- existing-peers ALINDI ---');
        console.log('Alınan peersData:', JSON.stringify(peersData, null, 2)); // Detaylı log
        if (!Array.isArray(peersData)) {
            console.error("HATA: existing-peers'ten gelen veri bir dizi değil!", peersData);
            return;
        }
        peersData.forEach(peer => {
            console.log('İşlenen peer objesi:', JSON.stringify(peer, null, 2)); // Her bir peer'ı logla
            if (!peer || typeof peer.id === 'undefined' || typeof peer.username === 'undefined') {
                console.error("HATA: peer objesi beklenen formatta değil veya id/username eksik:", peer);
                return; // Hatalı peer'ı atla
            }
            if (peer.id === socket.id) return;

            if (!peerConnections[peer.id]) {
                console.log(`createPeerConnection çağrılacak: peer.id=${peer.id}, peer.username=${peer.username}`);
                const pc = createPeerConnection(peer.id, peer.username);
                peerConnections[peer.id] = pc;
            } else {
                console.log(`${peer.id} için PeerConnection zaten var.`);
            }
            console.log(`${peer.id} idsThatNeedMyOffer'a ekleniyor.`);
            idsThatNeedMyOffer.add(peer.id);
        });
        if (localStream && localStream.active) {
            idsThatNeedMyOffer.forEach(peerId => initiateOffer(peerId));
            idsThatNeedMyOffer.clear();
        }
    });

    socket.on('peer-joined', (data) => { 
        console.log('[İstemci] "peer-joined" olayı alındı. Gelen Ham Veri:', JSON.stringify(data)); // Gelen ham veriyi logla
        
        const { newPeerId, username } = data; 
        if (newPeerId === socket.id) return; // Kendimiz için işlem yapma

        console.log(`[İstemci] Yeni kullanıcı odaya katıldı: Alınan Username='${username}' (tip: ${typeof username}), ID='${newPeerId}'. Offer bekleniyor...`);
        
        let pc = peerConnections[newPeerId];
        if (!pc) {
            // Username tanımsızsa veya boşsa, createPeerConnection içinde varsayılan bir isim kullanılır.
            pc = createPeerConnection(newPeerId, username); // username'i createPeerConnection'a gönder
            peerConnections[newPeerId] = pc;
            console.log(`[İstemci] ${newPeerId} (${username || 'Bilinmeyen'}) için PeerConnection oluşturuldu (peer-joined).`);
        } else {
            console.log(`[İstemci] ${newPeerId} (${username || 'Bilinmeyen'}) için PeerConnection zaten mevcut (peer-joined).`);
        }
        // Normalde yeni katılan kullanıcı offer gönderir, biz answer bekleriz.
        // Eğer bir şekilde bizim offer göndermemiz gerekiyorsa (ki bu senaryoda pek olası değil),
        // o zaman idsThatNeedMyOffer.add(newPeerId); ve initiateOffer çağrılabilir.
        // Şimdilik bu kısmı basit tutalım ve offer'ı karşı taraftan bekleyelim.
    });

    socket.on('room-full', () => {
        alert('Sohbet odası dolu. Lütfen daha sonra tekrar deneyin.');
        startButton.disabled = true;
    });

    socket.on('offer', async (data) => {
        const { sdp, fromId, fromUsername } = data; // fromUsername'i bekleyebiliriz
        if (fromId === socket.id) return;
        console.log(`Offer alındı: ${fromUsername || fromId} kullanıcısından`);

        let pc = peerConnections[fromId];
        if (!pc) {
            console.log(`${fromId} için PeerConnection bulunamadı, yeni oluşturuluyor...`);
            pc = createPeerConnection(fromId, fromUsername || 'Bilinmeyen Kullanıcı'); // Username'i ilet
            peerConnections[fromId] = pc;
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            console.log(`Remote description (offer from ${fromUsername || fromId}) ayarlandı.`);
            if (localStream && localStream.active) {
                await sendAnswer(fromId);
            } else {
                console.warn(`Offer (${fromUsername || fromId} kullanıcısından) alındı ama yerel ses akışı hazır değil. "Sesi Başlat" bekleniyor.`);
                idsThatNeedMyAnswer.add(fromId);
            }
        } catch (error) {
            console.error(`Offer (${fromUsername || fromId} kullanıcısından) işlenirken hata:`, error);
        }
    });

    socket.on('answer', async (data) => {
        const { sdp, fromId } = data;
        if (fromId === socket.id) return;
        console.log(`Answer alındı: ${fromId} kullanıcısından`);
        const pc = peerConnections[fromId];
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                console.log(`Remote description (answer from ${fromId}) ayarlandı.`);
            } catch (error) {
                console.error(`Answer (${fromId} kullanıcısından) işlenirken hata:`, error);
            }
        } else {
            console.warn(`Answer (${fromId} kullanıcısından) alındı ama PeerConnection bulunamadı.`);
        }
    });

    socket.on('ice-candidate', async (data) => {
        const { candidate, fromId } = data;
        if (fromId === socket.id) return;
        // console.log(`ICE adayı alındı: ${fromId} kullanıcısından`); // Çok fazla log üretebilir
        const pc = peerConnections[fromId];
        if (pc && candidate) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                // console.log(`ICE adayı (${fromId} kullanıcısından) eklendi.`);
            } catch (error) {
                console.error(`ICE adayı (${fromId} kullanıcısından) eklenirken hata:`, error);
            }
        }
    });

    socket.on('peer-left', (peerId) => { // Sunucu sadece ID gönderiyorsa, username'i remoteAudioElements'ten bulabiliriz
        const username = remoteAudioElements[peerId]?.username || peerId;
        if (peerId === socket.id) return;
        console.log(`Kullanıcı ayrıldı: ${username}`);
        cleanupPeerConnection(peerId);
    });

    socket.on('disconnect', () => {
        console.log('Sinyalleşme sunucusuyla bağlantı kesildi.');
        // Tüm bağlantıları temizleyebiliriz veya yeniden bağlanmayı deneyebiliriz.
        // Şimdilik basit tutalım, kullanıcı sayfayı yenileyebilir.
        Object.keys(peerConnections).forEach(cleanupPeerConnection);
        startButton.textContent = 'Sesi Başlat';
        startButton.disabled = true; // Yeniden bağlanana kadar
        alert("Sunucuyla bağlantı kesildi. Lütfen sayfayı yenileyin.");
    });
}

// --- WebRTC Fonksiyonları ---
function createPeerConnection(peerId, peerUsername = 'Diğer Kullanıcı') {
    console.log(`PeerConnection oluşturuluyor: ${peerUsername} (${peerId}) için`);
    const pc = new RTCPeerConnection(STUN_SERVERS);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { 
                candidate: event.candidate, 
                targetId: peerId 
            });
            console.log('ICE adayı gönderildi:', peerId);
        }
    };

    pc.ontrack = (event) => {
        console.log(`Uzak medya akışı alındı: ${peerUsername} (${peerId})`);
        let audioWrapper = remoteAudioElements[peerId];
        
        if (!audioWrapper) {
            const peerDiv = document.createElement('div');
            peerDiv.id = `remoteAudioDiv-${peerId}`;
            peerDiv.style.marginBottom = '10px';

            const label = document.createElement('p');
            label.textContent = `${peerUsername} (${peerId.substring(0, 6)}...):`;
            label.style.margin = '0 0 5px 0';

            const remoteAudio = document.createElement('audio');
            remoteAudio.autoplay = true;
            remoteAudio.controls = true;
            
            peerDiv.appendChild(label);
            peerDiv.appendChild(remoteAudio);
            remoteAudioContainer.appendChild(peerDiv);
            
            remoteAudioElements[peerId] = { 
                div: peerDiv, 
                audio: remoteAudio, 
                username: peerUsername 
            };
            audioWrapper = remoteAudioElements[peerId];
        }

        if (audioWrapper.audio.srcObject !== event.streams[0]) {
            audioWrapper.audio.srcObject = event.streams[0];
            console.log(`Uzak ses akışı bağlandı: ${peerUsername} (${peerId})`);
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`ICE bağlantı durumu (${peerUsername} - ${peerId}): ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
            console.warn(`Bağlantı sorunu: ${peerUsername} (${peerId})`);
            // Bağlantıyı yeniden kurmayı dene
            if (pc.iceConnectionState === 'failed') {
                setTimeout(() => {
                    if (pc.signalingState !== 'closed') {
                        initiateOffer(peerId);
                    }
                }, 2000);
            }
        }
    };

    // Eğer yerel ses akışı varsa ekle
    if (localStream && localStream.active) {
        localStream.getTracks().forEach(track => {
            try {
                pc.addTrack(track, localStream);
                console.log(`Yerel track eklendi: ${track.kind} - Peer: ${peerId}`);
            } catch(e) {
                console.error(`Track eklenirken hata (${peerId}):`, e);
            }
        });
    }

    return pc;
}

async function initiateOffer(peerId) {
    const pc = peerConnections[peerId];
    if (!pc) {
        console.warn(`Offer başlatılamadı: PeerConnection bulunamadı (${peerId})`);
        return;
    }
    if (pc.signalingState !== 'stable') {
        if (pc.remoteDescription && pc.remoteDescription.type === 'offer') {
             console.log(`Offer başlatılmıyor (${peerId}), remote offer mevcut, cevap bekleniyor.`);
             if(localStream && localStream.active) await sendAnswer(peerId); // Eğer cevap verebilecek durumdaysak
             return;
        }
        console.log(`Offer başlatılmıyor (${peerId}), signalingState: ${pc.signalingState}. Stabil durum bekleniyor.`);
        return;
    }

    try {
        console.log(`Offer oluşturuluyor: ${peerId} için`);
        const offer = await pc.createOffer();
        
        if (pc.signalingState !== 'stable') {
            console.warn(`Signaling state (${pc.signalingState}) değişti, offer (${peerId} için) set edilmiyor.`);
            return;
        }
        await pc.setLocalDescription(offer);
        console.log(`Local description (offer) ayarlandı: ${peerId}. Sunucuya gönderiliyor.`);
        socket.emit('offer', { sdp: pc.localDescription, targetId: peerId });
    } catch (error) {
        console.error(`Offer oluşturulurken/gönderilirken hata (${peerId}):`, error);
    }
}

async function sendAnswer(peerId) {
    const pc = peerConnections[peerId];
    if (!pc) {
        console.warn(`Answer gönderilemedi: PeerConnection bulunamadı (${peerId})`);
        return;
    }
    if (!pc.remoteDescription || pc.remoteDescription.type !== 'offer') {
        console.warn(`Answer gönderilemedi (${peerId}): Remote description bir offer değil veya ayarlanmamış.`);
        return;
    }

    try {
        console.log(`Answer oluşturuluyor: ${peerId} için`);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`Local description (answer) ayarlandı: ${peerId}. Sunucuya gönderiliyor.`);
        socket.emit('answer', { sdp: pc.localDescription, targetId: peerId });
    } catch (error) {
        console.error(`Answer oluşturulurken/gönderilirken hata (${peerId}):`, error);
    }
}

function cleanupPeerConnection(peerId) {
    const pc = peerConnections[peerId];
    if (pc) {
        pc.close();
        delete peerConnections[peerId];
        console.log(`PeerConnection temizlendi: ${peerId}`);
    }
    const audioWrapper = remoteAudioElements[peerId];
    if (audioWrapper && audioWrapper.div) {
        audioWrapper.div.remove();
        delete remoteAudioElements[peerId];
        console.log(`Uzak ses elementi temizlendi: ${peerId}`);
    }
    idsThatNeedMyOffer.delete(peerId);
    idsThatNeedMyAnswer.delete(peerId);
}

// --- Medya Fonksiyonları ---
async function getInitialMediaPermission() {
    console.log('getInitialMediaPermission fonksiyonu çağrıldı.');
    try {
        console.log('Kullanıcıdan genel medya erişim izni isteniyor...');
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        tempStream.getTracks().forEach(track => track.stop());
        console.log('Medya izni alındı veya zaten vardı.');
        return true;
    } catch (permissionError) {
        console.error('Medya izni alınırken hata oluştu:', permissionError);
        alert('Mikrofon erişim izni reddedildi. Uygulamayı kullanmak için izin vermelisiniz.');
        return false;
    }
}

async function startAudio() {
    console.log('--- startAudio Fonksiyonu Çağrıldı ---');
    
    // Eğer halihazırda bir ses akışı varsa, durdur
    if (localStream && localStream.active) {
        console.log('Mevcut localStream durduruluyor.');
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log(`Track durduruldu: ${track.kind}`);
        });
        
        // Mevcut bağlantılardan track'leri kaldır
        Object.values(peerConnections).forEach(pc => {
            if (pc.signalingState !== 'closed') {
                pc.getSenders().forEach(sender => {
                    if (sender.track) {
                        try { 
                            pc.removeTrack(sender);
                            console.log('Track kaldırıldı:', sender.track.kind);
                        } catch(e) { 
                            console.warn("Track kaldırılırken hata:", e); 
                        }
                    }
                });
            }
        });

        localStream = null;
        localAudio.srcObject = null;
        startButton.textContent = 'Sesi Başlat';
        muteButton.classList.add('hidden');
        console.log('Ses durduruldu ve UI güncellendi.');
        return;
    }

    // Yeni ses akışı başlat
    try {
        console.log('Yeni ses akışı talep ediliyor...');
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 2
            }
        });
        
        console.log('Ses akışı başarıyla alındı:', localStream);
        localAudio.srcObject = localStream;
        startButton.textContent = 'Sesi Durdur';
        muteButton.classList.remove('hidden');

        // Tüm peer bağlantılarına yeni ses track'ini ekle
        Object.entries(peerConnections).forEach(([peerId, pc]) => {
            if (pc.signalingState !== 'closed') {
                try {
                    localStream.getTracks().forEach(track => {
                        pc.addTrack(track, localStream);
                        console.log(`Track eklendi: ${track.kind} - Peer: ${peerId}`);
                    });
                    
                    // Yeni offer gönder
                    initiateOffer(peerId);
                } catch(e) {
                    console.error(`Track eklenirken hata (Peer: ${peerId}):`, e);
                }
            }
        });

        // Bekleyen offer ve answer'ları işle
        if (idsThatNeedMyOffer.size > 0) {
            console.log('Bekleyen offer\'lar işleniyor...');
            idsThatNeedMyOffer.forEach(peerId => initiateOffer(peerId));
            idsThatNeedMyOffer.clear();
        }

        if (idsThatNeedMyAnswer.size > 0) {
            console.log('Bekleyen answer\'lar işleniyor...');
            idsThatNeedMyAnswer.forEach(peerId => sendAnswer(peerId));
            idsThatNeedMyAnswer.clear();
        }

    } catch (err) {
        console.error('Ses akışı alınırken hata:', err);
        alert(`Mikrofona erişilemedi: ${err.message}. Lütfen mikrofon izinlerini kontrol edin.`);
        startButton.textContent = 'Sesi Başlat';
        muteButton.classList.add('hidden');
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        localAudio.srcObject = null;
        localStream = null;
    }
}

// Yeni Susturma/Sesi Açma Fonksiyonu
function toggleMute() {
    if (!localStream) {
        console.warn("Susturma işlemi yapılamadı: Yerel ses akışı yok.");
        return;
    }

    localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled; // Mevcut durumu tersine çevir
        if (track.enabled) {
            muteButton.textContent = 'Sustur';
            console.log("Mikrofon sesi açıldı.");
        } else {
            muteButton.textContent = 'Sesi Aç';
            console.log("Mikrofon susturuldu.");
        }
    });
}

startButton.addEventListener('click', startAudio);
muteButton.addEventListener('click', toggleMute); // Yeni olay dinleyici

// --- Başlangıç ve Kullanıcı Adı Yönetimi ---
joinButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        myUsername = username;
        displayUsername.textContent = myUsername; // Kullanıcı adını göster
        joinArea.classList.add('hidden'); // Katılma alanını gizle
        appArea.classList.remove('hidden'); // Ana uygulama alanını göster
        
        initializeApp(); // Medya izinlerini al ve sunucuya bağlan
    } else {
        alert("Lütfen bir kullanıcı adı girin.");
    }
});

async function initializeApp() {
    const permissionGranted = await getInitialMediaPermission();
    if (permissionGranted) {
        startButton.disabled = false;
        connectToSignalingServer(); // Kullanıcı adı myUsername değişkeninde global olarak set edildi.
    } else {
        startButton.disabled = true;
        alert("Mikrofon izni olmadan devam edilemez.");
        joinArea.classList.remove('hidden');
        appArea.classList.add('hidden');
    }
}

// --- Sohbet işlemleri ---
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const messages = document.getElementById('messages');
const clearChatButton = document.getElementById('clear-chat');

// Sohbeti temizleme fonksiyonu
function clearChat() {
    if (confirm('Tüm sohbet geçmişini silmek istediğinize emin misiniz?')) {
        while (messages.firstChild) {
            messages.removeChild(messages.firstChild);
        }
        // Temizleme işlemini diğer kullanıcılara bildir
        if (socket) {
            socket.emit('chat message', {
                text: '--- Sohbet geçmişini temizledi ---',
                sender: myUsername || 'Misafir',
                type: 'system'
            });
        }
    }
}

// Temizleme butonu için event listener
clearChatButton.addEventListener('click', clearChat);

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatInput.value && socket) {
        console.log('Mesaj gönderiliyor:', chatInput.value);
        // Mesajı gönder
        socket.emit('chat message', {
            text: chatInput.value,
            sender: myUsername || 'Misafir',
            type: 'message'
        });
        
        // Kendi mesajımızı hemen göster
        const messageElement = document.createElement('div');
        messageElement.style.margin = '5px';
        messageElement.style.padding = '8px';
        messageElement.style.backgroundColor = '#e3f2fd';
        messageElement.style.borderRadius = '5px';
        messageElement.innerHTML = `<strong>${myUsername || 'Misafir'}:</strong> ${chatInput.value}`;
        messages.appendChild(messageElement);
        messages.scrollTop = messages.scrollHeight;
        
        chatInput.value = '';
    } else {
        console.warn('Mesaj gönderilemedi: Socket bağlantısı yok veya mesaj boş');
    }
});

// Socket.IO mesaj olaylarını dinle
function setupChatListeners() {
    if (!socket) return;
    
    socket.on('chat message', (msg) => {
        console.log('Mesaj alındı:', msg);
        // Kendi mesajlarımızı tekrar gösterme (zaten gösterildi)
        if (msg.sender === myUsername && msg.type !== 'system') return;
        
        const messageElement = document.createElement('div');
        messageElement.style.margin = '5px';
        messageElement.style.padding = '8px';
        
        // Sistem mesajları için farklı stil
        if (msg.type === 'system') {
            messageElement.style.backgroundColor = '#f8d7da';
            messageElement.style.color = '#721c24';
            messageElement.style.textAlign = 'center';
            messageElement.style.fontStyle = 'italic';
            messageElement.innerHTML = `${msg.sender} ${msg.text}`;
        } else {
            messageElement.style.backgroundColor = '#f5f5f5';
            messageElement.style.borderRadius = '5px';
            messageElement.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
        }
        
        messages.appendChild(messageElement);
        messages.scrollTop = messages.scrollHeight;
    });
}

console.log("Script yüklendi. Kullanıcı adı bekleniyor...");

// Updated portion only: add room creation/join/leave logic to script.js

let currentRoom = null;

function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function createRoom() {
    const roomCode = generateRoomCode();
    currentRoom = roomCode;

    // Show app area and hide join area
    joinArea.classList.add('hidden');
    appArea.classList.remove('hidden');

    displayUsername.textContent = myUsername || 'Oluşturan'; // optional
    document.getElementById('roomCodeDisplay').textContent = currentRoom;
    document.getElementById('leaveRoomButton').classList.remove('hidden');
    initializeApp();;
    alert(`Oda oluşturuldu: ${roomCode}. Diğer kullanıcıların bu kodla katılmasını bekleyin.`);
}

function joinRoom() {
    const roomCode = prompt('Katılmak istediğiniz oda kodunu girin:');
    if (roomCode && roomCode.length === 6) {
        currentRoom = roomCode;

        // Show app area and hide join area
        joinArea.classList.add('hidden');
        appArea.classList.remove('hidden');

        displayUsername.textContent = myUsername || 'Katılan'; // optional
        document.getElementById('roomCodeDisplay').textContent = currentRoom;
        document.getElementById('leaveRoomButton').classList.remove('hidden');
        initializeApp();;
    } else {
        alert('Geçerli bir 6 haneli oda kodu girin.');
    }
}

function leaveRoom() {
    if (socket && currentRoom) {
        socket.emit('leave-room', { room: currentRoom });
        socket.disconnect();
        Object.keys(peerConnections).forEach(cleanupPeerConnection);
        currentRoom = null;
        alert('Odadan ayrıldınız.');
        location.reload();
    }
}

function connectToSignalingServer(roomCode) {
    if (socket) return;
    socket = io(signalingServerUrl, {
        query: {
            username: myUsername,
            room: roomCode
        },
        transports: ['websocket', 'polling']
    });

    // rest of existing connection logic...
}

// HTML'de butonlara bağla
document.getElementById('createRoomButton').addEventListener('click', createRoom);
document.getElementById('joinRoomButton').addEventListener('click', joinRoom);
document.getElementById('leaveRoomButton').addEventListener('click', leaveRoom);

// Dark Mode işlemleri
const themeToggle = document.getElementById('theme-toggle');
const htmlElement = document.documentElement;

// Kullanıcının tercih ettiği temayı localStorage'dan al
const savedTheme = localStorage.getItem('theme') || 'light';
htmlElement.setAttribute('data-theme', savedTheme);

// Tema değiştirme fonksiyonu
function toggleTheme() {
    const currentTheme = htmlElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    htmlElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // SVG ikonunu güncelle
    const path = themeToggle.querySelector('path');
    if (newTheme === 'dark') {
        path.setAttribute('d', 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z');
    } else {
        path.setAttribute('d', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
    }
}

themeToggle.addEventListener('click', toggleTheme);

// Sayfa yüklendiğinde doğru ikonu göster
window.addEventListener('load', () => {
    const currentTheme = htmlElement.getAttribute('data-theme');
    const path = themeToggle.querySelector('path');
    if (currentTheme === 'dark') {
        path.setAttribute('d', 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z');
    }
});

// Ekran paylaşımı için yeni fonksiyonlar
let screenStream = null;

async function startScreenShare() {
    try {
        // Ekran paylaşımı için medya akışını al
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                displaySurface: 'monitor',
                logicalSurface: true,
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100,
                channelCount: 2,
                autoGainControl: true,
                suppressLocalAudioPlayback: false,
                systemAudio: 'include'
            }
        });

        console.log('Ekran paylaşımı başlatıldı:', screenStream.getTracks().map(t => t.kind));

        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = screenStream;

        // Her bir peer bağlantısı için video ve ses track'lerini ekle
        Object.entries(peerConnections).forEach(async ([peerId, pc]) => {
            try {
                console.log(`${peerId} için ekran paylaşımı track'leri ekleniyor...`);
                
                // Mevcut video track'lerini kaldır
                const senders = pc.getSenders();
                const videoSender = senders.find(sender => sender.track?.kind === 'video');
                if (videoSender) {
                    await pc.removeTrack(videoSender);
                    console.log(`${peerId} için eski video track kaldırıldı`);
                }

                // Yeni track'leri ekle
                screenStream.getTracks().forEach(track => {
                    pc.addTrack(track, screenStream);
                    console.log(`${peerId} için ${track.kind} track eklendi`);
                });

                // Yeni bir offer oluştur ve gönder
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    console.log(`${peerId} için yeni offer oluşturuldu ve gönderiliyor`);
                    socket.emit('offer', {
                        sdp: pc.localDescription,
                        targetId: peerId
                    });
                } catch (err) {
                    console.error(`${peerId} için offer oluşturulurken hata:`, err);
                }
            } catch (err) {
                console.error(`${peerId} için ekran paylaşımı track'leri eklenirken hata:`, err);
            }
        });

        // Ekran paylaşımı durduğunda
        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
            stopScreenShare();
        });

        // Buton metnini güncelle
        const screenShareButton = document.getElementById('screenShareButton');
        screenShareButton.textContent = 'Paylaşımı Durdur';
        screenShareButton.style.backgroundColor = '#dc3545';

    } catch (err) {
        console.error('Ekran paylaşımı başlatılırken hata:', err);
        alert('Ekran paylaşımı başlatılamadı: ' + err.message);
    }
}

async function stopScreenShare() {
    if (screenStream) {
        console.log('Ekran paylaşımı durduruluyor...');
        
        // Tüm track'leri durdur
        screenStream.getTracks().forEach(track => {
            track.stop();
            console.log(`${track.kind} track durduruldu`);
        });
        screenStream = null;

        // Video elementini temizle
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = null;

        // Her peer bağlantısı için video track'lerini kaldır ve yeni offer gönder
        Object.entries(peerConnections).forEach(async ([peerId, pc]) => {
            try {
                console.log(`${peerId} için ekran paylaşımı track'leri kaldırılıyor...`);
                
                // Video track'lerini kaldır
                const senders = pc.getSenders();
                const videoSender = senders.find(sender => sender.track?.kind === 'video');
                if (videoSender) {
                    await pc.removeTrack(videoSender);
                    console.log(`${peerId} için video track kaldırıldı`);
                }

                // Yeni bir offer oluştur ve gönder
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    console.log(`${peerId} için yeni offer oluşturuldu ve gönderiliyor`);
                    socket.emit('offer', {
                        sdp: pc.localDescription,
                        targetId: peerId
                    });
                } catch (err) {
                    console.error(`${peerId} için offer oluşturulurken hata:`, err);
                }
            } catch (err) {
                console.error(`${peerId} için track'ler kaldırılırken hata:`, err);
            }
        });

        // Buton metnini sıfırla
        const screenShareButton = document.getElementById('screenShareButton');
        screenShareButton.textContent = 'Ekranı Paylaş';
        screenShareButton.style.backgroundColor = '#2196F3';
        
        console.log('Ekran paylaşımı durduruldu ve temizlendi');
    }
}

// Event listener'ları ekle
document.addEventListener('DOMContentLoaded', () => {
    const screenShareButton = document.getElementById('screenShareButton');
    screenShareButton.addEventListener('click', () => {
        if (!screenStream) {
            startScreenShare();
        } else {
            stopScreenShare();
        }
    });
});
