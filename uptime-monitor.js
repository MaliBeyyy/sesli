// Uptime monitoring servisi - Render'ın sunucuyu uyandık tutması için
const https = require('https');
const http = require('http');

// Render URL'nizi buraya yazın
const RENDER_URL = 'https://diskurt-oy50.onrender.com';

// Her 5 dakikada bir sunucuyu ping'le - daha sık
function pingServer() {
    const url = new URL(RENDER_URL);
    const protocol = url.protocol === 'https:' ? https : http;
    
    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: '/keepalive',
        method: 'GET',
        timeout: 10000
    };
    
    const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log(`[Uptime Monitor] Sunucu ping başarılı: ${res.statusCode}`);
            if (res.statusCode === 200) {
                console.log(`[Uptime Monitor] Sunucu yanıtı: ${data}`);
            }
        });
    });
    
    req.on('error', (error) => {
        console.error(`[Uptime Monitor] Ping hatası: ${error.message}`);
    });
    
    req.on('timeout', () => {
        console.error('[Uptime Monitor] Ping timeout');
        req.destroy();
    });
    
    req.end();
}

// İlk ping'i hemen gönder
console.log('[Uptime Monitor] Başlatılıyor...');
pingServer();

// Her 5 dakikada bir ping gönder
setInterval(pingServer, 5 * 60 * 1000);

console.log('[Uptime Monitor] Her 5 dakikada bir ping gönderilecek');
