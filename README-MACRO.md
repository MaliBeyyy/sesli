# W Tuşu Makro Uygulaması

Bu uygulama, W tuşunu sürekli basılı tutan bir makro yazılımıdır. Oyun oynarken sürekli W tuşuna basmanız gereken durumlar için kullanılabilir.

## 🚀 Kurulum

1. **Bağımlılıkları yükleyin:**
   ```bash
   npm install
   ```

2. **Uygulamayı başlatın:**
   ```bash
   npm run macro
   ```

3. **Tarayıcıda açın:**
   ```
   http://localhost:3001
   ```

## 🎮 Kullanım

1. Uygulamayı başlattıktan sonra tarayıcıda açın
2. "Başlat" butonuna tıklayarak makroyu aktif edin
3. W tuşu sürekli basılı tutulacak
4. "Durdur" butonuna tıklayarak makroyu durdurun

## ⚠️ Önemli Notlar

- **Dikkatli kullanın:** Bu uygulama W tuşunu sürekli basılı tutar
- **Oyun uyumluluğu:** Bazı oyunlar anti-cheat sistemleri kullanabilir
- **Güvenlik:** Sadece güvendiğiniz oyunlarda kullanın
- **Yasal sorumluluk:** Kullanımından doğacak sorunlardan kullanıcı sorumludur

## 🔧 Teknik Detaylar

- **Node.js** tabanlı
- **robotjs** kütüphanesi ile klavye kontrolü
- **Express.js** ile web arayüzü
- **Port:** 3001

## 📋 API Endpoints

- `GET /api/status` - Makro durumunu kontrol et
- `POST /api/toggle` - Makroyu başlat/durdur
- `POST /api/start` - Makroyu başlat
- `POST /api/stop` - Makroyu durdur

## 🛑 Uygulamayı Kapatma

- Terminalde `Ctrl+C` tuşlarına basın
- Veya tarayıcıyı kapatın ve terminali kapatın

## ⚖️ Yasal Uyarı

Bu uygulama eğitim amaçlıdır. Kullanımından doğacak sorunlardan geliştirici sorumlu değildir. Oyun kurallarına uygun şekilde kullanın.

## 🐛 Sorun Giderme

- **robotjs kurulum sorunu:** Windows'ta Visual Studio Build Tools gerekebilir
- **İzin sorunu:** Yönetici olarak çalıştırmayı deneyin
- **Port çakışması:** 3001 portu kullanımda ise w-macro.js dosyasında PORT değerini değiştirin

## 📞 Destek

Sorunlar için GitHub Issues kullanabilirsiniz.
