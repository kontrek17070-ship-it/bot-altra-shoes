const crypto = require('crypto');
global.crypto = crypto;

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib'); // Bawaan Node.js untuk dekompresi sesi

// ==========================================
// 1. AUTO-RESTORE SESI DARI RAILWAY VARIABLE
// ==========================================
function restoreSessionFromEnv() {
    const envSession = process.env.SESSION_BASE64;
    if (!envSession) return;
    
    const authDir = path.join(__dirname, 'auth_info_baileys');
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }
    
    try {
        const buffer = Buffer.from(envSession, 'base64');
        const decompressed = zlib.gunzipSync(buffer).toString('utf-8');
        const sessionData = JSON.parse(decompressed);
        
        for (const [filename, content] of Object.entries(sessionData)) {
            fs.writeFileSync(path.join(authDir, filename), content, 'utf-8');
        }
        console.log('✅ Sesi berhasil di-restore otomatis dari Railway Variable (Zlib Decompressed)!');
    } catch (e) {
        console.error('⚠️ Gagal restore sesi dari ENV:', e.message);
    }
}

restoreSessionFromEnv();

// ==========================================
// 2. KONFIGURASI UTAMA API & NOMOR
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxcadKMppCjaGuTyU4j-VTIFlOLVD8W9dwGqmozn_MamPdVTFTEKpfK3HVZk4J14gqWNQ/exec"; 
const LION_PARCEL_CS_API = "https://api.lionparcel.com/v1/cs/konfirmasi"; 

const NOMOR_BOS = "6285782575628"; // Nomor lu (Blay / Putra)
const NOMOR_ATTA = "6281234567890"; // Nomor Bang Atta / Kontrex
const NOMOR_BOT = "6285973984510"; // Nomor Bot WA ini

let riwayatGrup = []; 
let sesiPembeli = {}; 

