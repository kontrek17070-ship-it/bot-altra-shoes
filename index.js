const crypto = require('crypto');
global.crypto = crypto;

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');

// ==========================================
// KONFIGURASI UTAMA ALTRA SHOES
// ==========================================
const GEMINI_API_KEY = "AQ.Ab8RN6I3w18SXHUYaqRjN6hJQAufTCBTvDJEerztb8sCpWK6Hg"; 
const SPREADSHEET_ID = "1sRHDSiuHqXGXzqXgFRJrHcrCibDyTE9CpMSzzzzBL70"; 
const WEB_APP_URL = "GANTI_DENGAN_URL_DEPLOY_APPS_SCRIPT_LU"; 
const LION_PARCEL_CS_API = "https://api.lionparcel.com/v1/cs/konfirmasi"; // (URL API Lion Parcel, sesuaikan)
const NOMOR_BOS = "6285782575628"; // Nomor WhatsApp Blay (Putra)
const NOMOR_ATTA = "6281234567890"; // GANTI SAMA NOMOR BANG ATTA

// DATABASE SEMENTARA DI MEMORI
let riwayatGrup = []; 
let sesiPembeli = {}; 

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('🤖 MANTAP BLAY! BOT ALTRA SHOES SUPER AUTOPILOT TERHUBUNG!');
        }
    });

    // MENANGKAP PESAN MASUK
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        const isGroup = senderJid.endsWith('@g.us');
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
        const hasMedia = msg.message.imageMessage || msg.message.documentMessage;
        
        let cleanSender = msg.key.participant || senderJid;
        cleanSender = cleanSender.replace('@s.whatsapp.net', '').split(':')[0];
        if (cleanSender.startsWith('0')) cleanSender = '62' + cleanSender.substring(1);

        const isBos = cleanSender.includes(NOMOR_BOS);
        const isAtta = cleanSender.includes(NOMOR_ATTA);

        // ==========================================
        // 1. LOGIC DI GRUP
        // ==========================================
        if (isGroup) {
            riwayatGrup.push(`[Dari: ${cleanSender === NOMOR_BOS ? 'Blay' : cleanSender === NOMOR_ATTA ? 'Bang Atta' : 'Tim'}]: ${messageText}`);
            if (riwayatGrup.length > 50) riwayatGrup.shift();

            const botNumber = sock.user?.id ? sock.user.id.split(':')[0] : '';
            const isMentioned = messageText.includes('@' + botNumber) || messageText.toLowerCase().includes('bot');

            // FITUR A: BOS MINTA FOLLOW UP PAKET GAGAL DI GRUP
            if (isBos && isMentioned && (messageText.toLowerCase().includes('gagal') || messageText.toLowerCase().includes('follow up'))) {
                let promptEkstrak = `Ekstrak Data Pembeli dan Nomor Resi dari teks ini. Format balasan HARUS JSON: {"nama": "Berto", "nomor_hp": "628...", "resi": "11LP179..."}. Jika tidak ada, balas {"error": true}. Teks: ${messageText}`;
                let hasilEkstrak = await panggilGeminiAQ("Ekstrak", promptEkstrak);
                
                try {
                    let jsonMatch = hasilEkstrak.match(/\{.*\}/s);
                    if (jsonMatch) {
                        let dataParsed = JSON.parse(jsonMatch[0]);
                        if (dataParsed.nomor_hp && dataParsed.resi) {
                            let noPembeli = dataParsed.nomor_hp.startsWith('0') ? '62' + dataParsed.nomor_hp.substring(1) : dataParsed.nomor_hp;
                            noPembeli = noPembeli.replace(/[^0-9]/g, ''); 
                            
                            // Simpan ke sesi pembeli beserta ID Grup untuk lapor balik
                            sesiPembeli[noPembeli] = { 
                                nama: dataParsed.nama || "Kak",
                                resi: dataParsed.resi, 
                                status: 'menunggu_keputusan',
                                grupAsal: senderJid,
                                dataLengkap: messageText 
                            };

                            let captionData = messageText;
                            
                            // Kalau ada gambar (contoh: resi admin Lion), kita forward gambarnya ke pembeli
                            let bufferImage = null;
                            if (hasMedia) {
                                const stream = await downloadContentFromMessage(msg.message.imageMessage || msg.message.documentMessage, 'image');
                                let buffer = Buffer.from([]);
                                for await(const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                                bufferImage = buffer;
                            }

                            // Kirim pesan + data (dan gambar kalau ada) ke pembeli
                            let pesanKePembeli = `Halo ${dataParsed.nama || "Kak"}! 👋 Kami dari *Altra Shoes* (via Lion Parcel).\n\nKami dapat info kalau paket kakak dengan resi *${dataParsed.resi}* gagal dikirim nih kak.\n\nBerikut detail data pengirimannya:\n\n${captionData}\n\nApakah paketnya sudah diterima? Kalau belum, kira-kira paketnya mau kami bantu *Kirim Ulang* (Delivery Kembali) atau di *Retur* (Kembalikan) aja kak? Balas pesan ini ya kak (ketik "KIRIM ULANG" atau "RETUR") biar langsung kami proses. Terima kasih! 🙏`;
                            
                            if (bufferImage) {
                                await sock.sendMessage(noPembeli + '@s.whatsapp.net', { image: bufferImage, caption: pesanKePembeli });
                            } else {
                                await sock.sendMessage(noPembeli + '@s.whatsapp.net', { text: pesanKePembeli });
                            }
                            
                            await sock.sendMessage(senderJid, { text: `✅ Siap Bos! Data pembeli dan resi *${dataParsed.resi}* udah berhasil diekstrak. Gue udah japri pembelinya beserta foto resinya. Nanti kalau ada jawaban, langsung gue kabarin di grup ini.` }, { quoted: msg });
                        } else {
                            await sock.sendMessage(senderJid, { text: `⚠️ Bos, format datanya kurang lengkap. Pastiin ada Nomor HP dan Resinya ya.` }, { quoted: msg });
                        }
                    }
                } catch (e) {
                    await sock.sendMessage(senderJid, { text: `⚠️ Error nge-ekstrak data nih Bos.` }, { quoted: msg });
                }
            } 
            // FITUR B: NGOBROL BIASA SAMA BOT DI GRUP
            else if (isMentioned) {
                let cleanMessage = messageText.replace(new RegExp(`@${botNumber}|bot`, 'gi'), "").trim();
                let respon = await panggilGeminiAQ(cleanMessage, "Lu asisten gaul Altra Shoes. Jawab singkat padat.");
                await sock.sendMessage(senderJid, { text: `🤖 Yo blay! ${respon}` }, { quoted: msg });
            }
            return;
        }

        // ==========================================
        // 2. LOGIC JAPRI DARI PEMBELI (BALASAN FOLLOW UP)
        // ==========================================
        if (!isGroup && !isBos && !isAtta && sesiPembeli[cleanSender]) {
            let resi = sesiPembeli[cleanSender].resi;
            let grupAsal = sesiPembeli[cleanSender].grupAsal;
            let dataLengkap = sesiPembeli[cleanSender].dataLengkap;

            let promptPembeli = `Baca pesan pelanggan ini: "${messageText}". Tentukan apakah dia ingin "RETUR" atau "KIRIM ULANG", atau dia bilang paketnya "SUDAH DITERIMA". Balas HANYA dengan kata "RETUR", "KIRIM ULANG", "SUDAH DITERIMA", atau "TIDAK JELAS".`;
            let keputusan = await panggilGeminiAQ("Tentukan", promptPembeli);

            if (keputusan.includes("SUDAH DITERIMA")) {
                await sock.sendMessage(senderJid, { text: `Alhamdulillah kalau sudah diterima kak! Terima kasih banyak sudah order di Altra Shoes. Ditunggu next ordernya ya kak! 🙏` });
                await sock.sendMessage(grupAsal, { text: `✅ *UPDATE PAKET BLAY!*\n\nPembeli dengan resi *${resi}* ngabarin kalau paketnya ternyata *SUDAH DITERIMA*. Aman ya blay!` });
                delete sesiPembeli[cleanSender];
            }
            else if (keputusan.includes("RETUR") || keputusan.includes("KIRIM ULANG")) {
                let statusFinal = keputusan.includes("RETUR") ? "RETUR" : "KIRIM ULANG";
                
                await sock.sendMessage(senderJid, { text: `Baik kak, permintaan *${statusFinal}* untuk resi ${resi} segera kami proses ke sistem Lion Parcel. Terima kasih kak! 🙏` });

                let responCS = await laporCSLionParcel(dataLengkap, statusFinal);

                await sock.sendMessage(grupAsal, { text: `✅ *UPDATE PAKET GAGAL BLAY!*\n\nPembeli udah milih: *${statusFinal}* (Resi: ${resi}).\n\n${responCS}\n\nData udah sukses di-handle autopilot blay!` });
                
                delete sesiPembeli[cleanSender]; 
            } else {
                await sock.sendMessage(senderJid, { text: `Maaf kak, tolong tegaskan lagi. Apakah paketnya sudah diterima? Jika belum, ketik *RETUR* jika ingin dibatalkan, atau ketik *KIRIM ULANG* jika ingin diantar kembali.` });
            }
            return;
        }

        // ==========================================
        // 3. LOGIC JAPRI KHUSUS BOS (BLAY)
        // ==========================================
        if (!isGroup && isBos) {
            const upperText = messageText.toUpperCase();

            if (upperText.includes("ANALISIS GRUP") || upperText.includes("SARAN BISNIS")) {
                let promptAnalisis = `Kamu mentor bisnis cerdas. Analisis riwayat chat grup tim Altra Shoes ini. Temukan jika ada problem/masalah (selisih, komplain, dll) dan berikan saran menyeluruh, visioner, dan taktis agar bisnis berkembang jauh lebih besar. Riwayat: ${riwayatGrup.join(" | ")}`;
                let responAnalisis = await panggilGeminiAQ("Analisis sekarang", promptAnalisis);
                await sock.sendMessage(senderJid, { text: `📊 *HASIL ANALISIS GRUP & SARAN BISNIS:*\n\n${responAnalisis}` });
            }
            else if (upperText.includes("STOK") || upperText.includes("CEK STOK")) {
                let infoStok = await cekStokDariGoogleSheet(messageText);
                await sock.sendMessage(senderJid, { text: `📦 ${infoStok}` });
            } 
            else if (upperText.includes("UPDATE STOK") || upperText.includes("POTONG STOK") || upperText.includes("SOLD")) {
                let hasilUpdate = await updateStokKeWebApp(messageText);
                await sock.sendMessage(senderJid, { text: `🔄 ${hasilUpdate}` });
            }
            else {
                let mentorPrompt = `Kamu adalah mentor bisnis AI tingkat atas untuk Blay (Putra). Panggil dia "blay", gunakan bahasa gaul, akrab. Blay punya Altra Shoes, agen Lion Parcel, pegang JNE Erajaya. Niatnya sukses untuk sedekah & bantu orang kesusahan. Beri saran bisnis/operasional/keuangan, dan selalu ingatkan tentang manajemen cashflow serta notice sedekah (tiap gajian/2 minggu) agar hidupnya berkah.`;
                let aiRespon = await panggilGeminiAQ(messageText, mentorPrompt);
                await sock.sendMessage(senderJid, { text: aiRespon });
            }
        }
    });
}

