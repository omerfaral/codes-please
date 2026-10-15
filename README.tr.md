# Kontrol Kulübesi (Checkpoint Booth)

*[English](README.md)*

Claude Code'un izin isteklerini terminal yerine retro bir sınır kontrol kulübesinde evrak olarak karşılayan yerel arayüz. Belgeleri incelersin, damgayı vurursun, kararın ajana geri gider. Oturumlara buradan mektup da yazabilirsin. Arayüz İngilizce (varsayılan) ve Türkçe; dili **AYARLAR → Dil** menüsünden değiştirebilirsin.

## Kurulum

```bash
npm install
npm run install-hooks   # ~/.claude/settings.json yedeklenir, yalnızca kulübe hook'ları eklenir
npm start               # arayüzü derler, sunucuyu 127.0.0.1:4777'de açar, tarayıcıyı açar
```

- İlk çalıştırmada `~/.checkpoint-booth/config.json` içine rastgele bir erişim token'ı yazılır (izin 0600). Arayüz bağlantısı token'ı içerir ve token adres çubuğundan silinir.
- Kaldırmak için `npm run uninstall-hooks` çalıştır. Yalnızca `booth-hook.cjs` girdileri silinir, diğer hook'ların yerinde kalır.
- Açık Claude Code oturumları, hook değişikliğini `/hooks` menüsü açılıp kapatılınca ya da oturum yeniden başlatılınca görür.

## Güvenlik ağı

Hook şu durumlarda hiçbir şey basmadan `exit 0` ile çıkar ve Claude Code normal terminal onayına döner:
- Sunucu kapalıysa.
- Token yanlışsa.
- Arayüz hiç açık değilse.
- Arayüz 15 saniyeden uzun süre kapalı kaldıysa.
- Herhangi bir hata olursa.

İsteği terminalden cevaplarsan başvuru kuyruktan kendiliğinden düşer ve geçmişe "TERMİNAL" olarak yazılır.

## Kullanım

| Tuş | İş |
| --- | --- |
| Enter | Masa boşsa sıradakini çağırır, doluysa evrakı geri verir (gönderir) |
| A / R / K | ONAY, RED veya KALICI İZİN damgası (KALICI için P de çalışır) |
| N | Not fişine odaklanır; not yazılıp damgasız gönderilirse NOT (geri gönderme) sayılır |
| Esc | Not fişinden ya da açık klasörden çıkar |

- **ONAY + not:** İzin verilir; not, araç çalıştıktan sonra PostToolUse üzerinden Claude'a gider.
- **RED + not:** Not, ret gerekçesi olarak gider.
- **NOT:** İstek reddedilir; not "bunu yapma, onun yerine şunu yap" talimatı olarak gider.
- **KALICI İZİN:** Claude'un önerdiği kural bu oturumla sınırlı uygulanır (`updatedPermissions`, `destination: "session"`).
- **Posta:** Bir klasörden yazdığın mesaj ilk uygun hook'ta teslim edilir: PreToolUse, PostToolUse, UserPromptSubmit ya da durmayı engelleyen Stop.

Claude'a giden mesajlar arayüz dilinden bağımsız olarak her zaman İngilizcedir.

## Test

```bash
npm test        # gerçek hook betiği ↔ gerçek sunucu ↔ sahte arayüz: 10 senaryo
npm run demo    # gerçek Claude Code olmadan sahte başvurularla arayüzü dene
```

Demo, başvuruları gerçek adapter'dan geçirir. Ajana gidecek JSON, sol alttaki "Telsiz Kaydı"nda görünür. **AYARLAR → Demo başvuruları gönder** ile istediğin zaman yeni tur başlatabilirsin.

## Mimari ve dokümantasyondan farklar

Ayrıntılar için [README.md](README.md) dosyasındaki "Architecture" ve "Differences from the hook docs" bölümlerine bak.
