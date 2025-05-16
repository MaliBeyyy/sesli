const joinArea = document.getElementById('joinArea');
const usernameInput = document.getElementById('usernameInput');
const roomInput = document.getElementById('roomInput');
const joinButton = document.getElementById('joinButton');
const appArea = document.getElementById('appArea');
const displayUsername = document.getElementById('displayUsername');

const startButton = document.getElementById('startButton');
const muteButton = document.getElementById('muteButton');
const cameraButton = document.getElementById('cameraButton');
const stopCameraButton = document.getElementById('stopCameraButton');
const screenShareButton = document.getElementById('screenShareButton');
const stopScreenShareButton = document.getElementById('stopScreenShareButton');
const leaveRoomButton = document.getElementById('leaveRoomButton');
const localAudio = document.getElementById('localAudio');
const remoteAudioContainer = document.getElementById('remoteAudioContainer');

let localStream;
let screenStream;
let cameraStream;
const peerConnections = {}; // { peerId: RTCPeerConnection }
const remoteAudioElements = {}; // { peerId: {div: HTMLDivElement, audio: HTMLAudioElement} }
const remoteVideoElements = {}; // { peerId: {div: HTMLDivElement, video: HTMLVideoElement} }
let socket;
const signalingServerUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? `http://${window.location.hostname}:3000` 
    : 'https://diskurt-oy50.onrender.com';
let myUsername = '';
let myRoom = ''; // Oda adını saklamak için

let isHost = false; // Host durumunu takip etmek için

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

// Tema yönetimi için değişkenler
const themeToggle = document.createElement('button');
themeToggle.id = 'theme-toggle';
themeToggle.innerHTML = '🌙'; // Başlangıç ikonu
themeToggle.title = 'Temayı Değiştir';
document.querySelector('.chat-header').appendChild(themeToggle);

// Tema durumu
let isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

// Tema değiştirme fonksiyonu
function toggleTheme() {
    isDarkMode = !isDarkMode;
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    themeToggle.innerHTML = isDarkMode ? '☀️' : '🌙';
    localStorage.setItem('chatTheme', isDarkMode ? 'dark' : 'light');
}

// Sistem teması değişikliğini dinle
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (localStorage.getItem('chatTheme') === null) { // Kullanıcı manuel tema seçmediyse
        isDarkMode = e.matches;
        document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
        themeToggle.innerHTML = isDarkMode ? '☀️' : '🌙';
    }
});

// Sayfa yüklendiğinde tema ayarını kontrol et
function initializeTheme() {
    const savedTheme = localStorage.getItem('chatTheme');
    if (savedTheme) {
        isDarkMode = savedTheme === 'dark';
    }
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    themeToggle.innerHTML = isDarkMode ? '☀️' : '🌙';
}

// Tema değiştirme butonu için event listener
themeToggle.addEventListener('click', toggleTheme);

// Tema başlatma
initializeTheme();

// Sunucu durumunu kontrol et
async function checkServerStatus() {
    try {
        const response = await fetch(signalingServerUrl + '/ping');
        if (!response.ok) throw new Error('Sunucu yanıt vermiyor');
        const text = await response.text();
        return text === 'pong';
    } catch (error) {
        console.error('Sunucu durumu kontrol edilirken hata:', error);
        return false;
    }
}

