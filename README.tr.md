![Codes, Please — kodlama ajanları için izin kontrol noktası](docs/banner.svg)

# Codes, Please

*[English](README.md)*

**Kodlama ajanın sınırı geçmek istiyor. Müfettiş sensin.**

Codes, Please, Claude Code için *Papers, Please* tarzı bir sınır kontrol kulübesi. Ajan her izin istediğinde (bir komut çalıştırmak, dosya düzenlemek, bir sayfa çekmek) bu istek terminalde soru olarak çıkmıyor. Bunun yerine bir başvuru sahibi kulübe camına gelip evraklarını ahşap masanın üstünden sana uzatıyor:
- talep formu,
- değiştirmek istediği dosyanın diff'i,
- ne yaptığına dair kendi beyanı,
- okuduklarının raporu.

Belgeleri incelersin, formu istediğin damganın altına sürükler ve damgayı vurursun: **ONAYLANDI**, **REDDEDİLDİ** ya da notla iade. Kararın doğrudan ajana gider.

Ayrıca Claude Code oturumların için bir dosya dolabı tutar:
- Diskteki son bir haftanın tüm oturumlarını bulur; kurulumdan önce başlamış olanları bile.
- Her klasör ajanı canlı izler: hangi aracı çalıştırdığını ve ne dediğini gösterir.
- Ajanın işini bitirip **sıranın sende** olduğu oturumları işaretler.
- Ajan çalışırken ona mektup yazabilirsin.

Kasvetli 1980'ler bürokrasisi, soluk piksel art ve lastik damgalar.

> Lucas Pope'un *Papers, Please* oyunundan esinlenmiştir. Resmî olmayan bir hayran projesidir; oyunun yapımcılarıyla bağı yoktur ve onlar tarafından onaylanmamıştır. Buradaki tüm çizimler, isimler ve metinler özgündür.

## Kurulum

Node.js 20.11 veya üstü gerekir.

```bash
npx codes-please install   # ~/.claude/settings.json yedeklenir, yalnızca bu aracın hook girdileri eklenir
npx codes-please           # kulübeyi http://127.0.0.1:4777 adresinde açar
```

Ya da global olarak kur:

```bash
npm install -g codes-please
codes-please install
codes-please
```

| Komut | Ne yapar |
| --- | --- |
| `codes-please` / `codes-please start` | Kulübeyi açar (`--no-open` ile tarayıcı açılmaz) |
| `codes-please demo` | Sahte başvurularla açar; Claude Code gerekmez |
| `codes-please install` | Hook'ları ekler (önce ayarlarının yedeği alınır) |
| `codes-please uninstall` | Yalnızca bu aracın hook'larını siler; diğerleri yerinde kalır |

- İlk çalıştırmada `~/.checkpoint-booth/config.json` içine rastgele bir erişim token'ı yazılır (izin 0600). Arayüz bağlantısı token'ı içerir ve token adres çubuğundan silinir.
- Hook betiği `~/.checkpoint-booth/` altına kopyalanır; npx önbelleği temizlense de hook'lar çalışmaya devam eder.
- Açık Claude Code oturumları, hook değişikliğini `/hooks` menüsü açılıp kapatılınca ya da oturum yeniden başlatılınca görür.

## Kulübede

1. **SIRADAKİ!** (ya da Enter) ile sıradaki başvuru sahibini cama çağır. Belgeleri masaya kayar.
2. Evrakları oku. Sürükleyip üst üste koyabilir, çift tıklayıp büyütebilirsin. Uzun diff'ler sayfalanır; sayfa çevirince sesi gelir.
3. Damga rayı sağdan açılır. **Talep Formu**'nu istediğin damganın altına sürükle ve damgaya tıkla. Kâğıdın lastiğin altına denk gelen yeri mürekkeplenir. Kâğıdı ıskalarsan damga masaya vurur.
4. İstersen **Not Fişi**'ne yaz, sonra **GERİ VER**'e bas (ya da Enter).

| Tuş | İş |
| --- | --- |
| Enter | Sıradakini çağırır / evrakı geri verir |
| A / R / K | ONAY, RED veya KALICI damgasını formun damga alanına vurur (KALICI için P de çalışır) |
| N | Not fişine odaklanır; damgasız geri verilen not NOT sayılır |
| Esc | Not fişinden ya da açık klasörden çıkar |

Her kararın etkisi:
- **ONAY + not:** İzin verilir; not, araç çalıştıktan sonra PostToolUse üzerinden Claude'a gider.
- **RED + not:** Not, ret gerekçesi olarak gider.
- **NOT:** İstek reddedilir; not "bunu yapma, onun yerine şunu yap" talimatı olarak gider.
- **KALICI:** Claude'un önerdiği kural bu oturumla sınırlı uygulanır (`updatedPermissions`, `destination: "session"`).
- **Posta:** Bir oturum klasöründen yazdığın mektup ilk uygun hook'ta teslim edilir: PreToolUse, PostToolUse, UserPromptSubmit ya da durmayı engelleyen Stop.

Claude'a giden mesajlar arayüz dilinden bağımsız olarak her zaman İngilizcedir.

## Güvenlik ağı

Hook şu durumlarda hiçbir şey basmadan `exit 0` ile çıkar ve Claude Code normal terminal onayına döner:
- Sunucu kapalıysa.
- Token yanlışsa.
- Arayüz hiç açık değilse.
- Arayüz 15 saniyeden uzun süre kapalı kaldıysa.
- Herhangi bir hata olursa.

İsteği terminalden cevaplarsan başvuru sahibi kuyruktan ayrılır ve geçmişe "TERMİNAL" olarak yazılır.

## Yol haritası

- [x] Onay kulübesi: kuyruk, belgeler, formu damganın altına sürükleyerek damgalama, not fişi
- [x] Oturum dolabı: diskteki oturumların keşfi, canlı kayıt, "sıra sende" durumu, posta kutusu
- [x] İngilizce ve Türkçe arayüz
- [ ] Oturumları Claude Agent SDK ile yönetme: yeni oturum başlatma, boştaki oturuma mesaj, durdurma
- [ ] Kesme ve izin modu kontrolleri (ör. oturumu plan moduna alma)
- [ ] Alt ajanları ana oturumdan ayrı izleme
- [ ] Oturum başına maliyet ve bağlam kullanımı
- [ ] Arama, projeye göre gruplama, klasörleri yeniden adlandırma ve arşivleme
- [ ] Codex adapter'ı
- [ ] Büyük araç çıktılarını atlayan daha akıllı canlı kayıt

## Geliştirme

```bash
git clone https://github.com/omerfaral/codes-please && cd codes-please
npm install
npm test               # gerçek hook betiği ↔ gerçek sunucu ↔ sahte arayüz
npm run demo           # derler ve kulübeyi sahte başvurularla açar
npm run install-hooks  # hook'ları bu klasöre yönlendirir
```

Demo, başvuruları gerçek adapter'dan geçirir. Ajana gidecek JSON, sol alttaki "Telsiz Kaydı"nda görünür. **AYARLAR → Demo başvuruları gönder** ile istediğin zaman yeni tur başlatabilirsin.

## Mimari ve dokümantasyondan farklar

Ayrıntılar için [README.md](README.md) dosyasındaki "Architecture" ve "Differences from the hook docs" bölümlerine bak.
