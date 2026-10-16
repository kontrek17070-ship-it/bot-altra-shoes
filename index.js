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

const NOMOR_BOS = "6285782575628"; // Nomor lu (Blay / Putra - Berakhir 5628)
const NOMOR_ATTA = "6281234567890"; // Nomor Bang Atta / Kontrex
const NOMOR_BOT = "6285973984510"; // Nomor Bot WA Altra Shoes

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
            
            // PANCINGAN RESET ENKRIPSI: Bot bakal nge-chat lu duluan tiap kali online
            sock.sendMessage(NOMOR_BOS + '@s.whatsapp.net', { 
                text: '🔄 [SYSTEM PING] Otak Gemini Flash udah sinkron sama enkripsi baru, Blay! Coba balas pesan ini.' 
            });
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
        
        let cleanSender = msg.key.participant || senderJid;
        cleanSender = cleanSender.replace('@s.whatsapp.net', '').split(':')[0];
        if (cleanSender.startsWith('0')) cleanSender = '62' + cleanSender.substring(1);

        console.log(`📥 [LOG MASUK] Dari: ${cleanSender} | Pesan: ${messageText}`);

        if (!messageText) return;

// IDENTIFIKASI BOS AMAN (MENDUKUNG NOMOR ASLI & NOMOR LID HIDDEN WA)
// IDENTIFIKASI BOS AMAN (MENDUKUNG NOMOR ASLI & NOMOR LID HIDDEN WA)
        const isBos = cleanSender.endsWith('5628') || cleanSender.includes(NOMOR_BOS) || cleanSender.includes('207923829592283');
        const isAtta = cleanSender.includes(NOMOR_ATTA);

        // DEFINISIKAN isGroup DULU DI SINI SEBELUM DIPAKAI
        const isGroup = senderJid.endsWith('@g.us');

        // ==========================================
        // FITUR A: LOGIKA PERCAKAPAN DI DALAM GRUP
        // ==========================================
        if (isGroup) {
            riwayatGrup.push(`[Dari: ${isBos ? 'Blay' : isAtta ? 'Bang Atta' : 'Tim'}]: ${messageText}`);
            if (riwayatGrup.length > 50) riwayatGrup.shift();

            const isMentioned = messageText.includes(`@${NOMOR_BOT}`) || messageText.toLowerCase().includes('bot');

            if (isBos && isMentioned && (messageText.toLowerCase().includes('gagal') || messageText.toLowerCase().includes('follow up'))) {
                let promptEkstrak = `Tugas: Ekstrak Data Pembeli & Nomor Resi dari teks pengiriman gagal. Format WAJIB JSON persis seperti ini tanpa tambahan teks lain: {"nama": "Berto", "nomor_hp": "628...", "resi": "11LP179..."}. Teks: ${messageText}`;
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
                            await sock.sendMessage(senderJid, { text: `✅ Siap Bos! Data berhasil diekstrak dan gue udah konfirmasi via japri ke nomor pembelinya.` });
                        }
                    }
                } catch (e) {
                    await sock.sendMessage(senderJid, { text: `⚠️ Error nge-ekstrak data nih Bos.` });
                }
            } else if (isMentioned) {
                let cleanMessage = messageText.replace(new RegExp(`@${NOMOR_BOT}|bot`, 'gi'), "").trim();
                let respon = await panggilGeminiAQ(cleanMessage, "Lu adalah asisten gaul Altra Shoes. Jawab santai, padat, dan langsung ke intinya aja.");
                await sock.sendMessage(senderJid, { text: `🤖 Yo blay! ${respon}` });
            }
            return;
        }

        // ==========================================
        // FITUR B: LOGIKA JAPRI PEMBELI
        // ==========================================
        if (!isGroup && !isBos && !isAtta && sesiPembeli[cleanSender]) {
            let { resi, grupAsal, dataLengkap } = sesiPembeli[cleanSender];
            let keputusan = await panggilGeminiAQ(messageText, `Baca: "${messageText}". Tentukan apakah "RETUR", "KIRIM ULANG", "SUDAH DITERIMA". Balas HANYA kata tersebut.`);

            if (keputusan.includes("SUDAH DITERIMA")) {
                await sock.sendMessage(senderJid, { text: `Alhamdulillah! Ditunggu next ordernya kak! 🙏` });
                await sock.sendMessage(grupAsal, { text: `✅ *UPDATE PAKET BLAY!*\n\nPembeli (Resi: ${resi}) konfirmasi paket *SUDAH DITERIMA*.` });
                delete sesiPembeli[cleanSender];
            } else if (keputusan.includes("RETUR") || keputusan.includes("KIRIM ULANG")) {
                let statusFinal = keputusan.includes("RETUR") ? "RETUR" : "KIRIM ULANG";
                await sock.sendMessage(senderJid, { text: `Baik kak, permintaan *${statusFinal}* segera diproses. Terima kasih! 🙏` });
                try { await axios.post(LION_PARCEL_CS_API, { data: dataLengkap, status: statusFinal }); } catch (e) {}
                await sock.sendMessage(grupAsal, { text: `✅ *UPDATE PAKET GAGAL!*\n\nPembeli milih: *${statusFinal}* (Resi: ${resi}). Data terkirim ke CS!` });
                delete sesiPembeli[cleanSender]; 
            } else {
                await sock.sendMessage(senderJid, { text: `Maaf kak, tolong balas dengan *RETUR* atau *KIRIM ULANG*.` });
            }
            return;
        }

        // ==========================================
        // FITUR C: LOGIKA JAPRI BOS (PUTRA/BLAY)
        // ==========================================
        if (!isGroup && isBos) {
            const upperText = messageText.toUpperCase();
            if (upperText.includes("ANALISIS GRUP") || upperText.includes("SARAN BISNIS")) {
                let responAnalisis = await panggilGeminiAQ("Analisis", `Kamu mentor bisnis. Analisis riwayat chat grup: ${riwayatGrup.join(" | ")}`);
                await sock.sendMessage(senderJid, { text: `📊 *HASIL ANALISIS GRUP:*\n\n${responAnalisis}` });
            } else if (upperText.includes("CEK STOK") || upperText.includes("STOK")) {
                try {
                    let res = await axios.get(`${WEB_APP_URL}?action=cekStok&query=${encodeURIComponent(messageText)}`);
                    await sock.sendMessage(senderJid, { text: `📦 ${res.data.result || "Stok berhasil dicek dari Google Sheets."}` });
                } catch (e) {
                    await sock.sendMessage(senderJid, { text: "⚠️ Sistem Sheet sedang lambat." });
                }
            } else if (upperText.includes("UPDATE STOK") || upperText.includes("SOLD")) {
                try {
                    let res = await axios.post(WEB_APP_URL, { action: 'updateStok', text: messageText });
                    await sock.sendMessage(senderJid, { text: `🔄 ${res.data.result || "Stok diperbarui!"}` });
                } catch (e) {
                    await sock.sendMessage(senderJid, { text: "⚠️ Gagal update ke sistem." });
                }
            } else {
                let promptMentor = `Kamu adalah mentor bisnis AI tingkat atas untuk Putra, tapi kamu memanggilnya "Blay". Gunakan bahasa gaul, akrab, dan maskulin. Konteks: Owner sepatu "Altra Shoes" di Tangerang, agen "Lion Parcel", project delivery JNE Erajaya. Partnernya bernama Alika. Ingatkan cashflow dan sedekah.`;
                let aiRespon = await panggilGeminiAQ(messageText, promptMentor);
                await sock.sendMessage(senderJid, { text: aiRespon });
            }
        }
    });
}

startBot();
}

startBot();