// --- Socket.IO Bağlantısı ve Olayları ---
function connectToSignalingServer() {
    if (socket) {
        try {
            socket.disconnect();
        } catch (e) {
            console.warn('Önceki soket bağlantısını kapatırken hata:', e);
        }
    }

    // Önce sunucu durumunu kontrol et
    checkServerStatus().then(isServerActive => {
        if (!isServerActive) {
            alert('Sunucu şu anda aktif değil. Birkaç saniye sonra tekrar deneyin.');
            setTimeout(connectToSignalingServer, 5000); // 5 saniye sonra tekrar dene
            return;
        }

        try {
            console.log('Sunucuya bağlanmaya çalışılıyor...');
            socket = io(signalingServerUrl, {
                query: { 
                    username: myUsername,
                    roomId: myRoom
                },
                transports: ['websocket', 'polling'],
                reconnectionAttempts: 10,
                reconnectionDelay: 2000,
                timeout: 10000,
                forceNew: true,
                reconnection: true,
                reconnectionDelayMax: 5000,
                path: '/socket.io/',
                // Bellek optimizasyonu
                perMessageDeflate: true,
                // Ping ayarları
                pingTimeout: 45000,
                pingInterval: 20000
            });

            // Ping/Pong mekanizması
            socket.on('ping', () => {
                socket.emit('pong');
            });

            // Tüm Socket.IO olay dinleyicilerini burada tanımlıyoruz
            socket.on('connect', () => {
                console.log('Sinyalleşme sunucusuna bağlandı. ID:', socket.id, 'Kullanıcı Adı:', myUsername);
                setupChatListeners();
                startButton.disabled = false;
            });

            socket.on('connect_error', (error) => {
                console.error('Bağlantı hatası:', error);
                handleConnectionError();
            });

            socket.on('connect_timeout', (timeout) => {
                console.error('Bağlantı zaman aşımı:', timeout);
                handleConnectionError();
            });

            socket.on('error', (error) => {
                console.error('Soket hatası:', error);
                handleConnectionError();
            });

            socket.on('disconnect', (reason) => {
                console.log('Sunucu bağlantısı kesildi. Sebep:', reason);
                if (reason === 'io server disconnect') {
                    socket.connect();
                }
                startButton.disabled = true;
                Object.keys(peerConnections).forEach(cleanupPeerConnection);
                startButton.textContent = 'Sesi Başlat';
                alert("Sunucuyla bağlantı kesildi. Lütfen sayfayı yenileyin.");
            });

            socket.on('reconnect', (attemptNumber) => {
                console.log(`Sunucuya yeniden bağlanıldı (${attemptNumber}. deneme)`);
                if (myRoom && myUsername) {
                    socket.emit('rejoin-room', { roomId: myRoom, username: myUsername });
                }
                startButton.disabled = false;
            });

            socket.on('reconnect_attempt', () => {
                console.log('Sunucuya yeniden bağlanmaya çalışılıyor...');
            });

            socket.on('reconnect_error', (error) => {
                console.error('Yeniden bağlanma hatası:', error);
                handleConnectionError();
            });

            socket.on('reconnect_failed', () => {
                console.error('Yeniden bağlanma başarısız oldu');
                alert('Sunucuya yeniden bağlanma başarısız oldu. Lütfen sayfayı yenileyip tekrar deneyin.');
                startButton.disabled = true;
            });

            socket.on('existing-peers', (peersData) => {
                console.log('--- existing-peers ALINDI ---');
                if (!Array.isArray(peersData)) {
                    console.error("HATA: existing-peers'ten gelen veri bir dizi değil!", peersData);
                    return;
                }
                peersData.forEach(peer => {
                    if (!peer || typeof peer.id === 'undefined' || typeof peer.username === 'undefined') {
                        console.error("HATA: peer objesi beklenen formatta değil veya id/username eksik:", peer);
                        return;
                    }
                    if (peer.id === socket.id) return;

                    if (!peerConnections[peer.id]) {
                        const pc = createPeerConnection(peer.id, peer.username);
                        peerConnections[peer.id] = pc;
                    }
                    idsThatNeedMyOffer.add(peer.id);
                });
                if (localStream && localStream.active) {
                    idsThatNeedMyOffer.forEach(peerId => initiateOffer(peerId));
                    idsThatNeedMyOffer.clear();
                }
            });

            socket.on('peer-joined', (data) => {
                const { newPeerId, username } = data;
                if (newPeerId === socket.id) return;

                let pc = peerConnections[newPeerId];
                if (!pc) {
                    pc = createPeerConnection(newPeerId, username);
                    peerConnections[newPeerId] = pc;
                }
            });

            socket.on('offer', async (data) => {
                const { sdp, fromId, fromUsername } = data;
                if (fromId === socket.id) return;

                let pc = peerConnections[fromId];
                if (!pc) {
                    pc = createPeerConnection(fromId, fromUsername || 'Bilinmeyen Kullanıcı');
                    peerConnections[fromId] = pc;
                }

                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                    if (localStream && localStream.active) {
                        await sendAnswer(fromId);
                    } else {
                        idsThatNeedMyAnswer.add(fromId);
                    }
                } catch (error) {
                    console.error(`Offer işlenirken hata:`, error);
                }
            });

            socket.on('answer', async (data) => {
                const { sdp, fromId } = data;
                if (fromId === socket.id) return;

                const pc = peerConnections[fromId];
                if (pc) {
                    try {
                        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                    } catch (error) {
                        console.error(`Answer işlenirken hata:`, error);
                    }
                }
            });

            socket.on('ice-candidate', async (data) => {
                const { candidate, fromId } = data;
                if (fromId === socket.id) return;

                const pc = peerConnections[fromId];
                if (pc && candidate) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (error) {
                        console.error(`ICE candidate eklenirken hata:`, error);
                    }
                }
            });

            socket.on('peer-left', (peerId) => {
                if (peerId === socket.id) return;
                cleanupPeerConnection(peerId);
            });

            socket.on('host-status', (data) => {
                isHost = data.isHost;
                if (isHost) {
                    const hostBadge = document.createElement('span');
                    hostBadge.textContent = ' (Host)';
                    hostBadge.style.color = '#28a745';
                    hostBadge.style.fontWeight = 'bold';
                    displayUsername.appendChild(hostBadge);
                }
            });

            socket.on('kicked-from-room', () => {
                alert('Host tarafından odadan atıldınız!');
                leaveRoom();
            });

            // Bağlantı durumu değişikliklerini izle
            socket.io.on('reconnect_attempt', (attempt) => {
                console.log(`Yeniden bağlanma denemesi ${attempt}`);
                if (attempt > 5) {
                    alert('Sunucuya bağlanmakta sorun yaşıyoruz. Sayfayı yenilemek isteyebilirsiniz.');
                }
            });

            socket.io.on('reconnect_error', (error) => {
                console.error('Yeniden bağlanma hatası:', error);
                if (!navigator.onLine) {
                    alert('İnternet bağlantınız kopmuş görünüyor. Lütfen bağlantınızı kontrol edin.');
                }
            });

            socket.io.on('reconnect_failed', () => {
                alert('Sunucuya yeniden bağlanılamadı. Lütfen sayfayı yenileyip tekrar deneyin.');
            });

        } catch (error) {
            console.error('Socket.IO başlatılırken hata:', error);
            handleConnectionError();
        }
    });
}