// ==========================================
// 3. FUNGSI PEMANGGIL OTAK GEMINI AI
// ==========================================
async function panggilGeminiAQ(userMessage, systemPrompt) {
    try {
        let url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;
        let payload = { 
            "contents": [{ "role": "user", "parts": [{"text": systemPrompt + "\n\nPesan User: " + userMessage}] }] 
        };
        let response = await axios.post(url, payload, { 
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${GEMINI_API_KEY}` 
            } 
        });
        if (response.data && response.data.candidates) {
            return response.data.candidates[0].content.parts[0].text;
        }
        return "⚠️ Maaf Blay, format respons AI Gemini lagi ngaco nih.";
    } catch (error) {
        return "⚠️ Waduh blay, ada kendala koneksi pas ngobrol sama otak Gemini Flash.";
    }
}

// ==========================================
// 4. KONEKSI BAILEYS & LOGIK WA BOT
// ==========================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        logger: pino({ level: 'silent' }),
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
            console.log('Koneksi terputus, status:', statusCode);
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 3000);
            } else {
                console.log('Perangkat ter-logout dari HP. Wajib export sesi baru!');
            }
        } else if (connection === 'open') {
            console.log('🤖 MANTAP BLAY! BOT ALTRA SHOES SUPER AUTOPILOT TERHUBUNG!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
        
        if (!messageText) return;

        const isGroup = senderJid.endsWith('@g.us');
        let cleanSender = msg.key.participant || senderJid;
        cleanSender = cleanSender.replace('@s.whatsapp.net', '').split(':')[0];
        if (cleanSender.startsWith('0')) cleanSender = '62' + cleanSender.substring(1);

        const isBos = cleanSender.includes(NOMOR_BOS);
        const isAtta = cleanSender.includes(NOMOR_ATTA);

        // ==========================================
        // FITUR A: LOGIKA PERCAKAPAN DI DALAM GRUP
        // ==========================================
        if (isGroup) {
            riwayatGrup.push(`[Dari: ${cleanSender === NOMOR_BOS ? 'Blay' : cleanSender === NOMOR_ATTA ? 'Bang Atta' : 'Tim'}]: ${messageText}`);
            if (riwayatGrup.length > 50) riwayatGrup.shift();

            const isMentioned = messageText.includes(`@${NOMOR_BOT}`) || messageText.toLowerCase().includes('bot');

            // Kasus 1: Bos tag bot untuk follow up resi gagal (Ekstrak Data JSON)
            if (isBos && isMentioned && (messageText.toLowerCase().includes('gagal') || messageText.toLowerCase().includes('follow up'))) {
                let promptEkstrak = `Tugas: Ekstrak Data Pembeli & Nomor Resi dari teks pengiriman gagal. Format WAJIB JSON persis seperti ini tanpa tambahan teks lain: {"nama": "Berto", "nomor_hp": "628...", "resi": "11LP179..."}.`;
                let hasilEkstrak = await panggilGeminiAQ(messageText, promptEkstrak);
                
                try {
                    let jsonMatch = hasilEkstrak.match(/\{.*\}/s);
                    if (jsonMatch) {
                        let dataParsed = JSON.parse(jsonMatch[0]);
                        if (dataParsed.nomor_hp && dataParsed.resi) {
                            let noPembeli = dataParsed.nomor_hp.replace(/[^0-9]/g, ''); 
                            if (noPembeli.startsWith('0')) noPembeli = '62' + noPembeli.substring(1);
                            
                            sesiPembeli[noPembeli] = { nama: dataParsed.nama || "Kak", resi: dataParsed.resi, grupAsal: senderJid, dataLengkap: messageText };
                            
                            let pesanKePembeli = `Halo ${dataParsed.nama || "Kak"}! 👋 Kami dari tim logistik *Altra Shoes* (via Lion Parcel).\n\nKami mendapat laporan kalau paket kakak dengan resi *${dataParsed.resi}* gagal terkirim oleh kurir hari ini.\n\nApakah paketnya mungkin sudah kakak terima? Jika belum, apakah kakak mau dibantu *Kirim Ulang* atau di *Retur*? Balas "KIRIM ULANG" atau "RETUR" ya kak. Terima kasih banyak! 🙏`;
                            await sock.sendMessage(noPembeli + '@s.whatsapp.net', { text: pesanKePembeli });
                            await sock.sendMessage(senderJid, { text: `✅ Siap Bos! Data berhasil diekstrak dan gue udah konfirmasi via japri ke nomor pembelinya.` }, { quoted: msg });
                        }
                    }
                } catch (e) {
                    await sock.sendMessage(senderJid, { text: `⚠️ Error nge-ekstrak data nih Bos. Pastiin format teksnya ada nomor HP dan resinya.` }, { quoted: msg });
                }
            } 
            // Kasus 2: Tag bot biasa di grup untuk nanya sesuatu
            else if (isMentioned) {
                let cleanMessage = messageText.replace(new RegExp(`@${NOMOR_BOT}|bot`, 'gi'), "").trim();
                let promptGrup = "Lu adalah asisten gaul Altra Shoes. Jawab santai, padat, dan langsung ke intinya aja.";
                let respon = await panggilGeminiAQ(cleanMessage, promptGrup);
                await sock.sendMessage(senderJid, { text: `🤖 Yo blay! ${respon}` }, { quoted: msg });
            }
            return;
        }

        // ==========================================
        // FITUR B: LOGIKA JAPRI PEMBELI (BALASAN RETUR/RETRY)
        // ==========================================
        if (!isGroup && !isBos && !isAtta && sesiPembeli[cleanSender]) {
            let { resi, grupAsal, dataLengkap } = sesiPembeli[cleanSender];
            
            let promptKeputusan = `Baca pesan pembeli ini. Tentukan niatnya apakah dia memilih "RETUR", "KIRIM ULANG", "SUDAH DITERIMA", atau "TIDAK JELAS". Balas HANYA dengan SATU KATA keputusan tersebut tanpa tanda baca atau teks tambahan.`;
            let keputusan = await panggilGeminiAQ(messageText, promptKeputusan);

            if (keputusan.includes("SUDAH DITERIMA")) {
                await sock.sendMessage(senderJid, { text: `Alhamdulillah kalau begitu! Ditunggu next ordernya ya kak! 🙏` });
                await sock.sendMessage(grupAsal, { text: `✅ *UPDATE PAKET BLAY!*\n\nPembeli (Resi: ${resi}) konfirmasi paket ternyata *SUDAH DITERIMA*.` });
                delete sesiPembeli[cleanSender];
            } else if (keputusan.includes("RETUR") || keputusan.includes("KIRIM ULANG")) {
                let statusFinal = keputusan.includes("RETUR") ? "RETUR" : "KIRIM ULANG";
                await sock.sendMessage(senderJid, { text: `Baik kak, permintaan *${statusFinal}* akan segera kami proses ke pihak ekspedisi. Terima kasih! 🙏` });
                try { await axios.post(LION_PARCEL_CS_API, { data: dataLengkap, status: statusFinal }); } catch (e) {}
                await sock.sendMessage(grupAsal, { text: `✅ *UPDATE PAKET GAGAL!*\n\nPembeli milih: *${statusFinal}* (Resi: ${resi}). Data otomatis terkirim via sistem ke CS!` });
                delete sesiPembeli[cleanSender]; 
            } else {
                await sock.sendMessage(senderJid, { text: `Maaf kak, tolong balas dengan kata *RETUR* jika ingin dibatalkan, atau *KIRIM ULANG* jika ingin diantar kembali.` });
            }
            return;
        }

        // ==========================================
        // FITUR C: LOGIKA JAPRI BOS (PUTRA/BLAY)
        // ==========================================
        if (!isGroup && isBos) {
            const upperText = messageText.toUpperCase();
            
            // Perintah 1: Analisis Grup
            if (upperText.includes("ANALISIS GRUP") || upperText.includes("SARAN BISNIS")) {
                let promptAnalisis = `Kamu adalah mentor bisnis top. Analisis riwayat chat grup operasional ini: ${riwayatGrup.join(" | ")}. Berikan ringkasan apa yang terjadi dan saran perbaikan operasional.`;
                let responAnalisis = await panggilGeminiAQ("Analisis", promptAnalisis);
                await sock.sendMessage(senderJid, { text: `📊 *HASIL ANALISIS GRUP:*\n\n${responAnalisis}` });
            } 
            // Perintah 2: Cek Stok via Apps Script (Google Sheets)
            else if (upperText.includes("CEK STOK") || upperText.includes("STOK")) {
                try {
                    let res = await axios.get(`${WEB_APP_URL}?action=cekStok&query=${encodeURIComponent(messageText)}`);
                    await sock.sendMessage(senderJid, { text: `📦 ${res.data.result || "Stok berhasil dicek langsung dari Google Sheets."}` });
                } catch (e) {
                    await sock.sendMessage(senderJid, { text: "⚠️ Sistem Sheet sedang lambat atau error, blay." });
                }
            } 
            // Perintah 3: Update Stok via Apps Script (Google Sheets)
            else if (upperText.includes("UPDATE STOK") || upperText.includes("SOLD")) {
                try {
                    let res = await axios.post(WEB_APP_URL, { action: 'updateStok', text: messageText });
                    await sock.sendMessage(senderJid, { text: `🔄 ${res.data.result || "Stok di Google Sheet & Web App berhasil diperbarui!"}` });
                } catch (e) {
                    await sock.sendMessage(senderJid, { text: "⚠️ Gagal mengirim data update ke Google Sheets." });
                }
            } 
            // Ngobrol Bebas sebagai Mentor Bisnis Personal
            else {
                let promptMentorPersonal = `Kamu adalah mentor bisnis AI tingkat atas untuk Putra, tapi kamu memanggilnya "Blay". Gunakan bahasa gaul, akrab, dan maskulin. 
                
                Konteks Profil Blay:
                - Dia berdomisili di Tangerang.
                - Owner toko sepatu kasual "Altra Shoes".
                - Pemilik agen pengiriman "Lion Parcel".
                - Bekerja pegang project delivery untuk JNE Express khusus Erajaya Group.
                - Punya partner / pacar yang sangat support bernama Alika.
                
                Instruksi Sikap: Beri saran bisnis/keuangan yang tajam. Selalu ingatkan tentang pentingnya manajemen cashflow yang rapi, menjaga hubungan baik dengan Alika, dan notice rutin soal sedekah (terutama tiap gajian atau per 2 minggu) agar rezeki bisnisnya selalu berkah.`;
                
                let aiRespon = await panggilGeminiAQ(messageText, promptMentorPersonal);
                await sock.sendMessage(senderJid, { text: aiRespon });
            }
        }
    });
}

startBot();
