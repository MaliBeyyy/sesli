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
            socket.emit('ice-candidate', { candidate: event.candidate, targetId: peerId });
        }
    };

    pc.ontrack = (event) => {
        console.log(`Uzak ses akışı (track) alındı: ${peerUsername} (${peerId}) kullanıcısından`);
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
            
            remoteAudioElements[peerId] = { div: peerDiv, audio: remoteAudio, username: peerUsername };
            audioWrapper = remoteAudioElements[peerId];
            console.log(`Uzak ses için audio elementi oluşturuldu ve eklendi: ${peerUsername} (${peerId})`);
        }
        if (audioWrapper.audio.srcObject !== event.streams[0]) {
            audioWrapper.audio.srcObject = event.streams[0];
            console.log(`Uzak ses akışı (${peerUsername} (${peerId}) kullanıcısından) audio elementine atandı.`);
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (pc) {
            console.log(`ICE bağlantı durumu (${peerUsername} - ${peerId}): ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
                console.warn(`Bağlantı sorunu/kesintisi (${peerUsername} - ${peerId}).`);
            }
        }
    };

    if (localStream && localStream.active) {
        localStream.getTracks().forEach(track => {
            try {
                pc.addTrack(track, localStream);
            } catch(e) { console.error(`Track eklenirken hata (createPeerConnection for ${peerUsername} - ${peerId}):`, e); }
        });
        console.log(`Yerel ses akışı PeerConnection'a eklendi (oluşturulurken): ${peerUsername} (${peerId})`);
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
    if (localStream && localStream.active) { // Sesi kapatma (Stop Audio)
        console.log('Mevcut localStream durduruluyor (Stop Audio).');
        localStream.getTracks().forEach(track => track.stop()); // Tüm track'leri durdur
        Object.values(peerConnections).forEach(pc => {
            if (pc.signalingState !== 'closed') {
                pc.getSenders().forEach(sender => {
                    if (sender.track) {
                        try { pc.removeTrack(sender); } 
                        catch(e) { console.warn("Track kaldırılırken hata (Stop Audio):", e); }
                    }
                });
            }
        });
        localStream = null;
        localAudio.srcObject = null;
        startButton.textContent = 'Sesi Başlat';
        muteButton.classList.add('hidden'); // Susturma butonunu gizle
        muteButton.textContent = 'Sustur'; // Metni sıfırla
        localAudio.muted = true; // Kendi sesimizi duymamak için
        console.log('Yerel ses durduruldu (Stop Audio).');
        return;
    }

    // Sesi başlatma (Start Audio)
    const constraints = { audio: true };
    console.log('getUserMedia için VARSAYILAN mikrofon isteği:', JSON.stringify(constraints));

    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Yerel ses akışı (getUserMedia) BAŞARILI:', localStream);
        localAudio.srcObject = localStream;
        localAudio.muted = true; // Başlangıçta kendi sesimizi duymamak için
        startButton.textContent = 'Sesi Durdur';
        muteButton.classList.remove('hidden'); // Susturma butonunu göster
        muteButton.textContent = 'Sustur'; // Başlangıç durumu

        // Mevcut/yeni PeerConnection'lara track'leri ekle
        localStream.getTracks().forEach(track => {
            Object.values(peerConnections).forEach(pc => {
                 if (pc.signalingState !== 'closed') {
                    try { pc.addTrack(track, localStream); }
                    catch(e) { console.error("Track eklenirken hata (startAudio):", e); }
                 }
            });
        });
        console.log('Yerel ses akışı tüm mevcut PeerConnection\'lara eklendi.');

        // Bekleyen offer'ları gönder
        idsThatNeedMyOffer.forEach(peerId => {
            if (peerConnections[peerId]) initiateOffer(peerId);
        });
        idsThatNeedMyOffer.clear();

        // Bekleyen answer'ları gönder
        idsThatNeedMyAnswer.forEach(peerId => {
            if (peerConnections[peerId]) sendAnswer(peerId);
        });
        idsThatNeedMyAnswer.clear();

        console.log('Ses başarıyla başlatıldı ve WebRTC için hazırlandı.');

    } catch (err) {
        console.error('Yerel ses akışı (getUserMedia) BAŞARISIZ OLDU:', err.name, err.message);
        alert(`Varsayılan mikrofona erişilemedi: ${err.name}. İzinleri kontrol edin.`);
        startButton.textContent = 'Sesi Başlat';
        muteButton.classList.add('hidden');
        if (localStream) localStream.getTracks().forEach(track => track.stop());
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