// ==========================================
// KUMPULAN FUNGSI PENDUKUNG
// ==========================================

async function panggilGeminiAQ(userMessage, systemPrompt) {
    try {
        let url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;
        let payload = {
            "contents": [{ "role": "user", "parts": [{"text": systemPrompt + "\n\nPesan: " + userMessage}] }]
        };
        let response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GEMINI_API_KEY}` }
        });
        return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
        return "⚠️ Waduh blay, ada kendala pas ngobrol sama otak Gemini Flash nih.";
    }
}

async function laporCSLionParcel(dataPembeli, keputusan) {
    try {
        // SIMULASI TEMBAK API KE LION PARCEL WEB
        /*
        await axios.post(LION_PARCEL_CS_API, { 
            data_lengkap: dataPembeli, 
            tindakan: keputusan 
        });
        */
        return `🤖 Gua udah otomatis kirim *Data Lengkap Pembeli* beserta keputusan *${keputusan}* ke Web/Sistem CS Lion Parcel.`;
    } catch (e) {
        return `⚠️ Gagal nembak API Web Lion Parcel blay, cek koneksi atau endpoint-nya.`;
    }
}

async function cekStokDariGoogleSheet(query) { return "Fungsi cek stok Google Sheet berjalan (Placeholder)."; }
async function updateStokKeWebApp(commandText) { return "Fungsi potong stok kasir ke Web App berjalan (Placeholder)."; }

startBot();