# Render Free Tier Keep-Alive Çözümleri

Render'ın ücretsiz planında sunucu 10-15 dakikada bir uyku moduna geçer. Bu sorunu çözmek için aşağıdaki yöntemler uygulanmıştır:

## 1. Sunucu Tarafı Optimizasyonları

### Keep-Alive Endpoints
- `/ping` - Basit ping endpoint
- `/health` - Detaylı sistem durumu
- `/keepalive` - Render free tier için özel endpoint

### Socket.IO Optimizasyonları
- `pingTimeout: 60000` - 60 saniye ping timeout
- `pingInterval: 25000` - 25 saniye ping interval
- `connectTimeout: 30000` - 30 saniye bağlantı timeout
- Bellek optimizasyonları ve sıkıştırma ayarları

## 2. İstemci Tarafı Optimizasyonları

### Otomatik Keep-Alive
- 30 saniyede bir sunucuya ping gönderir
- Bağlantı kaybı durumunda otomatik yeniden bağlanma
- Maksimum 5 yeniden bağlanma denemesi
- Exponential backoff ile bekleme süreleri

### Socket.IO Bağlantı Ayarları
- `reconnectionAttempts: 10` - 10 yeniden bağlanma denemesi
- `reconnectionDelay: 2000` - 2 saniye başlangıç gecikmesi
- `reconnectionDelayMax: 10000` - Maksimum 10 saniye gecikme
- `timeout: 20000` - 20 saniye bağlantı timeout'u

## 3. Ek Öneriler

### Uptime Robot Kullanımı
1. [UptimeRobot](https://uptimerobot.com) hesabı oluşturun
2. Yeni monitor ekleyin:
   - **Monitor Type**: HTTP(s)
   - **URL**: `https://your-app.onrender.com/keepalive`
   - **Monitoring Interval**: 5 dakika
   - **Alert Contacts**: E-posta adresinizi ekleyin

### Alternatif Keep-Alive Servisleri
- [Cron-job.org](https://cron-job.org) - Ücretsiz cron job servisi
- [EasyCron](https://www.easycron.com) - Ücretsiz plan mevcut
- [SetCronJob](https://www.setcronjob.com) - Ücretsiz plan mevcut

### Cron Job Örneği
```bash
# Her 5 dakikada bir sunucuyu canlı tut
*/5 * * * * curl -s https://your-app.onrender.com/keepalive > /dev/null
```

## 4. Render Free Tier Limitleri

- **Uyku Süresi**: 15 dakika inaktivite sonrası
- **Uyanma Süresi**: 30-60 saniye
- **Aylık Kullanım**: 750 saat
- **Bellek**: 512 MB

## 5. Performans İpuçları

### Bellek Kullanımını Azaltma
- Gereksiz log'ları kaldırın
- Bellek sızıntılarını önleyin
- Düzenli garbage collection yapın

### Bağlantı Optimizasyonu
- WebSocket bağlantılarını optimize edin
- Gereksiz ping'leri azaltın
- Bağlantı havuzu kullanın

## 6. Monitoring ve Debugging

### Sunucu Logları
```javascript
// Bellek kullanımını izle
setInterval(() => {
    const used = process.memoryUsage();
    console.log(`Bellek: ${Math.round(used.heapUsed / 1024 / 1024)} MB`);
}, 30000);
```

### İstemci Logları
```javascript
// Bağlantı durumunu izle
socket.on('connect', () => console.log('Bağlandı'));
socket.on('disconnect', (reason) => console.log('Bağlantı kesildi:', reason));
```

## 7. Sorun Giderme

### Yaygın Sorunlar
1. **Sunucu uyanmıyor**: UptimeRobot ayarlarını kontrol edin
2. **Bağlantı kopuyor**: Keep-alive interval'ını azaltın
3. **Bellek hatası**: Gereksiz objeleri temizleyin

### Debug Komutları
```bash
# Sunucu durumunu kontrol et
curl https://your-app.onrender.com/health

# Keep-alive testi
curl https://your-app.onrender.com/keepalive
```

Bu çözümlerle Render free tier'da daha stabil bir hizmet sağlayabilirsiniz.