// Bağlantı hatalarını yönetme
function handleConnectionError() {
    if (!navigator.onLine) {
        alert('İnternet bağlantınız kopmuş görünüyor. Lütfen bağlantınızı kontrol edin.');
    } else {
        fetch(signalingServerUrl + '/ping')
            .then(response => {
                if (!response.ok) throw new Error('Sunucu yanıt vermiyor');
                return response.text();
            })
            .then(text => {
                if (text === 'pong') {
                    alert('Bağlantı sorunu yaşanıyor. Otomatik olarak yeniden bağlanmayı deniyoruz...');
                } else {
                    throw new Error('Beklenmeyen sunucu yanıtı');
                }
            })
            .catch(error => {
                console.error('Sunucu durumu kontrol edilirken hata:', error);
                alert('Sunucuya erişilemiyor. Lütfen daha sonra tekrar deneyin.');
            });
    }
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

    updatePeerConnectionTrackHandler(pc, peerId, peerUsername);

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

    if (screenStream && screenStream.active) {
        screenStream.getTracks().forEach(track => {
            try {
                pc.addTrack(track, screenStream);
            } catch(e) { console.error(`Ekran paylaşımı track'i eklenirken hata (createPeerConnection for ${peerUsername} - ${peerId}):`, e); }
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
    }

    const videoWrapper = remoteVideoElements[peerId];
    if (videoWrapper && videoWrapper.div) {
        videoWrapper.div.remove();
        delete remoteVideoElements[peerId];
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
        cameraButton.classList.add('hidden'); // Kamera butonunu gizle
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
        cameraButton.classList.remove('hidden'); // Kamera butonunu göster
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
joinButton.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const room = roomInput.value.trim();
    
    if (username && room) {
        joinArea.classList.add('hidden');
        appArea.classList.remove('hidden');
        displayUsername.textContent = `${username} (Oda: ${room})`;
        myUsername = username;
        myRoom = room;

        const hasPermission = await getInitialMediaPermission();
        if (hasPermission) {
            startButton.disabled = false;
            screenShareButton.classList.remove('hidden');
        }

        connectToSignalingServer();
    } else {
        alert('Lütfen kullanıcı adı ve oda adı girin!');
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
const chatContainer = document.getElementById('chat-container');
const chatToggle = document.getElementById('chat-toggle');

// Sohbet durumu
let isChatVisible = true;

// Sohbeti aç/kapat fonksiyonu
function toggleChat() {
    isChatVisible = !isChatVisible;
    chatContainer.classList.toggle('hidden', !isChatVisible);
    
    // Toggle butonunun ikonunu değiştir
    chatToggle.innerHTML = isChatVisible 
        ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"/></svg>'
        : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"/></svg>';
    
    // Sohbet kapalıyken yeni mesaj gelirse butonu vurgula
    if (!isChatVisible) {
        chatToggle.style.transform = 'scale(1)';
    }
}

// Yeni mesaj geldiğinde butonu vurgula
function highlightChatButton() {
    if (!isChatVisible) {
        chatToggle.style.transform = 'scale(1.1)';
        setTimeout(() => {
            chatToggle.style.transform = 'scale(1)';
        }, 200);
    }
}

// Toggle butonu için event listener
chatToggle.addEventListener('click', toggleChat);

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
        messageElement.classList.add('message', 'my-message');
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
        messageElement.classList.add('message');
        
        // Sistem mesajları için farklı stil
        if (msg.type === 'system') {
            messageElement.classList.add('system-message');
            messageElement.innerHTML = `${msg.sender} ${msg.text}`;
        } else {
            messageElement.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
        }
        
        messages.appendChild(messageElement);
        messages.scrollTop = messages.scrollHeight;
        
        // Yeni mesaj geldiğinde butonu vurgula
        highlightChatButton();
    });
}

console.log("Script yüklendi. Kullanıcı adı bekleniyor...");

// Ekran paylaşımı fonksiyonları
async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true,
            audio: true 
        });
        
        screenShareButton.classList.add('hidden');
        stopScreenShareButton.classList.remove('hidden');

        // Ekran paylaşımını tüm bağlantılara ekle
        Object.keys(peerConnections).forEach(async (peerId) => {
            const pc = peerConnections[peerId];
            if (pc && pc.signalingState === 'stable') {
                screenStream.getTracks().forEach(track => {
                    pc.addTrack(track, screenStream);
                });
                await initiateOffer(peerId);
            }
        });

        // Ekran paylaşımı durduğunda
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };

    } catch (error) {
        console.error('Ekran paylaşımı başlatılırken hata:', error);
        alert('Ekran paylaşımı başlatılamadı: ' + error.message);
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            track.stop();
            Object.values(peerConnections).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track === track);
                if (sender) {
                    pc.removeTrack(sender);
                }
            });
        });
        screenStream = null;
        screenShareButton.classList.remove('hidden');
        stopScreenShareButton.classList.add('hidden');
    }
}

