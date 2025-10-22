# Render'da Deploy Etme Rehberi

## 🚀 Hızlı Deploy

### 1. Ana Web Servisi
- **Servis Tipi**: Web Service
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Health Check Path**: `/health`
- **Environment Variables**:
  - `NODE_ENV=production`
  - `PORT=3000` (otomatik)

### 2. Uptime Monitor Servisi (Opsiyonel)
- **Servis Tipi**: Web Service
- **Build Command**: `npm install`
- **Start Command**: `npm run uptime`
- **Environment Variables**:
  - `NODE_ENV=production`

## 🔧 Önemli Notlar

### Render Free Tier Sınırlamaları
- Sunucu 15 dakika inaktivite sonrası uykuya geçer
- Uyandırma süresi 30-60 saniye arası
- Aylık 750 saat ücretsiz kullanım

### Optimizasyonlar
- ✅ Keep-alive mekanizması aktif
- ✅ Otomatik bağlantı kurtarma
- ✅ Bellek optimizasyonu
- ✅ Health check endpoint'leri
- ✅ Ping/pong sistemi

### Endpoint'ler
- `/ping` - Basit ping kontrolü
- `/health` - Detaylı sunucu durumu
- `/keepalive` - Sunucuyu aktif tutma

## 📊 Monitoring

### Log'ları İzleme
```bash
# Render Dashboard'da log'ları kontrol edin
# Önemli log mesajları:
# - [Keep-Alive] Sunucu aktif
# - [Memory] Bellek kullanımı
# - [Cleanup] Boş oda silindi
```

### Health Check
```bash
curl https://your-app.onrender.com/health
```

## 🛠️ Sorun Giderme

### Sunucu Uykuya Geçerse
1. Herhangi bir endpoint'e istek gönderin
2. Uptime monitor servisi çalışıyorsa otomatik uyandırılır
3. İlk istek 30-60 saniye sürebilir

### Bellek Sorunları
- Sunucu otomatik olarak bellek temizliği yapar
- 100MB üzeri kullanımda uyarı verir
- Boş odalar otomatik silinir

### Bağlantı Sorunları
- Client tarafında otomatik yeniden bağlanma
- Ping/pong sistemi ile bağlantı kalitesi kontrolü
- Görsel durum bildirimleri

## 🎯 Performans İpuçları

1. **İlk Deploy**: İlk deploy 2-3 dakika sürebilir
2. **Cold Start**: Uyku sonrası ilk istek yavaş olabilir
3. **Monitoring**: Render Dashboard'da log'ları takip edin
4. **Uptime**: Uptime monitor servisi kullanarak sürekli aktif tutun

## 📈 Upgrade Önerileri

Render'ın ücretli planlarına geçmek isterseniz:
- **Starter Plan**: $7/ay - 24/7 aktif
- **Standard Plan**: $25/ay - Daha fazla kaynak
- **Pro Plan**: $85/ay - Yüksek performans
