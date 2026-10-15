const crypto = require('crypto');
global.crypto = crypto;

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// KONFIGURASI UTAMA ALTRA SHOES & INTEGRASI MEMORI PENUH
const GEMINI_API_KEY = "AQ.Ab8RN6I3w18SXHUYaqRjN6hJQAufTCBTvDJEerztb8sCpWK6Hg"; 
const SPREADSHEET_ID = "1sRHDSiuHqXGXzqXgFRJrHcrCibDyTE9CpMSzzzzBL70"; 
const NOMOR_BOS = "6285782575628@s.whatsapp.net"; 

async function startBot() {
    // Menyimpan sesi lokal ke dalam folder 'auth_info_baileys'
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true, // Diaktifkan agar QR muncul sempurna di terminal komputer lu
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n\n--- 📱 SILAKAN SCAN QR CODE DI BAWAH INI ---');
            qrcode.generate(qr, { small: true });
            console.log('--------------------------------------------\n\n');
        }

        if (connection === 'close') {
            const errorLog = lastDisconnect.error?.message || "Tidak diketahui";
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`⚠️ Koneksi terputus! Alasan: ${errorLog}`);
            
            if (shouldReconnect) {
                console.log('⏳ Menghubungkan kembali...');
                startBot();
            } else {
                console.log('❌ Bot logged out.');
            }
        } else if (connection === 'open') {
            console.log('🤖 MANTAP BOS! BOT ALTRA SHOES BERHASIL TERHUBUNG KE WHATSAPP!');
        }
    });

    // MENANGKAP PESAN MASUK & INTEGRASI MEMORI PENUH
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        const isGroup = senderJid.endsWith('@g.us');
        
        const messageText = msg.message.conversation || 
                            msg.message.extendedTextMessage?.text || '';
        
        if (!messageText) return;

        console.log(`Pesan masuk dari ${senderJid}: ${messageText}`);

        let cleanSender = senderJid.replace('@s.whatsapp.net', '');
        if (cleanSender.startsWith('0')) cleanSender = '62' + cleanSender.substring(1);
        let cleanBos = NOMOR_BOS.replace('@s.whatsapp.net', '');
        if (cleanBos.startsWith('0')) cleanBos = '62' + cleanBos.substring(1);

        // 1. JAPRI PRIBADI (MENTOR BISNIS & CEK STOK UNTUK PUTRA)
        if (!isGroup && cleanSender === cleanBos) {
            if (messageText.toUpperCase().includes("STOK") || messageText.toUpperCase().includes("CEK")) {
                let infoStok = await cekStokDariGoogleSheet(messageText);
                await sock.sendMessage(senderJid, { text: "📦 " + infoStok });
            } else {
                let mentorPrompt = "Kamu adalah mentor bisnis AI tingkat atas untuk Putra. Kamu tahu persis seluruh latar belakang Putra: Putra adalah pemilik Altra Shoes (toko alas kaki ritel & kasir di Tangerang), agen Lion Parcel, memegang logistik JNE Express untuk Erajaya Group, sangat mahir membuat otomatisasi Google Apps Script & web apps, serta mengelola keuangan bersama pasangannya, Alika. Berikan analisis bisnis yang cerdas, taktis, sangat luwes, mendalam, dan berikan solusi nyata langkah demi langkah dengan gaya bahasa yang natural, hangat, dan profesional.";
                let aiRespon = await panggilGeminiAQ(messageText, mentorPrompt);
                await sock.sendMessage(senderJid, { text: aiRespon });
            }
        }
        // 2. CHAT DI GRUP (ASISTEN OPERASIONAL)
        else if (isGroup && (messageText.toLowerCase().includes("bot") || messageText.includes("6285973984510"))) {
            let cleanMessage = messageText.replace(/@6285973984510/g, "").trim();
            let asistenPrompt = "Kamu adalah asisten operasional Altra Shoes di Tangerang milik Putra. Jawab dengan ringkas, ramah, dan solutif untuk urusan toko, kasir, maupun ekspedisi.";
            let aiRespon = await panggilGeminiAQ(cleanMessage, asistenPrompt);
            await sock.sendMessage(senderJid, { text: "🤖 " + aiRespon });
        }
    });
}

// FUNGSI MEMANGGIL GEMINI API NATIVE
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
    try {
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