// Event listeners
screenShareButton.addEventListener('click', startScreenShare);
stopScreenShareButton.addEventListener('click', stopScreenShare);

// Uzak video elementini oluşturma fonksiyonu
function createRemoteVideo(peerId, peerUsername, isScreenShare = false) {
    const videoWrapper = document.createElement('div');
    videoWrapper.id = `remoteVideoDiv-${peerId}`;
    videoWrapper.style.marginBottom = '10px';

    const label = document.createElement('p');
    label.textContent = isScreenShare ? `${peerUsername} Ekran Paylaşımı` : `${peerUsername} Kamerası`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.style.maxWidth = '100%';
    
    if (isScreenShare) {
        video.classList.add('screen-share-video');
    }
    
    videoWrapper.appendChild(label);
    videoWrapper.appendChild(video);
    remoteAudioContainer.appendChild(videoWrapper);
    
    return { div: videoWrapper, video: video };
}

// PeerConnection track handler'ını güncelle
function updatePeerConnectionTrackHandler(pc, peerId, peerUsername) {
    pc.ontrack = (event) => {
        console.log(`Uzak medya akışı alındı: ${peerUsername} (${peerId}) kullanıcısından`);
        
        if (event.track.kind === 'audio') {
            let audioWrapper = remoteAudioElements[peerId];
            if (!audioWrapper) {
                const peerDiv = document.createElement('div');
                peerDiv.id = `remoteAudioDiv-${peerId}`;
                peerDiv.style.marginBottom = '10px';
                peerDiv.style.display = 'flex';
                peerDiv.style.justifyContent = 'space-between';
                peerDiv.style.alignItems = 'center';

                const leftDiv = document.createElement('div');
                leftDiv.style.flex = '1';

                const label = document.createElement('p');
                label.textContent = `${peerUsername} (${peerId.substring(0, 6)}...):`;
                
                const remoteAudio = document.createElement('audio');
                remoteAudio.autoplay = true;
                remoteAudio.controls = true;
                
                leftDiv.appendChild(label);
                leftDiv.appendChild(remoteAudio);
                peerDiv.appendChild(leftDiv);

                // Host ise atma butonu ekle
                if (isHost && socket.id !== peerId) {
                    const kickButton = document.createElement('button');
                    kickButton.textContent = 'Odadan At';
                    kickButton.style.backgroundColor = '#dc3545';
                    kickButton.style.color = 'white';
                    kickButton.style.border = 'none';
                    kickButton.style.padding = '5px 10px';
                    kickButton.style.borderRadius = '4px';
                    kickButton.style.cursor = 'pointer';
                    kickButton.style.marginLeft = '10px';
                    
                    kickButton.onclick = () => {
                        if (confirm(`${peerUsername} kullanıcısını odadan atmak istediğinize emin misiniz?`)) {
                            socket.emit('kick-user', peerId);
                        }
                    };
                    
                    peerDiv.appendChild(kickButton);
                }
                
                remoteAudioContainer.appendChild(peerDiv);
                remoteAudioElements[peerId] = { 
                    div: peerDiv, 
                    audio: remoteAudio, 
                    username: peerUsername 
                };
                audioWrapper = remoteAudioElements[peerId];
            }
            audioWrapper.audio.srcObject = event.streams[0];
        } else if (event.track.kind === 'video') {
            let videoWrapper = remoteVideoElements[peerId];
            if (!videoWrapper) {
                const isScreenShare = event.track.label.toLowerCase().includes('screen') || 
                                    event.track.label.toLowerCase().includes('display');
                videoWrapper = createRemoteVideo(peerId, peerUsername, isScreenShare);
                remoteVideoElements[peerId] = videoWrapper;
            }
            videoWrapper.video.srcObject = event.streams[0];
        }
    };
}

