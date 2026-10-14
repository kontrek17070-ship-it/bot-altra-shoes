const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// KONFIGURASI UTAMA ALTRA SHOES
const GEMINI_API_KEY = "AQ.Ab8RN6I3w18SXHUYaqRjN6hJQAufTCBTvDJEerztb8sCpWK6Hg"; 
const SPREADSHEET_ID = "1sRHDSiuHqXGXzqXgFRJrHcrCibDyTE9CpMSzzzzBL70"; 
const NOMOR_BOS = "6285782575628@s.whatsapp.net"; // Format JID WhatsApp Putra

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        // printQRInTerminal: true ini kadang suka nge-bug di Railway, 
        // kita ganti pakai fungsi qrcode-terminal manual yang pasti tembus.
        printQRInTerminal: false, 
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // MENCETAK QR CODE KE LAYAR LOG RAILWAY
        if (qr) {
            console.log('\n\n--- SILAKAN SCAN QR CODE INI ---');
            qrcode.generate(qr, { small: true });
            console.log('--------------------------------\n\n');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba menghubungkan kembali...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            } else {
                console.log('Bot logged out. Silakan hapus folder auth_info_baileys dan mulai ulang.');
            }
        } else if (connection === 'open') {
            console.log('🤖 BOT ALTRA SHOES BERHASIL TERHUBUNG KE WHATSAPP!');
        }
    });

    // MENANGKAP PESAN MASUK
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        const isGroup = senderJid.endsWith('@g.us');
        
        // Ambil teks pesan (bisa dari teks biasa atau extended)
        const messageText = msg.message.conversation || 
                            msg.message.extendedTextMessage?.text || '';
        
        if (!messageText) return;

        console.log(`Pesan masuk dari ${senderJid}: ${messageText}`);

        // 1. JAPRI PRIBADI (HANYA UNTUK PUTRA SEBAGAI MENTOR BISNIS)
        // Mengecek apakah pengirim adalah Bos Putra (mengabaikan awalan 0 atau 62)
        let cleanSender = senderJid.replace('@s.whatsapp.net', '');
        if (cleanSender.startsWith('0')) cleanSender = '62' + cleanSender.substring(1);
        let cleanBos = NOMOR_BOS.replace('@s.whatsapp.net', '');
        if (cleanBos.startsWith('0')) cleanBos = '62' + cleanBos.substring(1);

        if (!isGroup && cleanSender === cleanBos) {
            if (messageText.toUpperCase().includes("STOK") || messageText.toUpperCase().includes("CEK")) {
                let infoStok = await cekStokDariGoogleSheet(messageText);
                await sock.sendMessage(senderJid, { text: "📦 " + infoStok });
            } else {
                let mentorPrompt = "Kamu adalah mentor bisnis AI tingkat atas untuk Putra. Putra adalah pemilik Altra Shoes (toko alas kaki kasir & retail di Tangerang), agen Lion Parcel, memegang logistik JNE Express untuk Erajaya Group, sangat mahir membuat otomatisasi Google Apps Script, dan mengelola keuangan kasir bersama Alika. Berikan analisis bisnis yang cerdas, taktis, sangat luwes, mendalam, dan berikan solusi nyata langkah demi langkah dengan gaya bahasa yang natural, hangat, dan profesional.";
                let aiRespon = await panggilGeminiAQ(messageText, mentorPrompt);
                await sock.sendMessage(senderJid, { text: aiRespon });
            }
        }
        // 2. CHAT DI GRUP (ASISTEN OPERASIONAL)
        else if (isGroup && (messageText.toLowerCase().includes("bot") || messageText.includes("6285973984510"))) {
            let cleanMessage = messageText.replace(/@6285973984510/g, "").trim();
            let asistenPrompt = "Kamu adalah asisten operasional Altra Shoes. Jawab dengan ringkas, ramah, dan solutif untuk urusan toko.";
            let aiRespon = await panggilGeminiAQ(cleanMessage, asistenPrompt);
            await sock.sendMessage(senderJid, { text: "🤖 " + aiRespon });
        }
    });
}

// FUNGSI MEMANGGIL GEMINI NATIVE MENGGUNAKAN KUNCI AQ
async function panggilGeminiAQ(userMessage, systemPrompt) {
    try {
        let url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        let payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": systemPrompt + "\n\nPesan dari Putra: " + userMessage}
                    ]
                }
            ]
        };

        let response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        let data = response.data;
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text;
        }
        return "Maaf, AI tidak merespon.";
    } catch (error) {
        console.error("Error Gemini:", error.response?.data || error.message);
        return "⚠️ Terjadi kendala saat menghubungi otak AI Gemini AQ.";
    }
}

// FUNGSI MEMBACA GOOGLE SHEET INVENTARIS
async function cekStokDariGoogleSheet(query) {
    // Catatan: Google Sheet bisa dibaca lewat Web App Apps Script yang sebelumnya atau API publik sheet
    try {
        // Kita gunakan endpoint publik Google Sheet CSV untuk baca data kilat
        let csvUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv`;
        let res = await axios.get(csvUrl);
        let rows = res.data.split('\n');
        
        let hasil = `Hasil pencarian stok untuk: *${query}*\n`;
        let ditemukan = false;

        for (let i = 1; i < rows.length; i++) {
            let cols = rows[i].split(',');
            if (cols.length >= 3) {
                let namaSepatu = cols[0].replace(/"/g, '');
                let sizeSepatu = cols[1].replace(/"/g, '');
                let stokSepatu = cols[2].replace(/"/g, '');

                if (query.toLowerCase().split(' ').some(w => w.length > 2 && namaSepatu.toLowerCase().includes(w))) {
                    hasil += `• ${namaSepatu} (Size ${sizeSepatu}) : Sisa *${stokSepatu}* pcs\n`;
                    ditemukan = true;
                }
            }
        }
        return ditemukan ? hasil : "Stok sepatu tersebut tidak ditemukan di sistem STOCK SEPATU PUTRA.";
    } catch (e) {
        return "Gagal membaca Google Sheet: " + e.message;
    }
}

startBot();
