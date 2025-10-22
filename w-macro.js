const robot = require('robotjs');
const express = require('express');
const path = require('path');

const app = express();
const PORT = 3001; // Farklı port kullanıyoruz

// Statik dosyaları serve et
app.use(express.static(path.join(__dirname)));

// Makro durumu
let isMacroActive = false;
let macroInterval = null;

// W tuşu makrosunu başlat/durdur
function toggleMacro() {
    if (isMacroActive) {
        stopMacro();
    } else {
        startMacro();
    }
}

// Makroyu başlat
function startMacro() {
    if (isMacroActive) return;
    
    isMacroActive = true;
    console.log('W tuşu makrosu başlatıldı');
    
    // W tuşuna basılı tut
    robot.keyToggle('w', 'down');
    
    // Her 100ms'de bir W tuşunu yeniden bas (bazı oyunlar için gerekli)
    macroInterval = setInterval(() => {
        if (isMacroActive) {
            robot.keyToggle('w', 'down');
        }
    }, 100);
}

// Makroyu durdur
function stopMacro() {
    if (!isMacroActive) return;
    
    isMacroActive = false;
    console.log('W tuşu makrosu durduruldu');
    
    // W tuşunu bırak
    robot.keyToggle('w', 'up');
    
    // Interval'ı temizle
    if (macroInterval) {
        clearInterval(macroInterval);
        macroInterval = null;
    }
}

// API endpoints
app.get('/api/status', (req, res) => {
    res.json({ 
        isActive: isMacroActive,
        message: isMacroActive ? 'Makro aktif' : 'Makro pasif'
    });
});

app.post('/api/toggle', (req, res) => {
    toggleMacro();
    res.json({ 
        success: true,
        isActive: isMacroActive,
        message: isMacroActive ? 'Makro başlatıldı' : 'Makro durduruldu'
    });
});

app.post('/api/start', (req, res) => {
    startMacro();
    res.json({ 
        success: true,
        isActive: isMacroActive,
        message: 'Makro başlatıldı'
    });
});

app.post('/api/stop', (req, res) => {
    stopMacro();
    res.json({ 
        success: true,
        isActive: isMacroActive,
        message: 'Makro durduruldu'
    });
});

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'macro.html'));
});

// Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`W tuşu makro uygulaması http://localhost:${PORT} adresinde çalışıyor`);
    console.log('Uygulamayı kapatmak için Ctrl+C tuşlarına basın');
});

// Uygulama kapatılırken makroyu durdur
process.on('SIGINT', () => {
    console.log('\nUygulama kapatılıyor...');
    stopMacro();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nUygulama kapatılıyor...');
    stopMacro();
    process.exit(0);
});