// Kamera işlevselliği için yeni fonksiyonlar
async function startCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ 
            video: true,
            audio: false 
        });
        
        cameraButton.classList.add('hidden');
        stopCameraButton.classList.remove('hidden');

        // Kamera akışını tüm bağlantılara ekle
        Object.keys(peerConnections).forEach(async (peerId) => {
            const pc = peerConnections[peerId];
            if (pc && pc.signalingState === 'stable') {
                cameraStream.getTracks().forEach(track => {
                    pc.addTrack(track, cameraStream);
                });
                await initiateOffer(peerId);
            }
        });

        // Yerel kamera görüntüsünü göster
        const localVideo = document.createElement('video');
        localVideo.id = 'localVideo';
        localVideo.autoplay = true;
        localVideo.playsInline = true;
        localVideo.muted = true;
        localVideo.srcObject = cameraStream;
        
        const localVideoWrapper = document.createElement('div');
        localVideoWrapper.id = 'localVideoWrapper';
        localVideoWrapper.className = 'video-wrapper';
        
        const label = document.createElement('p');
        label.textContent = 'Senin Kameran';
        
        localVideoWrapper.appendChild(label);
        localVideoWrapper.appendChild(localVideo);
        remoteVideoContainer.insertBefore(localVideoWrapper, remoteVideoContainer.firstChild);

    } catch (error) {
        console.error('Kamera başlatılırken hata:', error);
        alert('Kamera başlatılamadı: ' + error.message);
        stopCamera();
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => {
            track.stop();
            // Tüm peer bağlantılarından kamera track'lerini kaldır
            Object.values(peerConnections).forEach(pc => {
                const senders = pc.getSenders();
                senders.forEach(sender => {
                    if (sender.track && sender.track.kind === 'video') {
                        pc.removeTrack(sender);
                    }
                });
            });
        });
        cameraStream = null;
    }

    // Yerel video elementini kaldır
    const localVideoWrapper = document.getElementById('localVideoWrapper');
    if (localVideoWrapper) {
        localVideoWrapper.remove();
    }

    cameraButton.classList.remove('hidden');
    stopCameraButton.classList.add('hidden');
}

// Event listener'ları ekle
cameraButton.addEventListener('click', startCamera);
stopCameraButton.addEventListener('click', stopCamera);

// Odadan çıkma fonksiyonu
function leaveRoom() {
    if (confirm('Odadan çıkmak istediğinize emin misiniz?')) {
        // Tüm medya akışlarını durdur
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }

        // Tüm peer bağlantılarını temizle
        Object.keys(peerConnections).forEach(cleanupPeerConnection);

        // Socket bağlantısını kapat
        if (socket) {
            socket.disconnect();
            socket = null;
        }

        // UI'ı sıfırla
        appArea.classList.add('hidden');
        joinArea.classList.remove('hidden');
        startButton.textContent = 'Sesi Başlat';
        startButton.disabled = true;
        muteButton.classList.add('hidden');
        cameraButton.classList.add('hidden');
        screenShareButton.classList.add('hidden');
        stopScreenShareButton.classList.add('hidden');
        stopCameraButton.classList.add('hidden');
        
        // Input alanlarını temizle
        usernameInput.value = '';
        roomInput.value = '';
        
        // Sohbet alanını temizle
        while (messages.firstChild) {
            messages.removeChild(messages.firstChild);
        }

        // Global değişkenleri sıfırla
        myUsername = '';
        myRoom = '';
    }
}

// Odadan çıkma butonu için event listener
leaveRoomButton.addEventListener('click', leaveRoom);
